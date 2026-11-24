import type { ChartType, LintSqlResult, QueryResult, VizConfig } from '@/data/types'
import { VELOXY_MAX_CHART_ROWS } from '@/data/types'
import { buildVizConfig, resolveEncodings } from '@/features/dashboards/chart-builder-state'
import { isGeneratedChartType } from '@/features/dashboards/chart-type-labels'
import { analyzeColumns, recommendChartType, type ColumnSchema } from '@/features/dashboards/data/column-analysis'
import { coerceQueryResult } from '@/features/dashboards/data/typed-rows'
import { substituteSqlVariables } from '@/features/dashboards/substitute-sql-variables'
import type { FailedWidget, GeneratedWidgetSpec, ValidatedWidgetItem } from './dashboard-generator-types'
import { extractJsonObject, type LlmCompletion } from './llm-completion'
import { renderProfileForSql, type SchemaProfile } from './schema-profile'

export type ValidateWidgetsDeps = {
  lintSql: (sql: string) => Promise<LintSqlResult>
  runReadonly: (sql: string, maxRows: number) => Promise<QueryResult>
  /** LLM used for the single repair pass. `null` disables repair. */
  complete: LlmCompletion | null
}

export type ValidateWidgetsInput = {
  widgets: GeneratedWidgetSpec[]
  dialect: string
  formattingHint: string
  profile: SchemaProfile | null
  /** Values substituted for `{{name}}` placeholders before lint/run. */
  variableDefaults: Record<string, string>
  onProgress?: (step: 'validating' | 'repairing', detail: string) => void
}

export type ValidateWidgetsResult = {
  items: ValidatedWidgetItem[]
  failed: FailedWidget[]
  /** Placeholder names that appear in at least one validated query. */
  usedVariables: string[]
  repairedCount: number
}

const PIE_MAX_SLICES = 8
const TABLE_MAX_COLUMNS = 40
const TIME_SERIES_MAX_ROWS = 500

export function extractSqlVariables(sql: string): string[] {
  const names = new Set<string>()
  for (const match of sql.matchAll(/\{\{(\w+)\}\}/g)) {
    if (match[1]) names.add(match[1])
  }
  return [...names]
}

type RunOutcome = {
  result: QueryResult
  analyzed: ColumnSchema[]
}

class WidgetValidationError extends Error {}

async function lintAndRun(
  sql: string,
  variableDefaults: Record<string, string>,
  deps: ValidateWidgetsDeps,
): Promise<RunOutcome> {
  const substituted = substituteSqlVariables(sql, variableDefaults)
  const unresolved = extractSqlVariables(substituted)
  if (unresolved.length > 0) {
    throw new WidgetValidationError(`Unknown placeholder(s): ${unresolved.map((name) => `{{${name}}}`).join(', ')}. Only {{date_from}}, {{date_to}} and listed dimensions are allowed.`)
  }

  let lint: LintSqlResult | null = null
  try {
    lint = await deps.lintSql(substituted)
  } catch {
    // Lint is best-effort; a lint transport failure should not block execution.
  }
  const lintErrors = lint?.diagnostics.filter((d) => d.severity === 'error') ?? []
  if (lintErrors.length > 0) {
    throw new WidgetValidationError(lintErrors.map((d) => d.message).join('; '))
  }

  const result = await deps.runReadonly(substituted, VELOXY_MAX_CHART_ROWS)
  if (!result.columns || result.columns.length === 0) {
    throw new WidgetValidationError('Query returned no columns.')
  }
  return { result, analyzed: analyzeColumns(coerceQueryResult(result)) }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'Unknown error'
}

function repairSystemPrompt(dialect: string, formattingHint: string): string {
  return `You repair a single failing BI SQL query for ${dialect}. ${formattingHint}
Rules:
- Return ONLY JSON: {"sql": "SELECT ...", "encodings": {"x": "col", "y": ["col"], "series": "col"}}. encodings is optional.
- Keep the analytical intent of the original widget. Fix only what the error requires (wrong column/table names, dialect functions, grouping, aliases).
- Never invent tables or columns that are not in the schema snippet.
- Read-only SELECT only. Keep {{date_from}}, {{date_to}} and other {{placeholders}} exactly as written.
- If asked to aggregate, reduce rows by grouping to a coarser period (week/month) or limiting to the top N categories.`
}

