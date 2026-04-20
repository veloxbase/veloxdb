import type { ColumnInfo } from '@/data/types'
import type { ColumnDetailLevel } from '@/features/model/model-types'
import { TABLE_NODE_WIDTH, tableNodeHeight } from '@/features/model/table-node-metrics'

export type Aabb = { x: number; y: number; w: number; h: number }

export function tableAabb(
  pos: { x: number; y: number },
  columns: ColumnInfo[] | null,
  columnDetail: ColumnDetailLevel = 'full',
): Aabb {
  return {
    x: pos.x,
    y: pos.y,
    w: TABLE_NODE_WIDTH,
    h: tableNodeHeight(columns, columnDetail),
  }
}

export function aabbIntersects(a: Aabb, b: Aabb): boolean {
  return !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y)
}
