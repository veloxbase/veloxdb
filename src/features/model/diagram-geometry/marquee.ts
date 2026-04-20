import type { ColumnInfo } from '@/data/types'
import type { TableKey } from '@/features/model/model-types'
import { aabbIntersects, tableAabb, type Aabb } from '@/features/model/diagram-geometry/bounds'
import type { ColumnDetailLevel } from '@/features/model/model-types'

export type MarqueeRect = { x: number; y: number; w: number; h: number }

export function normalizeMarquee(ax: number, ay: number, bx: number, by: number): MarqueeRect {
  const x = Math.min(ax, bx)
  const y = Math.min(ay, by)
  const w = Math.abs(bx - ax)
  const h = Math.abs(by - ay)
  return { x, y, w, h }
}

export function keysInMarquee(
  tableKeys: readonly TableKey[],
  positions: Record<TableKey, { x: number; y: number }>,
  columnsByKey: Record<TableKey, ColumnInfo[] | null>,
  marquee: MarqueeRect,
  columnDetail: ColumnDetailLevel = 'full',
): TableKey[] {
  const m: Aabb = marquee
  const out: TableKey[] = []
  for (const k of tableKeys) {
    const pos = positions[k]
    if (!pos) continue
    const cols = columnsByKey[k] ?? null
    const aabb = tableAabb(pos, cols, columnDetail)
    if (aabbIntersects(aabb, m)) out.push(k)
  }
  return out
}
