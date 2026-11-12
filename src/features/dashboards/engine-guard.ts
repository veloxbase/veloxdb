import type { DatabaseEngine } from '@/data/types'
import { listConnectors } from '@/features/plugins/registry'

export function canUseDashboards(engine: DatabaseEngine): boolean {
  const connector = listConnectors().find((candidate) => candidate.id === engine)
  return connector?.supportedForDashboards ?? false
}

export function dashboardGuardMessage(engine: DatabaseEngine): string | null {
  if (canUseDashboards(engine)) return null
  return `Dashboards need a SQL SELECT connection. ${engine} isn't supported yet.`
}
