import type { MutableRefObject } from 'react'

import type { PendingModelForeignKey } from '@/features/model/apply-entire-model'
import type { ColumnDetailLevel, DiagramGroup, TableKey, ViewportState } from '@/features/model/model-types'
import type { DiagramTool } from '@/features/model/use-diagram-interaction'
import type { ColumnInfo, ForeignKeyEdge } from '@/data/types'

export type TableDisplay = {
  key: TableKey
  schema: string
  name: string
}

export type DiagramExportHandle = {
  toDataURL: (options?: { pixelRatio?: number }) => string | Promise<string>
}

export type DiagramSurfaceProps = {
  isDark: boolean
  viewport: ViewportState
  onViewportChange: (v: ViewportState) => void
  tableDisplays: TableDisplay[]
  positions: Record<TableKey, { x: number; y: number }>
  columnsByKey: Record<TableKey, ColumnInfo[] | null>
  foreignKeys: ForeignKeyEdge[]
  selectedKeys: ReadonlySet<TableKey>
  diagramTool: DiagramTool
  onTableSelect: (key: TableKey, shiftKey: boolean) => void
  onClearSelection: () => void
  onMarqueeSelect: (keys: TableKey[], shiftKey: boolean) => void
  onTableDragStart?: (key: TableKey) => void
  onTableDragMove?: (key: TableKey, x: number, y: number) => void
  onMoveTable: (key: TableKey, x: number, y: number) => void
  onRequestColumns: (key: TableKey) => void
  onConnectColumns?: (fromKey: TableKey, fromColumn: string, toKey: TableKey, toColumn: string) => void
  onQuickEditColumn?: (
    tableKey: TableKey,
    sourceColumnName: string,
    patch: { nextColumnName: string; nextDataType: string },
  ) => void
  headerColors?: Record<TableKey, string>
  pendingForeignKeys?: PendingModelForeignKey[]
  columnDetail?: ColumnDetailLevel
  diagramGroups?: DiagramGroup[]
  exportRef?: MutableRefObject<DiagramExportHandle | null>
}
