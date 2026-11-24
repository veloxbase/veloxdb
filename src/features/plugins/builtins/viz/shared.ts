import { group } from '@tanstack/charts/group'
import { stack } from '@tanstack/charts/stack'
import type { ChartMarkState, ChartMarkStateStyle, ChartValue } from '@tanstack/charts'

import type { ColumnRef, VizConfig } from '@/data/types'
import type { TypedCellValue, TypedQueryResult } from '@/features/dashboards/data/typed-rows'
import type { ChartBuildContext } from '@/features/plugins/types'

export type QuerySeriesRow = {
  x: ChartValue
  y: number
  series: string
  size: number | null
  row: Record<string, TypedCellValue>
}

export type BarLayoutMode = 'stack' | 'group' | 'normalize'

/** Resolves the x-axis column: explicit encoding, else the first column. */
export function resolveXColumn(typed: TypedQueryResult, viz: VizConfig): string {
  return viz.encodings.x?.column ?? typed.columns[0]
}

/** Resolves y-axis columns: explicit encodings, else every non-x column. */
export function resolveYColumns(typed: TypedQueryResult, viz: VizConfig, xColumn: string): string[] {
  if (viz.encodings.y?.length) return viz.encodings.y.map((ref: ColumnRef) => ref.column)
  return typed.columns.filter((column) => column !== xColumn)
}

export function resolveSeriesColumn(viz: VizConfig): string | null {
  return viz.encodings.series?.column ?? null
}

export function resolveSizeColumn(viz: VizConfig): string | null {
  return viz.encodings.size?.column ?? null
}

/** True when the sampled values for `column` are `Date` instances (drives axis type selection). */
export function isTemporalColumn(typed: TypedQueryResult, column: string): boolean {
  return typed.rows.find((row) => row[column] !== null)?.[column] instanceof Date
}

export function categoryValue(row: Record<string, TypedCellValue>, column: string): string {
  const value = row[column]
  if (value == null) return ''
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

export function numericValue(row: Record<string, TypedCellValue>, column: string): number | null {
  const value = row[column]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function axisValue(row: Record<string, TypedCellValue>, column: string): ChartValue | null {
  const value = row[column]
  if (value == null) return null
  if (typeof value === 'boolean') return String(value)
  return value
}

const UNSELECTED_OPACITY = 0.3

type SelectionStateStyle<TDatum> = Pick<ChartMarkStateStyle<TDatum>, 'opacity'>

/**
 * Mark `states` that dim every datum whose `column` value differs from the active
 * click-to-filter selection. Returns `undefined` when nothing is selected so the
 * chart renders exactly as before.
 */
export function selectionStates<TDatum extends { row: Record<string, TypedCellValue> }>(
  context: ChartBuildContext | undefined,
  column: string,
): readonly ChartMarkState<TDatum, SelectionStateStyle<TDatum>>[] | undefined {
  const selection = context?.selection
  if (!selection) return undefined
  const matchesColumn = selection.column === column
  if (!matchesColumn) return undefined
  return [
    {
      when: ({ datum }) => categoryValue(datum.row, column) !== selection.value,
      style: { opacity: UNSELECTED_OPACITY },
      transition: { type: 'tween', duration: 160 },
    },
  ]
}

export function parseBarLayout(options: Record<string, unknown> | undefined): BarLayoutMode | null {
  const value = options?.barLayout
  if (value === 'stack' || value === 'group' || value === 'normalize') return value
  return null
}

export function resolveBarLayout(viz: VizConfig, hasMultipleSeries: boolean) {
  const mode = parseBarLayout(viz.options) ?? (hasMultipleSeries ? 'stack' : null)
  if (mode === 'group') return group({ padding: 0.18 })
  if (mode === 'normalize') return stack({ offset: 'normalize' })
  if (mode === 'stack') return stack()
  return undefined
}

/**
 * Long-form rows for marks that color/group by `series`.
 * Long data (`encodings.series`) wins; otherwise extra Y columns fold into series.
 */
export function toLongSeries(
  typed: TypedQueryResult,
  xColumn: string,
  yColumns: string[],
  xOf: (row: Record<string, TypedCellValue>, column: string) => ChartValue | null,
  seriesColumn?: string | null,
  sizeColumn?: string | null,
): QuerySeriesRow[] {
  const rows: QuerySeriesRow[] = []
  if (seriesColumn) {
    const yColumn = yColumns[0]
    if (!yColumn) return rows
    for (const row of typed.rows) {
      const x = xOf(row, xColumn)
      const y = numericValue(row, yColumn)
      if (x == null || y == null) continue
      rows.push({
        x,
        y,
        series: categoryValue(row, seriesColumn) || 'series',
        size: sizeColumn ? numericValue(row, sizeColumn) : null,
        row,
      })
    }
    return rows
  }

  for (const row of typed.rows) {
    const x = xOf(row, xColumn)
    if (x == null) continue
    for (const series of yColumns) {
      const y = numericValue(row, series)
      if (y == null) continue
      rows.push({
        x,
        y,
        series,
        size: sizeColumn ? numericValue(row, sizeColumn) : null,
        row,
      })
    }
  }
  return rows
}
