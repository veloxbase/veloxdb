import { tableAabb, type Aabb } from '@/features/model/diagram-geometry/bounds'
import type { ColumnDetailLevel, DiagramGroup, TableKey } from '@/features/model/model-types'
import type { ColumnInfo } from '@/data/types'

function unionAabbs(boxes: Aabb[]): Aabb | null {
  if (boxes.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const b of boxes) {
    minX = Math.min(minX, b.x)
    minY = Math.min(minY, b.y)
    maxX = Math.max(maxX, b.x + b.w)
    maxY = Math.max(maxY, b.y + b.h)
  }
  if (!Number.isFinite(minX)) return null
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

/** Padded world-space frame around all tables in the group (for Konva overlay). */
export function diagramGroupWorldBounds(
  group: DiagramGroup,
  positions: Record<TableKey, { x: number; y: number }>,
  columnsByKey: Record<TableKey, ColumnInfo[] | null>,
  columnDetail: ColumnDetailLevel,
  pad: number = 10,
): { x: number; y: number; w: number; h: number } | null {
  const boxes: Aabb[] = []
  for (const k of group.tableKeys) {
    const p = positions[k]
    if (!p) continue
    boxes.push(tableAabb(p, columnsByKey[k] ?? null, columnDetail))
  }
  const u = unionAabbs(boxes)
  if (!u) return null
  return {
    x: u.x - pad,
    y: u.y - pad,
    w: u.w + pad * 2,
    h: u.h + pad * 2,
  }
}

export function groupLabelWorldPosition(
  group: DiagramGroup,
  positions: Record<TableKey, { x: number; y: number }>,
  columnsByKey: Record<TableKey, ColumnInfo[] | null>,
  columnDetail: ColumnDetailLevel,
  pad: number = 10,
): { x: number; y: number } | null {
  const b = diagramGroupWorldBounds(group, positions, columnsByKey, columnDetail, pad)
  if (!b) return null
  return { x: b.x + 6, y: b.y + 4 }
}
