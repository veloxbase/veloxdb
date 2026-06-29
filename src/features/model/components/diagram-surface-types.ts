import type { MutableRefObject } from 'react'

import type { PendingModelForeignKey } from '@/features/model/apply-entire-model'
import type { ColumnDetailLevel, DiagramGroup, TableKey, ViewportState } from '@/features/model/model-types'
import type { DiagramTool } from '@/features/model/use-diagram-interaction'
import type { ColumnInfo, DatabaseEngine, ForeignKeyEdge } from '@/data/types'
import type { RelationshipInput } from '@/features/model/relationship-validation'

export type TableDisplay = {
  key: TableKey
  schema: string
  name: string
}

export type DiagramExportHandle = {
  toDataURL: (options?: { pixelRatio?: number }) => string | Promise<string>
}

export type DiagramEdgeSelection = {
  id: string
  kind: 'committed' | 'pending'
  fromKey: TableKey
  fromColumn: string
  toKey: TableKey
  toColumn: string
}

export type DiagramSurfaceProps = {
  isDark: boolean
  connectionEngine?: DatabaseEngine
  initialViewport: ViewportState
  onViewportSave: (v: ViewportState) => void
  tableDisplays: TableDisplay[]
  positions: Record<TableKey, { x: number; y: number }>
  columnsByKey: Record<TableKey, ColumnInfo[] | null>
  foreignKeys: ForeignKeyEdge[]
  selectedKeys: ReadonlySet<TableKey>
  diagramTool: DiagramTool
  onTableSelect: (key: TableKey, shiftKey: boolean) => void
  onClearSelection: () => void
  onTableDragStart?: (key: TableKey) => void
  onTableDragMove?: (key: TableKey, x: number, y: number) => void
  onMoveTable: (key: TableKey, x: number, y: number) => void
  onRequestColumns: (key: TableKey) => void
  onConnectColumns?: (fromKey: TableKey, fromColumn: string, toKey: TableKey, toColumn: string) => void
  onConnectTables?: (fromKey: TableKey, toKey: TableKey) => void
  canConnectColumns?: (input: RelationshipInput) => boolean
  selectedEdgeId?: string | null
  onEdgeSelect?: (edge: DiagramEdgeSelection | null) => void
  onQuickEditColumn?: (
    tableKey: TableKey,
    sourceColumnName: string,
    patch: { nextColumnName: string; nextDataType: string },
  ) => void
  headerColors?: Record<TableKey, string>
  editedColumnNamesByKey?: Record<TableKey, ReadonlySet<string>>
  pendingForeignKeys?: PendingModelForeignKey[]
  columnDetail?: ColumnDetailLevel
  diagramGroups?: DiagramGroup[]
  exportRef?: MutableRefObject<DiagramExportHandle | null>
  viewportControlRef?: MutableRefObject<{
    setViewport: (v: ViewportState) => void
    getViewport: () => ViewportState
  } | null>
}
