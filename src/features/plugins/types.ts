import type { DomChartDefinition } from '@tanstack/charts'

import type { ChartType, DatabaseEngine, QueryResult, VizConfig } from '@/data/types'
import type { ColumnSchema } from '@/features/dashboards/data/column-analysis'

export type ConnectorPlugin = {
  /** Matches `DatabaseEngine` — the connection's saved engine. */
  id: DatabaseEngine
  name: string
  category: 'database'
  tier: 'community' | 'pro'
  /** False for engines that cannot run a dashboard SELECT (mongo, redis). */
  supportedForDashboards: boolean
}

export type DatasetFetchConfig = {
  connectionId: string
  sql: string
  maxRows?: number
}

/** Context passed to dataset providers — dashboard variable values for SQL substitution. */
export type DatasetProviderContext = {
  variables?: Record<string, string>
}

export type DatasetProviderPlugin = {
  id: 'sql-query'
  fetch(config: DatasetFetchConfig, ctx: DatasetProviderContext): Promise<QueryResult>
  inferSchema(config: DatasetFetchConfig, ctx: DatasetProviderContext): Promise<ColumnSchema[]>
}

export type KpiFormat = 'number' | 'currency' | 'percent' | 'duration'

export type KpiValue = {
  value: number | string | null
  label: string
  /** Comparison value (prior period or a second numeric column). */
  previous?: number | null
  /** `(value - previous) / |previous|` as a percentage; null when undefined. */
  deltaPct?: number | null
  /** Up to 12 trailing points for a sparkline, oldest first. */
  trend?: number[]
  format?: KpiFormat
  /** True when a decrease is good (churn, latency, errors); flips delta colouring. */
  invertDelta?: boolean
}

type VizPluginBase = {
  id: string
  /** Suitability score in [0, 1] for the given columns; used by the chart builder. */
  recommend(columns: ColumnSchema[]): number
}

/** Active click-to-filter selection: `{ column, value }` rendered as a highlight. */
export type ChartSelection = { column: string; value: string }

export type ChartBuildContext = {
  selection?: ChartSelection | null
}

export type ChartVizPlugin = VizPluginBase & {
  chartType: Exclude<ChartType, 'kpi'>
  buildChart(data: QueryResult, viz: VizConfig, context?: ChartBuildContext): DomChartDefinition
}

export type KpiVizPlugin = VizPluginBase & {
  id: 'kpi'
  chartType: 'kpi'
  buildKpi(data: QueryResult, viz: VizConfig): KpiValue
}

export type VizPlugin = ChartVizPlugin | KpiVizPlugin
