import type { ColumnInfo } from '@/data/types'
import type { ColumnDetailLevel } from '@/features/model/model-types'

export const TABLE_NODE_WIDTH = 248

const HEADER_H = 40
const ROW_H = 18
const MAX_ROWS = 8
const BODY_TOP = 8
const BODY_PAD = 10

export function tableNodeHeight(
  columns: ColumnInfo[] | null,
  columnDetail: ColumnDetailLevel = 'full',
): number {
  if (columnDetail === 'header') {
    return HEADER_H + BODY_PAD
  }
  if (columns == null) {
    return HEADER_H + BODY_TOP + 22 + BODY_PAD
  }
  const n = Math.min(columns.length, MAX_ROWS)
  const more = columns.length > MAX_ROWS ? ROW_H : 0
  return HEADER_H + BODY_TOP + n * ROW_H + more + BODY_PAD
}
