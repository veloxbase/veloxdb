import type { PendingModelForeignKey } from '@/features/model/apply-entire-model'
import { columnAnchorWorld, columnAnchorWorldLeft } from '@/features/model/diagram-geometry/node-anchors'
import type { ColumnDetailLevel, TableKey } from '@/features/model/model-types'
import { TABLE_NODE_WIDTH, tableNodeHeight } from '@/features/model/table-node-metrics'
import type { ColumnInfo, ForeignKeyEdge } from '@/data/types'

export type RoutedDiagramEdge = {
  id: string
  points: number[]
  kind: 'committed' | 'pending'
  fromKey: TableKey
  toKey: TableKey
  fromColumn: string
  toColumn: string
}

function tableMidY(
  pos: { x: number; y: number },
  cols: ColumnInfo[] | null,
  columnDetail: ColumnDetailLevel,
): number {
  return pos.y + tableNodeHeight(cols, columnDetail) / 2
}

/**
 * Pick a world-space endpoint on the table edge facing the peer.
 * Arrow convention: line runs referencing table (from) → referenced table (to); pointer at `to` end.
 */
function chooseEndpoint(
  pos: { x: number; y: number },
  columnName: string,
  cols: ColumnInfo[] | null,
  facing: 'east' | 'west',
  columnDetail: ColumnDetailLevel,
): { x: number; y: number } {
  if (columnDetail === 'header') {
    const h = tableNodeHeight([], columnDetail)
    const midY = pos.y + h / 2
    return facing === 'east'
      ? { x: pos.x + TABLE_NODE_WIDTH, y: midY }
      : { x: pos.x + 12, y: midY }
  }
  if (cols != null && cols.length > 0) {
    return facing === 'east'
      ? columnAnchorWorld(pos, columnName, cols)
      : columnAnchorWorldLeft(pos, columnName, cols)
  }
  const h = tableNodeHeight(cols, columnDetail)
  const midY = pos.y + h / 2
  return facing === 'east'
    ? { x: pos.x + TABLE_NODE_WIDTH, y: midY }
    : { x: pos.x + 12, y: midY }
}

/** Simple orthogonal polyline (one elbow) between two anchors. */
export function orthogonalRoutePoints(
  fx: number,
  fy: number,
  tx: number,
  ty: number,
): number[] {
  if (Math.hypot(tx - fx, ty - fy) < 2) return [fx, fy, tx, ty]
  const midX = (fx + tx) / 2
  return [fx, fy, midX, fy, midX, ty, tx, ty]
}

export function buildRoutedDiagramEdges(params: {
  foreignKeys: ForeignKeyEdge[]
  pendingForeignKeys: PendingModelForeignKey[]
  onCanvasSet: ReadonlySet<TableKey>
  positions: Record<TableKey, { x: number; y: number }>
  columnsByKey: Record<TableKey, ColumnInfo[] | null>
  columnDetail?: ColumnDetailLevel
}): { committed: RoutedDiagramEdge[]; pending: RoutedDiagramEdge[] } {
  const {
    foreignKeys,
    pendingForeignKeys,
    onCanvasSet,
    positions,
    columnsByKey,
    columnDetail = 'full',
  } = params
  const committedSeen = new Set<string>()
  const committed: RoutedDiagramEdge[] = []

  for (const fk of foreignKeys) {
    const fromKey = `${fk.fromSchema}.${fk.fromTable}` as TableKey
    const toKey = `${fk.toSchema}.${fk.toTable}` as TableKey
    if (!onCanvasSet.has(fromKey) || !onCanvasSet.has(toKey)) continue

    const dedupeKey = `${fromKey}\0${fk.fromColumn}\0${toKey}\0${fk.toColumn}`
    if (committedSeen.has(dedupeKey)) continue
    committedSeen.add(dedupeKey)

    const fromPos = positions[fromKey]
    const toPos = positions[toKey]
    if (!fromPos || !toPos) continue

    const fromCols = columnsByKey[fromKey] ?? null
    const toCols = columnsByKey[toKey] ?? null

    const fc = {
      x: fromPos.x + TABLE_NODE_WIDTH / 2,
      y: tableMidY(fromPos, fromCols, columnDetail),
    }
    const tc = { x: toPos.x + TABLE_NODE_WIDTH / 2, y: tableMidY(toPos, toCols, columnDetail) }
    const dx = tc.x - fc.x

    const fromFacing: 'east' | 'west' = dx >= 0 ? 'east' : 'west'
    const toFacing: 'east' | 'west' = dx >= 0 ? 'west' : 'east'

    const fromPt = chooseEndpoint(fromPos, fk.fromColumn, fromCols, fromFacing, columnDetail)
    const toPt = chooseEndpoint(toPos, fk.toColumn, toCols, toFacing, columnDetail)
    const points = orthogonalRoutePoints(fromPt.x, fromPt.y, toPt.x, toPt.y)

    committed.push({
      id: `fk:${fromKey}:${fk.fromColumn}:${toKey}:${fk.toColumn}`,
      points,
      kind: 'committed',
      fromKey,
      toKey,
      fromColumn: fk.fromColumn,
      toColumn: fk.toColumn,
    })
  }

  const pending: RoutedDiagramEdge[] = []
  const pendingSeen = new Set<string>()
  for (const pfk of pendingForeignKeys) {
    if (!onCanvasSet.has(pfk.fromKey) || !onCanvasSet.has(pfk.toKey)) continue
    if (pendingSeen.has(pfk.id)) continue
    pendingSeen.add(pfk.id)

    const fromPos = positions[pfk.fromKey]
    const toPos = positions[pfk.toKey]
    if (!fromPos || !toPos) continue

    const fromCols = columnsByKey[pfk.fromKey] ?? null
    const toCols = columnsByKey[pfk.toKey] ?? null

    const fc = {
      x: fromPos.x + TABLE_NODE_WIDTH / 2,
      y: tableMidY(fromPos, fromCols, columnDetail),
    }
    const tc = { x: toPos.x + TABLE_NODE_WIDTH / 2, y: tableMidY(toPos, toCols, columnDetail) }
    const dx = tc.x - fc.x
    const fromFacing: 'east' | 'west' = dx >= 0 ? 'east' : 'west'
    const toFacing: 'east' | 'west' = dx >= 0 ? 'west' : 'east'
    const fromPt = chooseEndpoint(fromPos, pfk.fromColumn, fromCols, fromFacing, columnDetail)
    const toPt = chooseEndpoint(toPos, pfk.toColumn, toCols, toFacing, columnDetail)
    const points = orthogonalRoutePoints(fromPt.x, fromPt.y, toPt.x, toPt.y)

    pending.push({
      id: `pending:${pfk.id}`,
      points,
      kind: 'pending',
      fromKey: pfk.fromKey,
      toKey: pfk.toKey,
      fromColumn: pfk.fromColumn,
      toColumn: pfk.toColumn,
    })
  }

  return { committed, pending }
}
