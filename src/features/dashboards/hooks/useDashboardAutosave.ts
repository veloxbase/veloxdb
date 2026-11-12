import { useEffect, useRef } from 'react'

import { toast } from '@/components/ui/use-toast'
import type { Dashboard } from '@/data/types'
import { pushCloudDashboard } from '@/features/dashboards/cloud-sync'
import { useSaveDashboardMutation } from '@/features/dashboards/queries'

const AUTOSAVE_DEBOUNCE_MS = 500

/**
 * Debounces `saveDashboard` calls so canvas edits (drag, rename, widget
 * changes) persist in the background without UI status.
 */
export function useDashboardAutosave(dashboard: Dashboard | null): void {
  const saveMutation = useSaveDashboardMutation()

  const saveMutationRef = useRef(saveMutation)
  saveMutationRef.current = saveMutation

  useEffect(() => {
    if (!dashboard) return

    const timer = setTimeout(() => {
      saveMutationRef.current.mutate(dashboard)
      void pushCloudDashboard(dashboard).then((result) => {
        if (result === 'conflict') {
          toast({
            variant: 'default',
            title: 'Dashboard conflict',
            description: 'This dashboard was updated on another machine. Reload to pull the latest copy.',
          })
        }
      })
    }, AUTOSAVE_DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [dashboard])
}
