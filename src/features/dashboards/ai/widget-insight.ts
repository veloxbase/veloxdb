import type { QueryResult, VizConfig } from '@/data/types'
import { coerceQueryResult, type TypedQueryResult } from '@/features/dashboards/data/typed-rows'
import { formatKpiValue, inferKpiFormat, parseKpiFormat } from '@/features/plugins/builtins/viz/kpi'
import type { KpiValue } from '@/features/plugins/types'

export type InsightTone = 'neutral' | 'up' | 'down' | 'warn'

export type WidgetInsight = {
  text: string
  tone: InsightTone
}

const NULL_RATE_WARN = 0.2
const SPIKE_RATIO = 2.5
const MIN_SERIES_POINTS = 3
const DOMINANT_SHARE = 0.5

function numericColumns(typed: TypedQueryResult): string[] {
  return typed.columns.filter((column) => typed.rows.some((row) => typeof row[column] === 'number'))
}

function temporalColumn(typed: TypedQueryResult): string | null {
  return typed.columns.find((column) => typed.rows.some((row) => row[column] instanceof Date)) ?? null
}

function categoricalColumn(typed: TypedQueryResult, exclude: Set<string>): string | null {
  return typed.columns.find((column) => !exclude.has(column) && typed.rows.some((row) => typeof row[column] === 'string')) ?? null
}

function pct(value: number): string {
  const abs = Math.abs(value)
  return `${abs >= 100 ? Math.round(abs) : abs.toFixed(abs >= 10 ? 0 : 1)}%`
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!
}

function label(column: string): string {
  return column.replace(/_/g, ' ')
}

function resolveValueColumn(typed: TypedQueryResult, viz: VizConfig | null): string | null {
  const encoded = viz?.encodings.y?.[0]?.column
  if (encoded && typed.columns.includes(encoded)) return encoded
  return numericColumns(typed)[0] ?? null
}

function dataQualityInsight(result: QueryResult, typed: TypedQueryResult, valueColumn: string | null): WidgetInsight | null {
  if (result.truncated) {
    return { text: `Showing the first ${result.rows.length.toLocaleString()} rows; result was truncated.`, tone: 'warn' }
  }
  if (!valueColumn || typed.rows.length === 0) return null
  const nulls = typed.rows.filter((row) => row[valueColumn] == null).length
  const rate = nulls / typed.rows.length
  if (rate > NULL_RATE_WARN) {
    return { text: `${pct(rate * 100)} of ${label(valueColumn)} values are null.`, tone: 'warn' }
  }
  return null
}

function timeSeriesInsight(
  typed: TypedQueryResult,
  timeColumn: string,
  valueColumn: string,
  format: ReturnType<typeof inferKpiFormat>,
  invert: boolean,
): WidgetInsight | null {
  const ordered = typed.rows
    .filter((row) => row[timeColumn] instanceof Date && typeof row[valueColumn] === 'number')
    .sort((a, b) => (a[timeColumn] as Date).getTime() - (b[timeColumn] as Date).getTime())
    .map((row) => row[valueColumn] as number)
  if (ordered.length < MIN_SERIES_POINTS) return null

  const last = ordered[ordered.length - 1]!
  const previous = ordered[ordered.length - 2]!
  const med = median(ordered)
  const max = Math.max(...ordered)
  const maxIndex = ordered.indexOf(max)

  // A spike anywhere except the current point is the most surprising thing to call out.
  if (med > 0 && max / med >= SPIKE_RATIO && maxIndex !== ordered.length - 1) {
    return {
      text: `Peak of ${formatKpiValue(max, format)} is ${(max / med).toFixed(1)}× the median.`,
      tone: 'warn',
    }
  }

  // Streak: count consecutive moves in the same direction ending at the last point.
  let streak = 0
  let direction = 0
  for (let index = ordered.length - 1; index > 0; index--) {
    const diff = Math.sign(ordered[index]! - ordered[index - 1]!)
    if (diff === 0) break
    if (direction === 0) direction = diff
    if (diff !== direction) break
    streak++
  }

  if (previous !== 0) {
    const delta = ((last - previous) / Math.abs(previous)) * 100
    const up = delta > 0
    const good = invert ? !up : up
    const tone: InsightTone = Math.abs(delta) < 0.5 ? 'neutral' : good ? 'up' : 'down'
    const streakText = streak >= 3 ? ` — ${streak} periods ${up ? 'rising' : 'falling'}` : ''
    if (Math.abs(delta) < 0.5) return { text: `Flat at ${formatKpiValue(last, format)} vs the prior period${streakText}.`, tone }
    return {
      text: `${up ? 'Up' : 'Down'} ${pct(delta)} to ${formatKpiValue(last, format)} vs the prior period${streakText}.`,
      tone,
    }
  }
  return { text: `Latest ${label(valueColumn)}: ${formatKpiValue(last, format)}.`, tone: 'neutral' }
}

