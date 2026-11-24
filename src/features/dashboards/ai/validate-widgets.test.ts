import { describe, expect, it, vi } from 'vitest'

import type { LintSqlResult, QueryResult } from '@/data/types'
import type { GeneratedWidgetSpec } from './dashboard-generator-types'
import { applyQualityGates, extractSqlVariables, validateWidgets, type ValidateWidgetsDeps } from './validate-widgets'
import { analyzeColumns } from '@/features/dashboards/data/column-analysis'
import { coerceQueryResult } from '@/features/dashboards/data/typed-rows'

function result(columns: string[], rows: Array<Record<string, string | null>>, overrides: Partial<QueryResult> = {}): QueryResult {
  return {
    columns,
    rows,
    rowCount: rows.length,
    executionMs: 1,
    truncated: false,
    commandTag: null,
    ...overrides,
  }
}

const cleanLint: LintSqlResult = { diagnostics: [] }

function spec(overrides: Partial<GeneratedWidgetSpec> = {}): GeneratedWidgetSpec {
  return {
    title: 'Revenue by month',
    kind: 'chart',
    chartType: 'line',
    sql: 'SELECT month, revenue FROM sales',
    ...overrides,
  }
}

function monthlyRows(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    month: `2026-${String((i % 12) + 1).padStart(2, '0')}-01`,
    revenue: String(100 + i),
  }))
}

function deps(overrides: Partial<ValidateWidgetsDeps> = {}): ValidateWidgetsDeps {
  return {
    lintSql: vi.fn(async () => cleanLint),
    runReadonly: vi.fn(async () => result(['month', 'revenue'], monthlyRows(6))),
    complete: null,
    ...overrides,
  }
}

const baseInput = {
  dialect: 'PostgreSQL',
  formattingHint: '',
  profile: null,
  variableDefaults: { date_from: '2026-01-01', date_to: '2026-02-01' },
}

describe('extractSqlVariables', () => {
  it('returns unique placeholder names', () => {
    expect(extractSqlVariables('WHERE d >= {{date_from}} AND d < {{date_to}} AND d >= {{date_from}}')).toEqual([
      'date_from',
      'date_to',
    ])
  })
})

