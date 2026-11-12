import { useQuery } from '@tanstack/react-query'

import { queryKeys } from '@/data/query-keys'
import type { QueryResult, Widget } from '@/data/types'
import { hashVariables } from '@/features/dashboards/substitute-sql-variables'
import { getDatasetProvider } from '@/features/plugins/registry'
import { hashString } from '@/lib/hash-string'
import { useSettings } from '@/lib/settings'

/**
 * Fetches a dashboard widget's data by re-running its query at render time
 * (no row snapshots are persisted in the dashboard JSON). Cache key is scoped
 * to the widget's SQL so unrelated widgets on the same dashboard don't refetch.
 */
export function useWidgetData(
  dashboardId: string,
  widget: Widget,
  variableValues: Record<string, string> = {},
) {
  const maxQueryRows = useSettings((s) => s.maxQueryRows)
  const query = widget.query
  const sqlHash = hashString(query?.sql ?? '')
  const varsHash = hashVariables(variableValues)

  const queryKey = query?.sourceCellId
    ? queryKeys.cellData(dashboardId, query.sourceCellId, sqlHash, varsHash)
    : queryKeys.widgetData(dashboardId, widget.id, sqlHash, varsHash)

  return useQuery<QueryResult>({
    queryKey,
    queryFn: async () => {
      if (!query) throw new Error('This widget has no query configured.')
      const provider = getDatasetProvider(query.providerId)
      if (!provider) throw new Error(`No dataset provider registered for "${query.providerId}".`)
      return provider.fetch(
        { connectionId: query.connectionId, sql: query.sql, maxRows: maxQueryRows },
        { variables: variableValues },
      )
    },
    enabled: Boolean(query?.sql?.trim()),
    staleTime: 30_000,
  })
}