function repairUserPrompt(spec: GeneratedWidgetSpec, error: string, profileSnippet: string): string {
  return `Widget: ${spec.title} (${spec.kind}${spec.chartType ? `, ${spec.chartType}` : ''})
Original SQL:
${spec.sql}

Error:
${error}

Relevant schema:
${profileSnippet}`
}

function parseRepair(raw: string): { sql: string; encodings?: GeneratedWidgetSpec['encodings'] } {
  const parsed = extractJsonObject(raw)
  if (!parsed || typeof parsed !== 'object') throw new Error('Repair response was not an object.')
  const data = parsed as Record<string, unknown>
  let sql = typeof data.sql === 'string' ? data.sql.trim() : ''
  if (sql.endsWith(';')) sql = sql.slice(0, -1).trim()
  if (!sql) throw new Error('Repair response did not include SQL.')
  const rawEncodings = data.encodings && typeof data.encodings === 'object' ? data.encodings as Record<string, unknown> : null
  const encodings = rawEncodings
    ? {
        x: typeof rawEncodings.x === 'string' ? rawEncodings.x : undefined,
        y: Array.isArray(rawEncodings.y) ? rawEncodings.y.filter((v): v is string => typeof v === 'string') : undefined,
        series: typeof rawEncodings.series === 'string' ? rawEncodings.series : undefined,
        size: typeof rawEncodings.size === 'string' ? rawEncodings.size : undefined,
      }
    : undefined
  return { sql, encodings }
}

type GateOutcome = {
  kind: ValidatedWidgetItem['kind']
  chartType: ChartType | 'table'
  notes: string[]
  options: Record<string, unknown>
  needsAggregation: boolean
}

/** Heuristic quality gates run on a successful result. No LLM involved. */
export function applyQualityGates(
  spec: GeneratedWidgetSpec,
  result: QueryResult,
  analyzed: ColumnSchema[],
): GateOutcome {
  const notes: string[] = []
  const options: Record<string, unknown> = {}
  const numerics = analyzed.filter((c) => c.role === 'numeric')
  const temporal = analyzed.find((c) => c.role === 'temporal')
  const categoricals = analyzed.filter((c) => c.role === 'categorical')

  let kind: ValidatedWidgetItem['kind'] = spec.kind === 'kpi' ? 'kpi' : spec.kind === 'table' ? 'table' : 'chart'
  let chartType: ChartType | 'table' = spec.kind === 'kpi'
    ? 'kpi'
    : spec.kind === 'table'
      ? 'table'
      : spec.chartType && isGeneratedChartType(spec.chartType)
        ? spec.chartType
        : recommendChartType(analyzed)

  // An empty result has no roles to judge; keep the model's chart type so a wider filter still renders a chart.
  if (kind !== 'table' && (result.columns.length > TABLE_MAX_COLUMNS || (numerics.length === 0 && result.rowCount > 0))) {
    notes.push(numerics.length === 0 ? 'No numeric column to plot; shown as a table.' : 'Too many columns to chart; shown as a table.')
    kind = 'table'
    chartType = 'table'
  }

  if (kind === 'kpi' && result.rowCount > 2 && !temporal) {
    const recommended = recommendChartType(analyzed)
    chartType = recommended === 'table' || recommended === 'kpi' ? 'bar' : recommended
    kind = 'chart'
    notes.push(`KPI query returned ${result.rowCount} rows; shown as a ${chartType} chart.`)
  }

  if ((chartType === 'pie' || chartType === 'donut') && kind === 'chart') {
    const category = categoricals[0]
    const distinct = category?.distinctCount ?? result.rowCount
    if (distinct > PIE_MAX_SLICES) {
      chartType = 'horizontalBar'
      notes.push(`${distinct} slices is too many for a ${spec.chartType}; shown as horizontal bars.`)
    }
  }

  const isTimeSeries = kind === 'chart' && Boolean(temporal) && (chartType === 'line' || chartType === 'area' || chartType === 'combo')
  const needsAggregation = isTimeSeries && result.rowCount > TIME_SERIES_MAX_ROWS

  if (result.truncated) {
    options.truncatedWarning = true
    notes.push(`Result truncated to ${result.rows.length} rows.`)
  }

  return { kind, chartType, notes, options, needsAggregation }
}