describe('validateWidgets', () => {
  it('validates a healthy widget without touching the LLM', async () => {
    const complete = vi.fn()
    const d = deps({ complete })
    const out = await validateWidgets({ ...baseInput, widgets: [spec()] }, d)

    expect(out.failed).toEqual([])
    expect(out.repairedCount).toBe(0)
    expect(complete).not.toHaveBeenCalled()
    expect(out.items).toHaveLength(1)
    expect(out.items[0]?.kind).toBe('chart')
    expect(out.items[0]?.viz?.chartType).toBe('line')
    expect(out.items[0]?.viz?.encodings.x?.column).toBe('month')
  })

  it('substitutes variable defaults before lint/run and reports used placeholders', async () => {
    const d = deps()
    const sql = "SELECT month, revenue FROM sales WHERE month >= '{{date_from}}' AND month < '{{date_to}}'"
    const out = await validateWidgets({ ...baseInput, widgets: [spec({ sql })] }, d)

    const ran = (d.runReadonly as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string
    expect(ran).not.toContain('{{')
    expect(ran).toContain('2026-01-01')
    expect(out.usedVariables).toEqual(['date_from', 'date_to'])
    // The stored SQL keeps the placeholders so the dashboard stays filterable.
    expect(out.items[0]?.sql).toBe(sql)
  })

  it('fails fast on unknown placeholders without running the query', async () => {
    const d = deps()
    const out = await validateWidgets(
      { ...baseInput, widgets: [spec({ sql: 'SELECT 1 WHERE x = {{mystery}}' })] },
      d,
    )
    expect(d.runReadonly).not.toHaveBeenCalled()
    expect(out.failed[0]?.error).toContain('{{mystery}}')
  })

  it('repairs once via the LLM and marks the widget repaired', async () => {
    const runReadonly = vi
      .fn<(sql: string, maxRows: number) => Promise<QueryResult>>()
      .mockRejectedValueOnce(new Error('column "revenu" does not exist'))
      .mockResolvedValueOnce(result(['month', 'revenue'], monthlyRows(3)))
    const complete = vi.fn(async () => JSON.stringify({ sql: 'SELECT month, revenue FROM sales', encodings: { x: 'month', y: ['revenue'] } }))
    const progress = vi.fn()

    const out = await validateWidgets(
      { ...baseInput, widgets: [spec({ sql: 'SELECT month, revenu FROM sales' })], onProgress: progress },
      deps({ runReadonly, complete }),
    )

    expect(complete).toHaveBeenCalledTimes(1)
    const [systemPrompt, userPrompt] = complete.mock.calls[0] as unknown as [string, string]
    expect(systemPrompt).toContain('PostgreSQL')
    expect(userPrompt).toContain('column "revenu" does not exist')
    expect(userPrompt).toContain('SELECT month, revenu FROM sales')

    expect(out.failed).toEqual([])
    expect(out.repairedCount).toBe(1)
    expect(out.items[0]?.repaired).toBe(true)
    expect(out.items[0]?.sql).toBe('SELECT month, revenue FROM sales')
    expect(progress).toHaveBeenCalledWith('repairing', expect.stringContaining('Repairing "Revenue by month"'))
  })

  it('marks the widget failed after the repaired SQL also fails', async () => {
    const runReadonly = vi
      .fn<(sql: string, maxRows: number) => Promise<QueryResult>>()
      .mockRejectedValueOnce(new Error('first failure'))
      .mockRejectedValueOnce(new Error('second failure'))
    const complete = vi.fn(async () => JSON.stringify({ sql: 'SELECT still_broken FROM sales' }))

    const out = await validateWidgets({ ...baseInput, widgets: [spec()] }, deps({ runReadonly, complete }))

    expect(out.items).toEqual([])
    expect(out.repairedCount).toBe(0)
    expect(out.failed).toEqual([
      { title: 'Revenue by month', sql: 'SELECT still_broken FROM sales', error: 'second failure' },
    ])
  })

  it('does not attempt repair when no LLM is configured', async () => {
    const runReadonly = vi.fn(async () => {
      throw new Error('boom')
    })
    const out = await validateWidgets({ ...baseInput, widgets: [spec()] }, deps({ runReadonly }))
    expect(runReadonly).toHaveBeenCalledTimes(1)
    expect(out.failed[0]?.error).toBe('boom')
  })

  it('treats lint errors as failures that go to repair', async () => {
    const lintSql = vi.fn(async () => ({
      diagnostics: [{ message: 'syntax error near FORM', severity: 'error' as const }],
    }))
    const complete = vi.fn(async () => JSON.stringify({ sql: 'SELECT month, revenue FROM sales' }))
    const runReadonly = vi.fn(async () => result(['month', 'revenue'], monthlyRows(2)))

    // Second lint call (repaired SQL) is clean.
    lintSql.mockResolvedValueOnce({ diagnostics: [{ message: 'syntax error near FORM', severity: 'error' }] })
    lintSql.mockResolvedValueOnce({ diagnostics: [] })

    const out = await validateWidgets(
      { ...baseInput, widgets: [spec({ sql: 'SELECT month, revenue FORM sales' })] },
      deps({ lintSql, complete, runReadonly }),
    )

    expect(runReadonly).toHaveBeenCalledTimes(1)
    expect(out.items[0]?.repaired).toBe(true)
    const userPrompt = (complete.mock.calls[0] as unknown as [string, string])[1]
    expect(userPrompt).toContain('syntax error near FORM')
  })

  it('ignores lint warnings and lint transport failures', async () => {
    const lintSql = vi.fn(async () => {
      throw new Error('lint service down')
    })
    const out = await validateWidgets({ ...baseInput, widgets: [spec()] }, deps({ lintSql }))
    expect(out.items).toHaveLength(1)
    expect(out.failed).toEqual([])
  })

  it('spends the repair budget on aggregation for dense time series and keeps the coarser result', async () => {
    const runReadonly = vi
      .fn<(sql: string, maxRows: number) => Promise<QueryResult>>()
      .mockResolvedValueOnce(result(['month', 'revenue'], monthlyRows(800)))
      .mockResolvedValueOnce(result(['month', 'revenue'], monthlyRows(12)))
    const complete = vi.fn(async () => JSON.stringify({ sql: "SELECT date_trunc('month', d) AS month, sum(revenue) AS revenue FROM sales GROUP BY 1" }))

    const out = await validateWidgets({ ...baseInput, widgets: [spec()] }, deps({ runReadonly, complete }))

    expect(complete).toHaveBeenCalledTimes(1)
    const userPrompt = (complete.mock.calls[0] as unknown as [string, string])[1]
    expect(userPrompt).toContain('Aggregate to a coarser period')
    expect(out.items[0]?.rowCount).toBe(12)
    expect(out.items[0]?.repaired).toBe(true)
    expect(out.repairedCount).toBe(1)
  })

  it('keeps the dense series when the aggregation attempt fails', async () => {
    const runReadonly = vi
      .fn<(sql: string, maxRows: number) => Promise<QueryResult>>()
      .mockResolvedValueOnce(result(['month', 'revenue'], monthlyRows(800)))
      .mockRejectedValueOnce(new Error('bad aggregate'))
    const complete = vi.fn(async () => JSON.stringify({ sql: 'SELECT broken' }))

    const out = await validateWidgets({ ...baseInput, widgets: [spec()] }, deps({ runReadonly, complete }))

    expect(out.failed).toEqual([])
    expect(out.items[0]?.rowCount).toBe(800)
    expect(out.items[0]?.repaired).toBeUndefined()
  })
})

describe('applyQualityGates', () => {
  function gate(widget: GeneratedWidgetSpec, res: QueryResult) {
    return applyQualityGates(widget, res, analyzeColumns(coerceQueryResult(res)))
  }

  it('downgrades a pie with too many slices to horizontal bars', () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ country: `C${i}`, total: String(i * 10) }))
    const out = gate(spec({ chartType: 'pie' }), result(['country', 'total'], rows))
    expect(out.chartType).toBe('horizontalBar')
    expect(out.notes[0]).toContain('too many')
  })

  it('keeps a pie with few slices', () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ country: `C${i}`, total: String(i * 10) }))
    const out = gate(spec({ chartType: 'donut' }), result(['country', 'total'], rows))
    expect(out.chartType).toBe('donut')
  })

  it('falls back to a table when there is no numeric column', () => {
    const out = gate(spec({ chartType: 'bar' }), result(['name', 'email'], [{ name: 'a', email: 'a@x' }]))
    expect(out.kind).toBe('table')
    expect(out.chartType).toBe('table')
    expect(out.notes[0]).toContain('No numeric column')
  })

  it('falls back to a table when there are too many columns', () => {
    const columns = Array.from({ length: 45 }, (_, i) => `c${i}`)
    const row = Object.fromEntries(columns.map((c) => [c, '1']))
    const out = gate(spec({ chartType: 'bar' }), result(columns, [row]))
    expect(out.kind).toBe('table')
    expect(out.notes[0]).toContain('Too many columns')
  })

  it('downgrades a multi-row non-temporal KPI to a bar chart', () => {
    const rows = [{ status: 'open', n: '3' }, { status: 'closed', n: '5' }, { status: 'blocked', n: '1' }]
    const out = gate(spec({ kind: 'kpi', chartType: 'kpi' }), result(['status', 'n'], rows))
    expect(out.kind).toBe('chart')
    expect(out.chartType).toBe('bar')
    expect(out.notes[0]).toContain('KPI query returned 3 rows')
  })

  it('keeps a multi-row temporal KPI as a period KPI', () => {
    const out = gate(spec({ kind: 'kpi', chartType: 'kpi' }), result(['month', 'revenue'], monthlyRows(6)))
    expect(out.kind).toBe('kpi')
    expect(out.chartType).toBe('kpi')
  })

  it('flags dense time series for aggregation and truncated results with a warning option', () => {
    const out = gate(spec(), result(['month', 'revenue'], monthlyRows(600), { truncated: true }))
    expect(out.needsAggregation).toBe(true)
    expect(out.options.truncatedWarning).toBe(true)
    expect(out.notes.some((n) => n.includes('truncated'))).toBe(true)
  })

  it('keeps the model chart type for an empty result', () => {
    const out = gate(spec({ chartType: 'area' }), result(['month', 'revenue'], []))
    expect(out.kind).toBe('chart')
    expect(out.chartType).toBe('area')
  })
})
