import type { ColumnInfo, TableInfo } from '@/data/types'

export type TableKey = string

export function tableKey(table: Pick<TableInfo, 'schema' | 'name'>): TableKey {
  return `${table.schema}.${table.name}`
}

export type ViewportState = {
  scale: number
  x: number
  y: number
}

export type DiagramLayoutSnapshot = {
  positions: Record<TableKey, { x: number; y: number }>
  viewport: ViewportState
  onCanvas: TableKey[]
  /** Editable label for the model (defaults to connection database name). */
  modelTitle?: string
}

export type ModelTableView = {
  key: TableKey
  table: TableInfo
  /** Loaded when selected or when columns were prefetched */
  columns: ColumnInfo[] | null
}