function buildItem(
  spec: GeneratedWidgetSpec,
  outcome: RunOutcome,
  gate: GateOutcome,
  repaired: boolean,
): ValidatedWidgetItem {
  const finalChartType = gate.chartType === 'table' ? null : gate.chartType
  let viz: VizConfig | null = null
  if (finalChartType) {
    const encodings = resolveEncodings(outcome.analyzed, finalChartType, spec.encodings)
    viz = { ...buildVizConfig(finalChartType, encodings, gate.options), chartType: finalChartType }
  }
  return {
    id: crypto.randomUUID(),
    title: spec.title,
    kind: gate.kind,
    sql: spec.sql,
    viz,
    rowCount: outcome.result.rowCount,
    columns: outcome.result.columns,
    notes: gate.notes.length > 0 ? gate.notes : undefined,
    repaired: repaired || undefined,
  }
}

export async function validateWidgets(
  input: ValidateWidgetsInput,
  deps: ValidateWidgetsDeps,
): Promise<ValidateWidgetsResult> {
  const items: ValidatedWidgetItem[] = []
  const failed: FailedWidget[] = []
  const usedVariables = new Set<string>()
  let repairedCount = 0
  const total = input.widgets.length

  const repairOnce = async (spec: GeneratedWidgetSpec, error: string, index: number): Promise<GeneratedWidgetSpec | null> => {
    if (!deps.complete) return null
    input.onProgress?.('repairing', `Repairing "${spec.title}" (${index + 1}/${total})...`)
    const snippet = input.profile ? renderProfileForSql(input.profile, spec.sql) : '(schema unavailable)'
    try {
      const raw = await deps.complete(
        repairSystemPrompt(input.dialect, input.formattingHint),
        repairUserPrompt(spec, error, snippet),
      )
      const fixed = parseRepair(raw)
      return { ...spec, sql: fixed.sql, encodings: fixed.encodings ?? spec.encodings }
    } catch {
      return null
    }
  }

  for (let index = 0; index < input.widgets.length; index++) {
    const original = input.widgets[index]
    if (!original) continue
    input.onProgress?.('validating', `Validating "${original.title}" (${index + 1}/${total})...`)

    let spec = original
    let repaired = false
    let outcome: RunOutcome | null = null
    let lastError = ''

    try {
      outcome = await lintAndRun(spec.sql, input.variableDefaults, deps)
    } catch (error) {
      lastError = errorMessage(error)
      const fixedSpec = await repairOnce(spec, lastError, index)
      if (fixedSpec) {
        spec = fixedSpec
        try {
          outcome = await lintAndRun(fixedSpec.sql, input.variableDefaults, deps)
          repaired = true
        } catch (retryError) {
          lastError = errorMessage(retryError)
        }
      }
    }

    if (!outcome) {
      failed.push({ title: original.title, sql: spec.sql, error: lastError || 'Query failed.' })
      continue
    }

    let gate = applyQualityGates(spec, outcome.result, outcome.analyzed)

    // Spend the repair budget on aggregation when a time series is too dense.
    if (gate.needsAggregation && !repaired) {
      const fixedSpec = await repairOnce(
        spec,
        `Time series returned ${outcome.result.rowCount} rows (max ${TIME_SERIES_MAX_ROWS}). Aggregate to a coarser period so the chart stays readable.`,
        index,
      )
      if (fixedSpec) {
        try {
          const retry = await lintAndRun(fixedSpec.sql, input.variableDefaults, deps)
          const retryGate = applyQualityGates(fixedSpec, retry.result, retry.analyzed)
          if (retry.result.rowCount <= outcome.result.rowCount) {
            outcome = retry
            spec = fixedSpec
            gate = retryGate
            repaired = true
          }
        } catch {
          // Keep the original dense series rather than failing the widget.
        }
      }
    }

    if (repaired) repairedCount++
    for (const name of extractSqlVariables(spec.sql)) usedVariables.add(name)
    items.push(buildItem(spec, outcome, gate, repaired))
  }

  return { items, failed, usedVariables: [...usedVariables], repairedCount }
}
