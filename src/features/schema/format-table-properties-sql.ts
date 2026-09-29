import type { QueryClient } from '@tanstack/react-query'

import { queryKeys } from '@/data/query-keys'
import { veloxDbRepository } from '@/data/repositories'
import type { ColumnProperties, TableInfo } from '@/data/types'
import { quoteIdent } from '@/lib/sql-ident'

const FETCH_CHUNK_SIZE = 6

export function formatTablePropertiesSql(
  table: Pick<TableInfo, 'schema' | 'name'>,
  columns: ColumnProperties[],
): string {
  const tblRef = `${quoteIdent(table.schema, 'postgres')}.${quoteIdent(table.name, 'postgres')}`
  const pkCols = columns.filter((c) => c.isPrimaryKey).map((c) => quoteIdent(c.columnName, 'postgres'))

  const lines = columns.map((col) => {
    let def = `  ${quoteIdent(col.columnName, 'postgres')} ${col.dataType}`
    if (!col.isNullable) def += ' NOT NULL'
    if (col.isUnique && !col.isPrimaryKey) def += ' UNIQUE'
    return def
  })

  if (pkCols.length > 0) {
    lines.push(`  PRIMARY KEY (${pkCols.join(', ')})`)
  }

  return `CREATE TABLE ${tblRef} (\n${lines.join(',\n')}\n);`
}

export function formatTablesPropertiesSql(
  entries: Array<{ table: Pick<TableInfo, 'schema' | 'name'>; columns: ColumnProperties[] }>,
): string {
  return entries.map(({ table, columns }) => formatTablePropertiesSql(table, columns)).join('\n\n')
}

async function mapInChunks<T, R>(
  items: T[],
  chunkSize: number,
  mapFn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize)
    const mapped = await Promise.all(chunk.map(mapFn))
    out.push(...mapped)
  }
  return out
}

/** Fetch column properties for many tables with bounded concurrency; returns CREATE TABLE SQL. */
export async function fetchTablesPropertiesSql(
  queryClient: QueryClient,
  connectionId: string,
  tables: TableInfo[],
): Promise<string> {
  if (tables.length === 0) return ''

  const entries = await mapInChunks(tables, FETCH_CHUNK_SIZE, async (table) => {
    const columns = await queryClient.fetchQuery({
      queryKey: queryKeys.tableProperties(connectionId, table),
      queryFn: () => veloxDbRepository.getTableProperties(connectionId, table),
      staleTime: 5 * 60 * 1000,
    })
    return { table, columns }
  })

  return formatTablesPropertiesSql(entries)
}
