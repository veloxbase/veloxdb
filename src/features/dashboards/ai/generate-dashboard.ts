import { veloxDbRepository } from '@/data/repositories'
import type { DatabaseEngine } from '@/data/types'
import { GENERATED_CHART_TYPES, isGeneratedChartType } from '@/features/dashboards/chart-type-labels'
import {
  buildDashboardVariables,
  defaultVariableValues,
  dimensionPlaceholders,
  distinctValuesSql,
  renderVariableInstructions,
  MAX_SELECT_OPTIONS,
  type DimensionPlaceholder,
} from './auto-variables'
import { composeDashboardGrid } from './dashboard-grid-composer'
import type {
  GenerateDashboardParams,
  GenerateDashboardResult,
  GeneratedDashboardSpec,
} from './dashboard-generator-types'
import { bindLlmCompletion, extractJsonObject } from './llm-completion'
import { buildSchemaProfile, renderSchemaProfile, type SchemaProfile } from './schema-profile'
import { validateWidgets } from './validate-widgets'

export function dialectName(engine: DatabaseEngine): string {
  if (engine === 'postgres') return 'PostgreSQL'
  if (engine === 'mysql') return 'MySQL'
  if (engine === 'sqlite') return 'SQLite'
  if (engine === 'duckdb') return 'DuckDB'
  if (engine === 'clickhouse') return 'ClickHouse SQL'
  if (engine === 'libsql') return 'LibSQL (SQLite)'
  if (engine === 'turso') return 'Turso (SQLite)'
  if (engine === 'mssql' || engine === 'azuresql') return 'Microsoft SQL Server (T-SQL)'
  return engine
}

export function dialectFormattingHint(engine: DatabaseEngine): string {
  if (engine === 'postgres') {
    return "Use PostgreSQL syntax: DATE_TRUNC('month', timestamp_col), EXTRACT(year FROM col), COALESCE(), COUNT(*), SUM(), AVG()."
  }
  if (engine === 'mysql') {
    return "Use MySQL syntax: DATE_FORMAT(timestamp_col, '%Y-%m'), IFNULL(), COUNT(*), SUM(), AVG()."
  }
  if (engine === 'sqlite' || engine === 'libsql' || engine === 'turso') {
    return "Use SQLite syntax: strftime('%Y-%m', timestamp_col), IFNULL(), COUNT(*), SUM(), AVG()."
  }
  if (engine === 'mssql' || engine === 'azuresql') {
    return "Use T-SQL syntax: SELECT TOP N instead of LIMIT, [brackets] for identifiers, GETDATE(), DATEPART()."
  }
  if (engine === 'clickhouse') {
    return "Use ClickHouse syntax: toYYYYMM(timestamp_col), countIf(), uniqExact(), LIMIT N."
  }
  return "Use standard ANSI SQL aggregates: COUNT(*), SUM(), AVG(), MIN(), MAX(), GROUP BY, ORDER BY."
}

export function parseGeneratedDashboardJson(raw: string): GeneratedDashboardSpec {
  const parsed = extractJsonObject(raw)

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid dashboard specification format.')
  }

  const data = parsed as Record<string, unknown>
  const name = typeof data.name === 'string' && data.name.trim() ? data.name.trim() : 'Executive Dashboard'
  const description = typeof data.description === 'string' ? data.description.trim() : ''
  const rawWidgets = Array.isArray(data.widgets) ? data.widgets : []

  const widgets = rawWidgets
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .map((item) => {
      const title = typeof item.title === 'string' && item.title.trim() ? item.title.trim() : 'Metric'
      const description = typeof item.description === 'string' ? item.description.trim() : undefined
      const kind: 'chart' | 'kpi' | 'table' =
        item.kind === 'kpi' || item.kind === 'table' ? item.kind : 'chart'
      const chartType = typeof item.chartType === 'string' && isGeneratedChartType(item.chartType)
        ? item.chartType
        : undefined
      const rawEncodings = item.encodings && typeof item.encodings === 'object'
        ? item.encodings as Record<string, unknown>
        : null
      const encodings = rawEncodings
        ? {
            x: typeof rawEncodings.x === 'string' ? rawEncodings.x : rawEncodings.x === null ? null : undefined,
            y: Array.isArray(rawEncodings.y)
              ? rawEncodings.y.filter((value): value is string => typeof value === 'string')
              : undefined,
            series: typeof rawEncodings.series === 'string'
              ? rawEncodings.series
              : rawEncodings.series === null
                ? null
                : undefined,
            size: typeof rawEncodings.size === 'string' ? rawEncodings.size : undefined,
          }
        : undefined
      let sql = typeof item.sql === 'string' ? item.sql.trim() : ''
      if (sql.endsWith(';')) sql = sql.slice(0, -1).trim()
      return { title, description, kind, chartType, encodings, sql }
    })
    .filter((w) => w.sql.length > 0)

  if (widgets.length === 0) {
    throw new Error('No valid queries were generated for the dashboard.')
  }

  return { name, description, widgets }
}

