import { useEffect } from 'react'

import { useQueryClient } from '@tanstack/react-query'

/**
 * Periodically invalidates all widget data queries for a dashboard.
 * Pauses when the document is hidden.
 */
export function useDashboardRefresh(dashboardId: string | null, intervalSec: number | null) {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!dashboardId || !intervalSec || intervalSec <= 0) return

    const tick = () => {
      if (document.hidden) return
      void queryClient.invalidateQueries({ queryKey: ['widgetData', dashboardId] })
      void queryClient.invalidateQueries({ queryKey: ['cellData', dashboardId] })
    }

    const id = window.setInterval(tick, intervalSec * 1000)
    return () => window.clearInterval(id)
  }, [dashboardId, intervalSec, queryClient])
}
