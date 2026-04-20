import type { ColumnInfo } from '@/data/types'
import { TABLE_NODE_WIDTH } from '@/features/model/table-node-metrics'

const HEADER_H = 40
const ROW_H = 18
const MAX_ROWS = 8
const PAD = 10

/** World-space point on the right edge of a column row (for relationship rubber-band). */
/** Local Y (relative to table top) for a column row, including “+N more” band when index is past the visible cap. */
export function columnAnchorLocalY(columnName: string, columns: ColumnInfo[]): number {
  const idx = columns.findIndex((c) => c.columnName === columnName)
  if (idx < 0) return HEADER_H + 4 + ROW_H / 2
  if (idx >= MAX_ROWS) {
    if (columns.length > MAX_ROWS) {
      return HEADER_H + 4 + MAX_ROWS * ROW_H + ROW_H / 2
    }
    return HEADER_H + 4 + (MAX_ROWS - 1) * ROW_H + ROW_H / 2
  }
  return HEADER_H + 4 + idx * ROW_H + ROW_H / 2
}

export function columnAnchorWorld(
  tablePos: { x: number; y: number },
  columnName: string,
  columns: ColumnInfo[],
): { x: number; y: number } {
  const localY = columnAnchorLocalY(columnName, columns)
  return {
    x: tablePos.x + TABLE_NODE_WIDTH,
    y: tablePos.y + localY,
  }
}

/** Left-edge anchor (incoming edges from the left). */
export function columnAnchorWorldLeft(
  tablePos: { x: number; y: number },
  columnName: string,
  columns: ColumnInfo[],
): { x: number; y: number } {
  const localY = columnAnchorLocalY(columnName, columns)
  return { x: tablePos.x + PAD, y: tablePos.y + localY }
}