export function buildGenerationSystemPrompt(input: {
  dialect: string
  formatting: string
  hasTimeColumn: boolean
  variableInstructions: string
}): string {
  const { dialect, formatting, hasTimeColumn, variableInstructions } = input
  return `You are an expert BI data architect. Design a comprehensive analytical dashboard in ${dialect} for VeloxDB based on the user's requirements.

Rules:
1. Write strictly single read-only SELECT queries for ${dialect}. ${formatting}
2. Never invent tables or columns that do not exist in the schema profile below. Prefer FACT tables for measures and join to DIMENSION tables through the listed join paths. Use the enum values listed for status-like filters.
3. Formulate between 4 and 7 distinct, complementary metrics:
   - 2 or 3 KPI cards (kind: "kpi").${hasTimeColumn ? ' Return each KPI as a period series so it can show a delta and sparkline: SELECT <period> AS period, <measure> AS value ... GROUP BY period ORDER BY period (monthly or weekly, 6-13 rows). Only use a single-row aggregate when no time column applies.' : ''}
   - 1 time-series trend (chartType: "line", "area", or "combo" when comparing two measures).
   - 1 or 2 categorical breakdowns. Use "bar" with encodings.series for stacked mix (e.g. revenue by month split by plan). Use "pie"/"donut" only for at most 8 slices. Use "heatmap" for two categories + one measure. Use "scatter" for two numerics. Use "histogram" for a raw numeric distribution. Use "box" for category vs many raw observations. Use "treemap" for many-category share. Use "waterfall" for signed step contributions.
   - Optional 1 detail summary table (kind: "table").
4. Keep query outputs clean with meaningful column aliases (e.g. AS period, AS total_amount, AS category). Return long-form rows when a series dimension exists (period, series, value) instead of wide pivoted columns. Cap categorical breakdowns with ORDER BY measure DESC and a limit of 12-20 rows. Time series should return at most 200 rows.
5. Always include encodings that match the SELECT aliases: x, y (array), optional series, optional size for scatter bubbles.
${variableInstructions ? `6. ${variableInstructions.replace(/\n/g, '\n   ')}\n7.` : '6.'} Output ONLY valid JSON matching this schema:
{
  "name": "Dashboard Title",
  "description": "Short summary of what this dashboard tracks",
  "widgets": [
    {
      "title": "Widget Title",
      "kind": "kpi" | "chart" | "table",
      "chartType": ${GENERATED_CHART_TYPES.map((type) => `"${type}"`).join(' | ')},
      "encodings": { "x": "column", "y": ["measure"], "series": "optional_group" },
      "sql": "SELECT ... "
    }
  ]
}`
}

async function sampleDimensionOptions(
  connectionId: string,
  dialect: string,
  placeholders: DimensionPlaceholder[],
  usedVariables: string[],
): Promise<Record<string, string[]>> {
  const used = new Set(usedVariables)
  const out: Record<string, string[]> = {}
  await Promise.all(
    placeholders
      .filter((placeholder) => used.has(placeholder.name) && !placeholder.values)
      .map(async (placeholder) => {
        try {
          const result = await veloxDbRepository.veloxyRunReadonly({
            connectionId,
            sql: distinctValuesSql(placeholder.table, placeholder.column, dialect),
            maxRows: MAX_SELECT_OPTIONS,
          })
          const column = result.columns[0]
          if (!column) return
          out[placeholder.name] = result.rows
            .map((row) => row[column])
            .filter((value): value is string => typeof value === 'string' && value.length > 0)
        } catch {
          // Options are a convenience; fall back to a free-text variable.
        }
      }),
  )
  return out
}

