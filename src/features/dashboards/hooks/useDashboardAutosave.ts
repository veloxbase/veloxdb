import { useEffect, useRef } from 'react'

import type { Dashboard } from '@/data/types'
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
    }, AUTOSAVE_DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [dashboard])
}
