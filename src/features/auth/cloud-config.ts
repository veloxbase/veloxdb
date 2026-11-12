export const DESKTOP_REDIRECT_URI = 'veloxdb://auth/callback'

const DEFAULT_DEV_CLOUD_URL = 'http://localhost:5001'
const DEFAULT_PROD_CLOUD_URL = 'https://veloxdb.dev'

export function getCloudUrl(): string {
  const fromEnv = import.meta.env.VITE_VELOX_CLOUD_URL?.trim()
  if (fromEnv) return fromEnv.replace(/\/+$/, '')
  return import.meta.env.DEV ? DEFAULT_DEV_CLOUD_URL : DEFAULT_PROD_CLOUD_URL
}

export function cloudApiUrl(path: string): string {
  const prefix = path.startsWith('/') ? path : `/${path}`
  return `${getCloudUrl()}${prefix}`
}

export function cloudBillingUrl(plan?: string | null): string {
  const startTrial = plan !== 'cloud' && plan !== 'pro' && plan !== 'team'
  return `${getCloudUrl()}/dashboard/billing${startTrial ? '?start=cloud' : ''}`
}
