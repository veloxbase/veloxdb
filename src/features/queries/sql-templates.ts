import type { DatabaseEngine, TableInfo } from '@/data/types'

import { quoteIdent } from '@/lib/sql-ident'

/** Qualified "schema"."table" for SQL snippets. */
export function qualifiedTableName(table: TableInfo, engine: DatabaseEngine = 'postgres'): string {
  return `${quoteIdent(table.schema, engine)}.${quoteIdent(table.name, engine)}`
}

export function buildSelectAllSql(table: TableInfo, limit = 200, engine: DatabaseEngine = 'postgres'): string {
  const q = qualifiedTableName(table, engine)
  if (engine === 'mssql' || engine === 'azuresql') {
    return `SELECT TOP ${limit} *\nFROM ${q};`
  }
  return `SELECT *\nFROM ${q}\nLIMIT ${limit};`
}

export function buildSelectCountSql(table: TableInfo, engine: DatabaseEngine = 'postgres'): string {
  const q = qualifiedTableName(table, engine)
  return `SELECT COUNT(*) AS cnt\nFROM ${q};`
}

export function buildInsertTemplateSql(table: TableInfo, columnNames: string[], engine: DatabaseEngine = 'postgres'): string {
  const q = qualifiedTableName(table, engine)
  if (columnNames.length === 0) {
    return `INSERT INTO ${q}\nDEFAULT VALUES;`
  }
  const cols = columnNames.map((name) => quoteIdent(name, engine)).join(', ')
  return `INSERT INTO ${q} (${cols})\nVALUES (/* values */);`
}

export function buildUpdateTemplateSql(table: TableInfo, primaryKeyColumns: string[], engine: DatabaseEngine = 'postgres'): string {
  const q = qualifiedTableName(table, engine)
  const sets = '/* column */ = /* value */'
  if (primaryKeyColumns.length === 0) {
    return `UPDATE ${q}\nSET ${sets}\nWHERE /* condition */;`
  }
  const where = primaryKeyColumns
    .map((c) => `${quoteIdent(c, engine)} = /* value */`)
    .join(' AND ')
  return `UPDATE ${q}\nSET ${sets}\nWHERE ${where};`
}

export function buildDeleteTemplateSql(table: TableInfo, primaryKeyColumns: string[], engine: DatabaseEngine = 'postgres'): string {
  const q = qualifiedTableName(table, engine)
  if (primaryKeyColumns.length === 0) {
    return `DELETE FROM ${q}\nWHERE /* condition */;`
  }
  const where = primaryKeyColumns
    .map((c) => `${quoteIdent(c, engine)} = /* value */`)
    .join(' AND ')
  return `DELETE FROM ${q}\nWHERE ${where};`
}

export function buildRenameTableSql(
  table: TableInfo,
  nextTableName = 'new_table_name',
  engine: DatabaseEngine = 'postgres',
): string {
  const q = qualifiedTableName(table, engine)
  if (engine === 'mssql' || engine === 'azuresql') {
    return `EXEC sp_rename '${table.schema}.${table.name}', '${nextTableName}';`
  }
  return `ALTER TABLE ${q}\nRENAME TO ${quoteIdent(nextTableName, engine)};`
}

export function buildDropTableSql(table: TableInfo, engine: DatabaseEngine = 'postgres'): string {
  const q = qualifiedTableName(table, engine)
  return `DROP TABLE ${q};`
}
