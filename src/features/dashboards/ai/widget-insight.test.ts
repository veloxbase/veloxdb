import { describe, expect, it } from 'vitest'

import type { QueryResult, VizConfig } from '@/data/types'
import { buildWidgetInsight, kpiInsight } from './widget-insight'

function result(columns: string[], rows: Array<Record<string, string | null>>, truncated = false): QueryResult {
  return { columns, rows, rowCount: rows.length, executionMs: 1, truncated, commandTag: null }
}

function series(values: number[], column = 'revenue'): QueryResult {
  return result(
    ['period', column],
    values.map((value, i) => ({ period: new Date(Date.UTC(2024, i, 1)).toISOString(), [column]: String(value) })),
  )
}

const lineViz: VizConfig = { chartType: 'line', encodings: { x: { column: 'period' }, y: [{ column: 'revenue' }] }, options: {} }

describe('buildWidgetInsight', () => {
  it('calls out a spike against the median', () => {
    const insight = buildWidgetInsight(series([10, 12, 11, 60, 12, 13]), lineViz)
    expect(insight?.tone).toBe('warn')
    expect(insight?.text).toContain('Peak')
    expect(insight?.text).toContain('× the median')
  })

  it('reports last vs previous with a streak', () => {
    const insight = buildWidgetInsight(series([10, 11, 12, 13, 14]), lineViz)
    expect(insight?.tone).toBe('up')
    expect(insight?.text).toMatch(/^Up 7\.7% to \$14/)
    expect(insight?.text).toContain('4 periods rising')
  })

  it('inverts tone for churn-like metrics', () => {
    const viz: VizConfig = { chartType: 'line', encodings: { x: { column: 'period' }, y: [{ column: 'churn_rate' }] }, options: {} }
    const insight = buildWidgetInsight(series([0.1, 0.12, 0.15], 'churn_rate'), viz)
    expect(insight?.tone).toBe('down')
  })

  it('reports the dominant category share', () => {
    const res = result(['plan', 'revenue'], [
      { plan: 'pro', revenue: '700' },
      { plan: 'team', revenue: '200' },
      { plan: 'free', revenue: '100' },
    ])
    const viz: VizConfig = { chartType: 'bar', encodings: { x: { column: 'plan' }, y: [{ column: 'revenue' }] }, options: {} }
    const insight = buildWidgetInsight(res, viz)
    expect(insight?.text).toBe('pro accounts for 70% of revenue.')
  })

  it('reports top share plus long tail when nothing dominates', () => {
    const res = result(['plan', 'orders'], [
      { plan: 'a', orders: '30' },
      { plan: 'b', orders: '28' },
      { plan: 'c', orders: '25' },
      { plan: 'd', orders: '2' },
      { plan: 'e', orders: '1' },
    ])
    const insight = buildWidgetInsight(res, null)
    expect(insight?.text).toContain('Top: a at 35%')
    expect(insight?.text).toContain('2 categories under 5%')
  })

  it('warns on a high null rate before anything else', () => {
    const res = result(['plan', 'revenue'], [
      { plan: 'a', revenue: null },
      { plan: 'b', revenue: null },
      { plan: 'c', revenue: '5' },
      { plan: 'd', revenue: '7' },
    ])
    const insight = buildWidgetInsight(res, null)
    expect(insight?.tone).toBe('warn')
    expect(insight?.text).toContain('50% of revenue values are null')
  })

  it('warns when the result was truncated', () => {
    const insight = buildWidgetInsight(result(['x', 'y'], [{ x: 'a', y: '1' }], true), null)
    expect(insight).toEqual({ text: 'Showing the first 1 rows; result was truncated.', tone: 'warn' })
  })

  it('returns null for empty results', () => {
    expect(buildWidgetInsight(result(['x'], []), null)).toBeNull()
  })
})

describe('kpiInsight', () => {
  it('builds a delta sentence', () => {
    expect(kpiInsight({ value: 120, label: 'orders', previous: 100, deltaPct: 20, format: 'number' })).toEqual({
      text: 'Up 20% from 100.',
      tone: 'up',
    })
  })

  it('returns null without a comparison', () => {
    expect(kpiInsight({ value: 5, label: 'x' })).toBeNull()
  })
})
