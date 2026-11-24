import { veloxDbRepository } from '@/data/repositories'
import type { QueryResult } from '@/data/types'
import { analyzeColumns } from '@/features/dashboards/data/column-analysis'
import { substituteSqlVariables } from '@/features/dashboards/substitute-sql-variables'
import { coerceQueryResult } from '@/features/dashboards/data/typed-rows'
import type { DatasetFetchConfig, DatasetProviderPlugin } from '@/features/plugins/types'
import { useSettings } from '@/lib/settings'

async function fetchSqlQuery(
  config: DatasetFetchConfig,
  variables: Record<string, string> = {},
): Promise<QueryResult> {
  const sql = substituteSqlVariables(config.sql, variables)
  return veloxDbRepository.runQuery({
    connectionId: config.connectionId,
    sql,
    maxRows: config.maxRows ?? useSettings.getState().maxQueryRows,
    allowWrite: false,
  })
}

/** Wraps the existing `run_query` command; write statements are rejected (`allowWrite: false`). */
export const sqlQueryProvider: DatasetProviderPlugin = {
  id: 'sql-query',
  fetch: (config, ctx) => fetchSqlQuery(config, ctx.variables ?? {}),
  inferSchema: async (config, ctx) =>
    analyzeColumns(coerceQueryResult(await fetchSqlQuery(config, ctx.variables ?? {}))),
}
