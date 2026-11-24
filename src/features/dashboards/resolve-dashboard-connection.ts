import type { ConnectionSummary } from '@/data/types'

export function resolveConnectionById(
  connections: ConnectionSummary[],
  connectionId: string,
): ConnectionSummary | null {
  return connections.find((c) => c.id === connectionId) ?? null
}

export function connectionLabel(
  connections: ConnectionSummary[],
  connectionId: string,
): string {
  return resolveConnectionById(connections, connectionId)?.name ?? 'Connection missing'
}
