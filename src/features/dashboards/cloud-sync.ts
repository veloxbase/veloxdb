import { getCloudApiKeySync } from '@/features/auth/cloud-credentials'
import { getCloudUrl } from '@/features/auth/cloud-config'
import type { Dashboard } from '@/data/types'

export async function pushCloudDashboard(dashboard: Dashboard): Promise<'ok' | 'conflict' | 'skipped'> {
  const key = getCloudApiKeySync()
  if (!key) return 'skipped'
  const res = await fetch(`${getCloudUrl()}/api/v1/dashboards/${dashboard.id}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ document: dashboard, updatedAt: new Date(dashboard.updatedAt).toISOString() }),
  })
  if (res.status === 409) return 'conflict'
  if (!res.ok) return 'skipped'
  return 'ok'
}

export async function pullCloudDashboard(id: string): Promise<{ document: Dashboard; updatedAt: string } | null> {
  const key = getCloudApiKeySync()
  if (!key) return null
  const res = await fetch(`${getCloudUrl()}/api/v1/dashboards/${id}`, {
    headers: { Authorization: `Bearer ${key}` },
  })
  if (!res.ok) return null
  return res.json() as Promise<{ document: Dashboard; updatedAt: string }>
}
