import type { ForeignKeyEdge } from '@/data/types'
import type { TableKey } from '@/features/model/model-types'

/**
 * Order tables so referenced tables (parents) appear before referencing tables (children),
 * using FK metadata. Used for left-to-right grid placement. Falls back to name sort on cycles.
 */
export function topologicalLayoutOrder(
  onCanvas: TableKey[],
  foreignKeys: ForeignKeyEdge[],
): TableKey[] {
  const onSet = new Set(onCanvas)
  const indeg = new Map<TableKey, number>()
  const adj = new Map<TableKey, TableKey[]>()

  for (const k of onCanvas) {
    indeg.set(k, 0)
    adj.set(k, [])
  }

  for (const fk of foreignKeys) {
    const fromKey = `${fk.fromSchema}.${fk.fromTable}` as TableKey
    const toKey = `${fk.toSchema}.${fk.toTable}` as TableKey
    if (!onSet.has(fromKey) || !onSet.has(toKey)) continue
    indeg.set(fromKey, (indeg.get(fromKey) ?? 0) + 1)
    adj.get(toKey)?.push(fromKey)
  }

  const queue = [...onCanvas].filter((k) => (indeg.get(k) ?? 0) === 0).sort((a, b) => a.localeCompare(b))
  const out: TableKey[] = []

  while (queue.length > 0) {
    const k = queue.shift()!
    out.push(k)
    for (const child of adj.get(k) ?? []) {
      const next = (indeg.get(child) ?? 0) - 1
      indeg.set(child, next)
      if (next === 0) {
        queue.push(child)
        queue.sort((a, b) => a.localeCompare(b))
      }
    }
  }

  if (out.length !== onCanvas.length) {
    return [...onCanvas].sort((a, b) => a.localeCompare(b))
  }
  return out
}
