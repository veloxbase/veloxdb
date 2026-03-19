import type { TableInfo } from '@/data/types'

export type ResultRow = Record<string, string | null>

export type ResultEditPatch = {
  rowId: string
  primaryKey: Record<string, string | null>
  changes: Record<string, string | null>
}

export type SaveResultEditsRequest = {
  connectionId?: string
  table: TableInfo
  patches: ResultEditPatch[]
}

function quoteIdentifier(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`
}

function sqlLiteral(value: string | null) {
  if (value === null) {
    return 'NULL'
  }

  return `'${value.replaceAll("'", "''")}'`
}

function buildWhereClause(primaryKey: Record<string, string | null>) {
  const entries = Object.entries(primaryKey)
  if (entries.length === 0) {
    return ''
  }

  return entries
    .map(([columnName, columnValue]) => {
      if (columnValue === null) {
        return `${quoteIdentifier(columnName)} IS NULL`
      }

      return `${quoteIdentifier(columnName)} = ${sqlLiteral(columnValue)}`
    })
    .join(' AND ')
}

export function buildUpdateStatements(request: SaveResultEditsRequest) {
  const tableName = `${quoteIdentifier(request.table.schema)}.${quoteIdentifier(request.table.name)}`

  return request.patches
    .map((patch) => {
      const assignments = Object.entries(patch.changes)
        .map(([columnName, value]) => `${quoteIdentifier(columnName)} = ${sqlLiteral(value)}`)
        .join(', ')
      const whereClause = buildWhereClause(patch.primaryKey)

      if (!assignments || !whereClause) {
        return ''
      }

      return `UPDATE ${tableName} SET ${assignments} WHERE ${whereClause};`
    })
    .filter(Boolean)
}
