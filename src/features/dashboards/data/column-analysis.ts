import type { ChartType, ColumnRole } from '@/data/types'
import { TABLE_FALLBACK_SCORE } from '@/features/plugins/builtins/viz/table'
import { listVizPlugins } from '@/features/plugins/registry'
import type { TypedCellValue, TypedQueryResult } from '@/features/dashboards/data/typed-rows'

export type ColumnSchema = {
  name: string
  role: ColumnRole | 'unknown'
  /** Only set for `categorical` columns — distinguishes low-cardinality dimensions (good for pie/bar) from free text/ids. */
  cardinality?: 'low' | 'high'
  sampleSize?: number
  distinctCount?: number
}

const SAMPLE_SIZE = 50
/** A column where most sampled non-null values are distinct is treated as high-cardinality (ids, free text). */
const HIGH_CARDINALITY_RATIO = 0.6
const HIGH_CARDINALITY_MIN_DISTINCT = 20

function roleOf(value: TypedCellValue): ColumnRole | 'unknown' {
  if (value instanceof Date) return 'temporal'
  if (typeof value === 'number') return 'numeric'
  if (typeof value === 'string') return 'categorical'
  return 'unknown'
}

function dominantRole(sample: TypedCellValue[]): ColumnRole | 'unknown' {
  const counts = new Map<ColumnRole | 'unknown', number>()
  for (const value of sample) {
    const role = roleOf(value)
    counts.set(role, (counts.get(role) ?? 0) + 1)
  }
  let best: ColumnRole | 'unknown' = 'unknown'
  let bestCount = -1
  for (const [role, count] of counts) {
    if (count > bestCount) { best = role; bestCount = count }
  }
  return best
}

function inferCardinality(sample: TypedCellValue[]): 'low' | 'high' {
  const distinct = new Set(sample).size
  const isHigh = distinct >= HIGH_CARDINALITY_MIN_DISTINCT && distinct >= sample.length * HIGH_CARDINALITY_RATIO
  return isHigh ? 'high' : 'low'
}

/**
 * Infers a column's role by sampling up to `SAMPLE_SIZE` non-null values and
 * taking the majority type (`coerceQueryResult` already turns numeric/ISO-date
 * strings into `number`/`Date`, so this just needs to vote across the sample
 * rather than trust a single row). Categorical columns also get a cardinality
 * hint so chart recommendations can avoid pie/bar charts over free-text or id
 * columns.
 */
export function analyzeColumns(result: TypedQueryResult): ColumnSchema[] {
  return result.columns.map((name) => {
    const sample = result.rows
      .map((row) => row[name])
      .filter((value): value is TypedCellValue => value !== null)
      .slice(0, SAMPLE_SIZE)

    if (sample.length === 0) return { name, role: 'unknown', sampleSize: 0, distinctCount: 0 }

    const role = dominantRole(sample)
    const distinctCount = new Set(
      sample.map((value) => (value instanceof Date ? value.toISOString() : String(value))),
    ).size
    if (role === 'categorical') {
      return { name, role, cardinality: inferCardinality(sample), sampleSize: sample.length, distinctCount }
    }
    return { name, role, sampleSize: sample.length, distinctCount }
  })
}

/**
 * Scores every registered `VizPlugin` against `columns` and returns the best
 * match, falling back to `'table'` when no chart plugin clears the baseline.
 */
export function recommendChartType(columns: ColumnSchema[]): ChartType | 'table' {
  let bestChartType: ChartType | 'table' = 'table'
  let bestScore = TABLE_FALLBACK_SCORE
  for (const plugin of listVizPlugins()) {
    const score = plugin.recommend(columns)
    if (score > bestScore) {
      bestScore = score
      bestChartType = plugin.chartType
    }
  }
  return bestChartType
}
