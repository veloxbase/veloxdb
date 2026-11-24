import { describe, expect, it } from 'vitest'

import type { QueryResult, VizConfig } from '@/data/types'
import { computeDeltaPct, formatKpiValue, inferKpiFormat, isInvertedMetric, kpiPlugin } from './kpi'

function result(columns: string[], rows: Array<Record<string, string | null>>): QueryResult {
  return { columns, rows, rowCount: rows.length, executionMs: 1, truncated: false, commandTag: null }
}

const viz = (y: string[], x?: string, options: Record<string, unknown> = {}): VizConfig => ({
  chartType: 'kpi',
  encodings: { y: y.map((column) => ({ column })), x: x ? { column: x } : undefined },
  options,
})

describe('kpiPlugin.buildKpi', () => {
  it('shape 1: single row, single numeric', () => {
    const kpi = kpiPlugin.buildKpi(result(['total_revenue'], [{ total_revenue: '1250.5' }]), viz(['total_revenue']))
    expect(kpi.value).toBe(1250.5)
    expect(kpi.previous).toBeUndefined()
    expect(kpi.format).toBe('currency')
    expect(kpi.trend).toBeUndefined()
  })

  it('shape 2: value + explicit compare column yields a delta', () => {
    const kpi = kpiPlugin.buildKpi(
      result(['value', 'previous_value'], [{ value: '120', previous_value: '100' }]),
      viz(['value', 'previous_value']),
    )
    expect(kpi.value).toBe(120)
    expect(kpi.previous).toBe(100)
    expect(kpi.deltaPct).toBeCloseTo(20)
  })

  it('shape 2b: infers a previous-like second column without explicit encoding', () => {
    const kpi = kpiPlugin.buildKpi(
      result(['orders', 'prior_orders'], [{ orders: '90', prior_orders: '100' }]),
      viz(['orders']),
    )
    expect(kpi.previous).toBe(100)
    expect(kpi.deltaPct).toBeCloseTo(-10)
  })

  it('shape 3: period series → last value, previous, trailing trend', () => {
    const rows = Array.from({ length: 15 }, (_, i) => ({
      period: new Date(Date.UTC(2024, i, 1)).toISOString(),
      churn_rate: String(0.1 + i * 0.01),
    }))
    // Shuffle to prove ordering by time.
    const shuffled = [...rows].reverse()
    const kpi = kpiPlugin.buildKpi(result(['period', 'churn_rate'], shuffled), viz(['churn_rate']))
    expect(kpi.value).toBeCloseTo(0.24)
    expect(kpi.previous).toBeCloseTo(0.23)
    expect(kpi.trend).toHaveLength(12)
    expect(kpi.trend?.[11]).toBeCloseTo(0.24)
    expect(kpi.format).toBe('percent')
    expect(kpi.invertDelta).toBe(true)
  })

  it('honours the kpiFormat override', () => {
    const kpi = kpiPlugin.buildKpi(result(['total'], [{ total: '5' }]), viz(['total'], undefined, { kpiFormat: 'percent' }))
    expect(kpi.format).toBe('percent')
  })

  it('returns null value on empty results', () => {
    const kpi = kpiPlugin.buildKpi(result(['total'], []), viz(['total']))
    expect(kpi.value).toBeNull()
  })
})

describe('format inference', () => {
  it('maps column names to formats', () => {
    expect(inferKpiFormat('total_amount')).toBe('currency')
    expect(inferKpiFormat('conversion_rate')).toBe('percent')
    expect(inferKpiFormat('p95_latency_ms')).toBe('duration')
    expect(inferKpiFormat('active_users')).toBe('number')
  })

  it('flags inverted-good metrics', () => {
    expect(isInvertedMetric('churn_rate')).toBe(true)
    expect(isInvertedMetric('error_count')).toBe(true)
    expect(isInvertedMetric('revenue')).toBe(false)
  })
})

describe('computeDeltaPct', () => {
  it('handles zero and missing baselines', () => {
    expect(computeDeltaPct(10, 0)).toBeNull()
    expect(computeDeltaPct(0, 0)).toBe(0)
    expect(computeDeltaPct(10, null)).toBeNull()
    expect(computeDeltaPct(50, 100)).toBe(-50)
  })
})

describe('formatKpiValue', () => {
  it('abbreviates and formats by kind', () => {
    expect(formatKpiValue(1_250_000, 'currency', 'en-US')).toBe('$1.25M')
    expect(formatKpiValue(0.234, 'percent', 'en-US')).toBe('23.4%')
    expect(formatKpiValue(95_000, 'duration', 'en-US')).toBe('1.6m')
    expect(formatKpiValue(1234, 'number', 'en-US')).toBe('1,234')
    expect(formatKpiValue(null, 'number')).toBe('—')
  })
})
