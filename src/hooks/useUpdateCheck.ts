import { useQuery } from '@tanstack/react-query'
import { invoke } from '@tauri-apps/api/core'

export type UpdateCheckResult = {
  currentVersion: string
  latestVersion: string
  hasUpdate: boolean
  downloadUrl: string | null
  releaseNotes: string | null
}

const STALE_TIME = 30 * 60 * 1000        // 30 minutes — cache across components
const REFETCH_INTERVAL = 4 * 60 * 60 * 1000 // 4 hours — auto background check
const RETRY_COUNT = 2

export function useUpdateCheck({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['check-for-updates'],
    queryFn: () => invoke<UpdateCheckResult>('check_for_updates'),
    staleTime: STALE_TIME,
    refetchInterval: REFETCH_INTERVAL,
    retry: RETRY_COUNT,
    enabled,
  })
}
