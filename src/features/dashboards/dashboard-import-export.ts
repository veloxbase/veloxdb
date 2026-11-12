import type { Dashboard } from '@/data/types'
import { migrateDashboard } from '@/features/dashboards/dashboard-migrate'

export function serializeDashboard(dashboard: Dashboard): string {
  return JSON.stringify(dashboard, null, 2)
}

/** Parses and validates an imported dashboard JSON file, upgrading older versions. */
export function parseDashboardJson(raw: string): Dashboard {
  const parsed: unknown = JSON.parse(raw)
  return migrateDashboard(parsed)
}
