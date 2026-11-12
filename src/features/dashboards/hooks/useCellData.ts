import { useQuery } from '@tanstack/react-query'

import { queryKeys } from '@/data/query-keys'
import type { NotebookCell, QueryResult } from '@/data/types'
import { hashVariables } from '@/features/dashboards/substitute-sql-variables'
import { getDatasetProvider } from '@/features/plugins/registry'
import { hashString } from '@/lib/hash-string'
import { useSettings } from '@/lib/settings'

/**
 * Executes a SQL notebook cell and caches the result by cellId + SQL hash + variables hash.
 * Multiple widgets that reference this cell will share the exact same cached query.
 */
export function useCellData(
  dashboardId: string,
  connectionId: string,
  cell: Extract<NotebookCell, { type: 'sql' }>,
  variableValues: Record<string, string> = {},
) {
  const maxQueryRows = useSettings((s) => s.maxQueryRows)
  const sqlHash = hashString(cell.sql ?? '')
  const varsHash = hashVariables(variableValues)

  return useQuery<QueryResult>({
    queryKey: queryKeys.cellData(dashboardId, cell.id, sqlHash, varsHash),
    queryFn: async () => {
      const provider = getDatasetProvider('sql-query')
      if (!provider) throw new Error('No dataset provider registered for "sql-query".')
      return provider.fetch(
        { connectionId, sql: cell.sql, maxRows: maxQueryRows },
        { variables: variableValues },
      )
    },
    enabled: Boolean(cell.sql?.trim() && connectionId),
    staleTime: 30_000,
  })
}
