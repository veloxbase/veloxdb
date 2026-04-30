import { useQuery } from '@tanstack/react-query'
import { veloxDbRepository } from '@/data/repositories'
import { useSettings } from '@/lib/settings'

export function useConnectionHealth(connectionId: string | null) {
  const pingIntervalSec = useSettings((s) => s.pingIntervalSec)
  return useQuery({
    queryKey: ['connectionHealth', connectionId],
    queryFn: () => veloxDbRepository.pingConnection(connectionId!),
    enabled: Boolean(connectionId) && pingIntervalSec > 0,
    refetchInterval: pingIntervalSec * 1000,
    retry: 1,
    staleTime: Math.max(pingIntervalSec * 1000 - 5000, 5000),
  })
}