function categoricalInsight(
  typed: TypedQueryResult,
  categoryColumn: string,
  valueColumn: string,
  format: ReturnType<typeof inferKpiFormat>,
): WidgetInsight | null {
  const rows = typed.rows
    .filter((row) => typeof row[valueColumn] === 'number' && (row[valueColumn] as number) >= 0)
    .map((row) => ({ name: String(row[categoryColumn] ?? '—'), value: row[valueColumn] as number }))
  if (rows.length < 2) return null
  const total = rows.reduce((sum, row) => sum + row.value, 0)
  if (total <= 0) return null
  const sorted = [...rows].sort((a, b) => b.value - a.value)
  const top = sorted[0]!
  const share = top.value / total
  const longTail = sorted.filter((row) => row.value / total < 0.05).length

  if (share >= DOMINANT_SHARE) {
    return { text: `${top.name} accounts for ${pct(share * 100)} of ${label(valueColumn)}.`, tone: 'neutral' }
  }
  const tail = longTail > 0 ? `; ${longTail} ${longTail === 1 ? 'category' : 'categories'} under 5%` : ''
  return {
    text: `Top: ${top.name} at ${pct(share * 100)} (${formatKpiValue(top.value, format)})${tail}.`,
    tone: 'neutral',
  }
}

export function kpiInsight(kpi: KpiValue): WidgetInsight | null {
  if (kpi.deltaPct == null || kpi.previous == null) return null
  const up = kpi.deltaPct > 0
  if (Math.abs(kpi.deltaPct) < 0.5) {
    return { text: `Unchanged vs the prior period (${formatKpiValue(kpi.previous, kpi.format)}).`, tone: 'neutral' }
  }
  const good = kpi.invertDelta ? !up : up
  return {
    text: `${up ? 'Up' : 'Down'} ${pct(kpi.deltaPct)} from ${formatKpiValue(kpi.previous, kpi.format)}.`,
    tone: good ? 'up' : 'down',
  }
}

/**
 * One-sentence, heuristic insight for a widget result. Pure: no LLM, no I/O.
 * Priority: data quality → time series → categorical share.
 */
export function buildWidgetInsight(result: QueryResult, viz: VizConfig | null): WidgetInsight | null {
  if (!result.columns.length || result.rows.length === 0) return null
  const typed = coerceQueryResult(result)
  const valueColumn = resolveValueColumn(typed, viz)

  const quality = dataQualityInsight(result, typed, valueColumn)
  if (quality) return quality
  if (!valueColumn) return null

  const format = parseKpiFormat(viz?.options) ?? inferKpiFormat(valueColumn)
  const invert = /churn|error|latency|failure|bounce|refund|cancel|cost|expense|loss/i.test(valueColumn)

  const encodedX = viz?.encodings.x?.column
  const timeColumn = encodedX && typed.rows.some((row) => row[encodedX] instanceof Date)
    ? encodedX
    : temporalColumn(typed)
  if (timeColumn && !viz?.encodings.series) {
    const insight = timeSeriesInsight(typed, timeColumn, valueColumn, format, invert)
    if (insight) return insight
  }

  const categoryColumn = encodedX && typed.rows.some((row) => typeof row[encodedX] === 'string')
    ? encodedX
    : categoricalColumn(typed, new Set([valueColumn]))
  if (categoryColumn && !viz?.encodings.series) {
    return categoricalInsight(typed, categoryColumn, valueColumn, format)
  }

  return null
}