export async function generateAutonomousDashboard(
  params: GenerateDashboardParams,
): Promise<GenerateDashboardResult> {
  const {
    connectionId,
    engine,
    databaseName,
    prompt,
    selectedTable,
    model,
    apiKey,
    baseUrl,
    authMode,
    onStepChange,
  } = params

  // 1. Introspect + profile schema
  onStepChange?.('introspecting', 'Reading database tables, columns, and relationships...')
  const [metadata, foreignKeys] = await Promise.all([
    veloxDbRepository.getQueryEditorMetadata(connectionId),
    veloxDbRepository.getForeignKeys(connectionId),
  ])
  const profile: SchemaProfile = buildSchemaProfile(metadata, foreignKeys, selectedTable ?? null)
  onStepChange?.(
    'introspecting',
    `Profiled ${profile.tables.length} tables (${profile.tables.filter((t) => t.role === 'fact').length} fact, ${profile.tables.filter((t) => t.role !== 'fact').length} dimension).`,
  )

  // 2. Synthesize Dashboard Queries
  onStepChange?.('synthesizing', 'Synthesizing analytical metrics, KPIs, and charts...')
  const dialect = dialectName(engine)
  const formatting = dialectFormattingHint(engine)
  const placeholders = dimensionPlaceholders(profile)
  const variableInstructions = renderVariableInstructions(profile, placeholders)
  const variableDefaults = defaultVariableValues(placeholders)

  const systemPrompt = buildGenerationSystemPrompt({
    dialect,
    formatting,
    hasTimeColumn: Boolean(profile.primaryTimeColumn),
    variableInstructions,
  })

  const userPrompt = `Database Engine: ${dialect}
Database Name: ${databaseName || 'default'}
${selectedTable ? `Target Table of Focus: ${selectedTable.schema}.${selectedTable.name}` : ''}

Goal: ${prompt.trim()}

Schema profile:
${renderSchemaProfile(profile)}`

  const complete = bindLlmCompletion({ model, apiKey, baseUrl, authMode })
  const rawCompletion = await complete(systemPrompt, userPrompt)
  const spec = parseGeneratedDashboardJson(rawCompletion)

  // 3. Lint → run → repair → quality gates
  onStepChange?.('validating', `Executing and verifying ${spec.widgets.length} queries...`)
  const validation = await validateWidgets(
    {
      widgets: spec.widgets,
      dialect,
      formattingHint: formatting,
      profile,
      variableDefaults,
      onProgress: (step, detail) => onStepChange?.(step, detail),
    },
    {
      lintSql: (sql) => veloxDbRepository.lintSql({ connectionId, sql }),
      runReadonly: (sql, maxRows) => veloxDbRepository.veloxyRunReadonly({ connectionId, sql, maxRows }),
      complete,
    },
  )

  if (validation.items.length === 0) {
    const first = validation.failed[0]
    throw new Error(
      `All generated queries failed validation against your database.${first ? ` First error: ${first.error}` : ''} Try rephrasing your prompt.`,
    )
  }

  // 4. Compose grid layout + filters
  onStepChange?.('composing', `Assembling grid layout for ${validation.items.length} verified widgets...`)
  const sampledOptions = await sampleDimensionOptions(connectionId, dialect, placeholders, validation.usedVariables)
  const variables = buildDashboardVariables(validation.usedVariables, placeholders, sampledOptions, variableDefaults)
  const dashboard = composeDashboardGrid(connectionId, spec.name, spec.description, validation.items, variables)

  onStepChange?.('done', 'Dashboard generated successfully!')

  return {
    dashboard,
    validatedWidgetsCount: validation.items.length,
    failedWidgetsCount: validation.failed.length,
    failed: validation.failed,
    repairedWidgetsCount: validation.repairedCount,
    variables,
  }
}
