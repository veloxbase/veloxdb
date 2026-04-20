import type { ColumnInfo } from '@/data/types'
import type { ColumnDetailLevel, TableKey } from '@/features/model/model-types'
import { TABLE_NODE_WIDTH, tableNodeHeight } from '@/features/model/table-node-metrics'

export type ContentBounds = { minX: number; minY: number; maxX: number; maxY: number }

const DEFAULT_PAD = 80

export function diagramContentBounds(
  keys: readonly TableKey[],
  positions: Record<TableKey, { x: number; y: number }>,
  columnsByKey: Record<TableKey, ColumnInfo[] | null>,
  pad: number = DEFAULT_PAD,
  columnDetail: ColumnDetailLevel = 'full',
): ContentBounds {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const k of keys) {
    const p = positions[k]
    if (!p) continue
    const h = tableNodeHeight(columnsByKey[k] ?? null, columnDetail)
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x + TABLE_NODE_WIDTH)
    maxY = Math.max(maxY, p.y + h)
  }
  if (!Number.isFinite(minX)) {
    return { minX: -pad, minY: -pad, maxX: pad * 4, maxY: pad * 3 }
  }
  return {
    minX: minX - pad,
    minY: minY - pad,
    maxX: maxX + pad,
    maxY: maxY + pad,
  }
}
