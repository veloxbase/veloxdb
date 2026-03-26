export type ConnectionInput = {
  id?: string
  name: string
  host: string
  port: number
  database: string
  user: string
  password: string
}

export type ConnectionSummary = {
  id: string
  name: string
  host: string
  port: number
  database: string
  user: string
  connectedAt: string
}

export type QueryRequest = {
  connectionId?: string
  sql: string
}

export type TableInfo = {
  schema: string
  name: string
  previewQuery: string
}

export type ColumnInfo = {
  tableSchema: string
  tableName: string
  columnName: string
  dataType: string
  isNullable: boolean
}

export type ColumnProperties = {
  tableSchema: string
  tableName: string
  columnName: string
  dataType: string
  isNullable: boolean
  isPrimaryKey: boolean
  isUnique: boolean
  isPartOfCompositeUnique: boolean
}

export type ColumnPropertiesUpdate = {
  columnName: string
  isNullable: boolean
  isUnique: boolean
}

export type TablePropertiesApplyRequest = {
  connectionId?: string
  tableSchema: string
  tableName: string
  columns: ColumnPropertiesUpdate[]
}

export type QueryResult = {
  columns: string[]
  rows: Array<Record<string, string | null>>
  rowCount: number
  executionMs: number
  truncated: boolean
  commandTag: number | null
}

/** One column-pair from a foreign key (composite keys yield multiple rows). */
export type ForeignKeyEdge = {
  fromSchema: string
  fromTable: string
  fromColumn: string
  toSchema: string
  toTable: string
  toColumn: string
}

export type DdlBatchRequest = {
  connectionId?: string
  statements: string[]
}

