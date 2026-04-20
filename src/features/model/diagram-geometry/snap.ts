import type { ColumnInfo } from '@/data/types'
import type { ColumnDetailLevel, TableKey } from '@/features/model/model-types'
import { TABLE_NODE_WIDTH, tableNodeHeight } from '@/features/model/table-node-metrics'

export const DEFAULT_DIAGRAM_GRID = 8

export function snapScalar(v: number, grid: number = DEFAULT_DIAGRAM_GRID): number {
  return Math.round(v / grid) * grid
}

export function snapPoint(
  p: { x: number; y: number },
  grid: number = DEFAULT_DIAGRAM_GRID,
): { x: number; y: number } {
  return { x: snapScalar(p.x, grid), y: snapScalar(p.y, grid) }
}

type PosMap = Record<TableKey, { x: number; y: number }>
type ColMap = Record<TableKey, ColumnInfo[] | null>

export function alignSelectedLeft(keys: TableKey[], positions: PosMap): PosMap {
  if (keys.length === 0) return positions
  let minX = Infinity
  for (const k of keys) {
    const p = positions[k]
    if (p) minX = Math.min(minX, p.x)
  }
  if (!Number.isFinite(minX)) return positions
  const next = { ...positions }
  for (const k of keys) {
    const p = next[k]
    if (p) next[k] = { ...p, x: minX }
  }
  return next
}

export function alignSelectedRight(keys: TableKey[], positions: PosMap): PosMap {
  if (keys.length === 0) return positions
  let maxRight = -Infinity
  for (const k of keys) {
    const p = positions[k]
    if (!p) continue
    const w = TABLE_NODE_WIDTH
    maxRight = Math.max(maxRight, p.x + w)
  }
  if (!Number.isFinite(maxRight)) return positions
  const next = { ...positions }
  for (const k of keys) {
    const p = next[k]
    if (!p) continue
    next[k] = { ...p, x: maxRight - TABLE_NODE_WIDTH }
  }
  return next
}

export function alignSelectedTop(keys: TableKey[], positions: PosMap): PosMap {
  if (keys.length === 0) return positions
  let minY = Infinity
  for (const k of keys) {
    const p = positions[k]
    if (p) minY = Math.min(minY, p.y)
  }
  if (!Number.isFinite(minY)) return positions
  const next = { ...positions }
  for (const k of keys) {
    const p = next[k]
    if (p) next[k] = { ...p, y: minY }
  }
  return next
}

export function alignSelectedBottom(
  keys: TableKey[],
  positions: PosMap,
  columnsByKey: ColMap,
  columnDetail: ColumnDetailLevel = 'full',
): PosMap {
  if (keys.length === 0) return positions
  let maxBottom = -Infinity
  for (const k of keys) {
    const p = positions[k]
    if (!p) continue
    const h = tableNodeHeight(columnsByKey[k] ?? null, columnDetail)
    maxBottom = Math.max(maxBottom, p.y + h)
  }
  if (!Number.isFinite(maxBottom)) return positions
  const next = { ...positions }
  for (const k of keys) {
    const p = next[k]
    if (!p) continue
    const h = tableNodeHeight(columnsByKey[k] ?? null, columnDetail)
    next[k] = { ...p, y: maxBottom - h }
  }
  return next
}
