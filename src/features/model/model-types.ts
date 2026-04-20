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

export type DiagramToolPersisted = 'select' | 'pan' | 'connect'

export const DEFAULT_DIAGRAM_VIEW_ID = 'default'

export type ColumnDetailLevel = 'full' | 'keys' | 'header'

export type DiagramGroup = {
  id: string
  name: string
  tableKeys: TableKey[]
}

export type DiagramLayoutSnapshot = {
  positions: Record<TableKey, { x: number; y: number }>
  viewport: ViewportState
  onCanvas: TableKey[]
  /** Editable label for the model (defaults to connection database name). */
  modelTitle?: string
  /** Per-table diagram header fill (`#rrggbb`); overrides theme default. */
  headerColors?: Record<TableKey, string>
  /** Last diagram toolbar tool; defaults to select when missing. */
  diagramTool?: DiagramToolPersisted
  /** When false, table positions are not snapped to the diagram grid. Defaults to true. */
  snapToGrid?: boolean
  /** Which columns to list on table cards. Defaults to full. */
  columnDetail?: ColumnDetailLevel
  /** User-defined frames grouping tables (visual only). */
  diagramGroups?: DiagramGroup[]
}

export type DiagramViewEntry = {
  id: string
  name: string
}

export type DiagramViewsRegistry = {
  activeViewId: string
  views: DiagramViewEntry[]
}

export type ModelTableView = {
  key: TableKey
  table: TableInfo
  /** Loaded when selected or when columns were prefetched */
  columns: ColumnInfo[] | null
}
