import { useQuery } from '@tanstack/react-query'

import { queryKeys } from '@/data/query-keys'
import type { Entitlements } from '@/data/types'
import { useCloudAuth } from '@/features/auth/AuthProvider'
import { fetchEntitlements } from '@/features/auth/cloud-client'
import { isProBuild } from '@/lib/build-config'

export type { Entitlements }

const FREE_ENTITLEMENTS: Entitlements = {
  bi: false,
  ai: false,
  teamSharing: false,
  plan: 'free',
  status: 'inactive',
  currentPeriodEnd: null,
}

const DEV_FALLBACK_ENTITLEMENTS: Entitlements = {
  bi: true,
  ai: true,
  teamSharing: false,
  plan: 'pro',
  status: 'active',
  currentPeriodEnd: null,
}

export function useEntitlements(): Entitlements {
  const { hasSession } = useCloudAuth()

  const entitlementsQuery = useQuery({
    queryKey: queryKeys.entitlements(),
    queryFn: () => fetchEntitlements(),
    enabled: isProBuild && hasSession,
    staleTime: 60_000,
    retry: 1,
  })

  if (!isProBuild) {
    return FREE_ENTITLEMENTS
  }

  if (hasSession && entitlementsQuery.data) {
    return entitlementsQuery.data
  }

  // In local development, allow offline dashboard experimentation when signed out.
  if (import.meta.env.DEV && !hasSession) {
    return DEV_FALLBACK_ENTITLEMENTS
  }

  return FREE_ENTITLEMENTS
}
