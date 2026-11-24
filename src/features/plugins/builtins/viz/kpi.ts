import type { QueryResult, VizConfig } from '@/data/types'
import type { ColumnSchema } from '@/features/dashboards/data/column-analysis'
import { coerceQueryResult, type TypedCellValue, type TypedQueryResult } from '@/features/dashboards/data/typed-rows'
import type { KpiFormat, KpiValue, KpiVizPlugin } from '@/features/plugins/types'

export const KPI_TREND_POINTS = 12
const KPI_FORMATS: KpiFormat[] = ['number', 'currency', 'percent', 'duration']

const CURRENCY_RE = /amount|revenue|price|cost|total_|_total|fee|charge|payment|mrr|arr|gmv|spend|balance|sales|income|profit|margin_amount/i
const PERCENT_RE = /rate|pct|percent|ratio|share|conversion|churn/i
const DURATION_RE = /duration|latency|elapsed|_ms$|_seconds?$|_minutes?$|_hours?$|response_time|ttfb/i
const INVERT_RE = /churn|error|latency|failure|bounce|refund|cancel|complaint|downtime|cost|expense|loss/i

function recommend(columns: ColumnSchema[]): number {
  const numeric = columns.find((column) => column.role === 'numeric')
  if (columns.length === 1 && numeric) {
    return (numeric.sampleSize ?? 1) <= 2 ? 0.9 : 0.12
  }
  if (numeric && columns.length <= 2 && (numeric.sampleSize ?? 1) <= 2) return 0.2
  return 0
}

export function inferKpiFormat(column: string): KpiFormat {
  if (PERCENT_RE.test(column)) return 'percent'
  if (CURRENCY_RE.test(column)) return 'currency'
  if (DURATION_RE.test(column)) return 'duration'
  return 'number'
}

export function isInvertedMetric(column: string): boolean {
  return INVERT_RE.test(column)
}

export function parseKpiFormat(options: Record<string, unknown> | undefined): KpiFormat | null {
  const raw = options?.kpiFormat
  return typeof raw === 'string' && (KPI_FORMATS as string[]).includes(raw) ? raw as KpiFormat : null
}

function numericColumns(typed: TypedQueryResult): string[] {
  return typed.columns.filter((column) => typed.rows.some((row) => typeof row[column] === 'number'))
}

function temporalColumn(typed: TypedQueryResult): string | null {
  return typed.columns.find((column) => typed.rows.some((row) => row[column] instanceof Date)) ?? null
}

function resolveValueColumn(typed: TypedQueryResult, viz: VizConfig): string {
  if (viz.encodings.y?.[0]?.column && typed.columns.includes(viz.encodings.y[0].column)) return viz.encodings.y[0].column
  return numericColumns(typed)[0] ?? typed.columns[0] ?? ''
}

function asNumber(value: TypedCellValue | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function computeDeltaPct(value: number | null, previous: number | null): number | null {
  if (value == null || previous == null) return null
  if (previous === 0) return value === 0 ? 0 : null
  return ((value - previous) / Math.abs(previous)) * 100
}

/**
 * Understands three result shapes:
 * 1. one row, one numeric → plain value
 * 2. one row, value + a second numeric (`encodings.y[1]` or a `previous`-like column) → delta
 * 3. many rows with a temporal column → last value, previous = second last, trailing trend
 */
function buildKpi(data: QueryResult, viz: VizConfig): KpiValue {
  const typed = coerceQueryResult(data)
  const valueColumn = resolveValueColumn(typed, viz)
  const format = parseKpiFormat(viz.options) ?? inferKpiFormat(valueColumn)
  const invertDelta = isInvertedMetric(valueColumn)
  const base: KpiValue = { value: null, label: valueColumn, format, invertDelta }

  if (typed.rows.length === 0) return base

  const timeColumn = viz.encodings.x?.column && typed.columns.includes(viz.encodings.x.column)
    ? viz.encodings.x.column
    : temporalColumn(typed)

  if (typed.rows.length > 1 && timeColumn) {
    const ordered = [...typed.rows]
      .filter((row) => row[timeColumn] instanceof Date)
      .sort((a, b) => (a[timeColumn] as Date).getTime() - (b[timeColumn] as Date).getTime())
    const series = ordered.map((row) => asNumber(row[valueColumn])).filter((v): v is number => v != null)
    if (series.length > 0) {
      const value = series[series.length - 1]!
      const previous = series.length > 1 ? series[series.length - 2]! : null
      return {
        ...base,
        value,
        previous,
        deltaPct: computeDeltaPct(value, previous),
        trend: series.slice(-KPI_TREND_POINTS),
      }
    }
  }

  const first = typed.rows[0]!
  const raw = first[valueColumn]
  const value = asNumber(raw)
  const compareColumn = viz.encodings.y?.[1]?.column && typed.columns.includes(viz.encodings.y[1].column)
    ? viz.encodings.y[1].column
    : numericColumns(typed).find((column) => column !== valueColumn && /prev|prior|last|before|compare|baseline/i.test(column))
      ?? null

  if (value != null && compareColumn) {
    const previous = asNumber(first[compareColumn])
    return { ...base, value, previous, deltaPct: computeDeltaPct(value, previous) }
  }

  return {
    ...base,
    value: value ?? (raw != null ? String(raw) : null),
  }
}

export function formatKpiValue(value: number | string | null, format: KpiFormat | undefined, locale?: string): string {
  if (value == null) return '—'
  if (typeof value === 'string') return value
  const abs = Math.abs(value)
  switch (format) {
    case 'currency': {
      if (abs >= 1_000_000) return `$${(value / 1_000_000).toLocaleString(locale, { maximumFractionDigits: 2 })}M`
      if (abs >= 10_000) return `$${(value / 1_000).toLocaleString(locale, { maximumFractionDigits: 1 })}K`
      return value.toLocaleString(locale, { style: 'currency', currency: 'USD', maximumFractionDigits: abs >= 100 ? 0 : 2 })
    }
    case 'percent': {
      const pct = abs <= 1 ? value * 100 : value
      return `${pct.toLocaleString(locale, { maximumFractionDigits: 1 })}%`
    }
    case 'duration': {
      if (abs >= 3_600_000) return `${(value / 3_600_000).toLocaleString(locale, { maximumFractionDigits: 1 })}h`
      if (abs >= 60_000) return `${(value / 60_000).toLocaleString(locale, { maximumFractionDigits: 1 })}m`
      if (abs >= 1_000) return `${(value / 1_000).toLocaleString(locale, { maximumFractionDigits: 1 })}s`
      return `${value.toLocaleString(locale, { maximumFractionDigits: 0 })}ms`
    }
    default: {
      if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toLocaleString(locale, { maximumFractionDigits: 2 })}B`
      if (abs >= 1_000_000) return `${(value / 1_000_000).toLocaleString(locale, { maximumFractionDigits: 2 })}M`
      if (abs >= 100_000) return `${(value / 1_000).toLocaleString(locale, { maximumFractionDigits: 1 })}K`
      return value.toLocaleString(locale, { maximumFractionDigits: Number.isInteger(value) ? 0 : 2 })
    }
  }
}

export const kpiPlugin: KpiVizPlugin = {
  id: 'kpi',
  chartType: 'kpi',
  recommend,
  buildKpi,
}
