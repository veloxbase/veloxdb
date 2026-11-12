import type { ChartType, Dashboard, DashboardVariable, DatabaseEngine, TableInfo, VizConfig, WidgetKind } from '@/data/types'

export type GeneratedWidgetSpec = {
  title: string
  description?: string
  kind: 'chart' | 'kpi' | 'table'
  chartType?: ChartType
  encodings?: {
    x?: string | null
    y?: string[]
    series?: string | null
    size?: string | null
  }
  sql: string
}

export type GeneratedDashboardSpec = {
  name: string
  description?: string
  widgets: GeneratedWidgetSpec[]
}

export type DashboardGenerationStep =
  | 'idle'
  | 'introspecting'
  | 'synthesizing'
  | 'validating'
  | 'repairing'
  | 'composing'
  | 'done'
  | 'error'

export type ValidatedWidgetItem = {
  id: string
  title: string
  kind: WidgetKind
  sql: string
  viz: VizConfig | null
  rowCount: number
  columns: string[]
  /** Set when the validator rewrote the query or chart type; surfaced in the dialog. */
  notes?: string[]
  /** True when the model's SQL was repaired by a second LLM pass. */
  repaired?: boolean
}

export type FailedWidget = {
  title: string
  sql: string
  error: string
}

export type GenerateDashboardParams = {
  connectionId: string
  engine: DatabaseEngine
  databaseName?: string | null
  prompt: string
  selectedTable?: TableInfo | null
  model: string
  apiKey: string
  baseUrl?: string | null
  onStepChange?: (step: DashboardGenerationStep, detail?: string) => void
}

export type GenerateDashboardResult = {
  dashboard: Dashboard
  validatedWidgetsCount: number
  failedWidgetsCount: number
  failed: FailedWidget[]
  repairedWidgetsCount: number
  variables: DashboardVariable[]
}
