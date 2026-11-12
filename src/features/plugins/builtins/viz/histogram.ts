import { rect } from '@tanstack/charts'
import { binX } from '@tanstack/charts/transform/bin'

import type { QueryResult, VizConfig } from '@/data/types'
import { defineQueryChart } from '@/features/dashboards/charts/define-query-chart'
import { coerceQueryResult } from '@/features/dashboards/data/typed-rows'
import type { ColumnSchema } from '@/features/dashboards/data/column-analysis'
import { numericValue, resolveXColumn, resolveYColumns } from '@/features/plugins/builtins/viz/shared'
import type { ChartVizPlugin } from '@/features/plugins/types'

function recommend(columns: ColumnSchema[]): number {
  const numerics = columns.filter((column) => column.role === 'numeric')
  if (columns.length === 1 && numerics.length === 1) {
    return (numerics[0]?.sampleSize ?? 0) >= 8 ? 0.88 : 0.18
  }
  if (numerics.length === 1 && columns.length <= 2) {
    return (numerics[0]?.sampleSize ?? 0) >= 16 ? 0.55 : 0.12
  }
  return 0.04
}

function buildChart(data: QueryResult, viz: VizConfig) {
  const typed = coerceQueryResult(data)
  const xColumn = viz.encodings.y?.[0]?.column ?? resolveXColumn(typed, viz)
  const [valueColumn] = resolveYColumns(typed, viz, xColumn)
  const measure = valueColumn ?? xColumn
  const points = typed.rows.flatMap((row) => {
    const value = numericValue(row, measure)
    return value == null ? [] : [{ value }]
  })
  const bins = binX(points, { value: 'value', thresholds: Math.min(16, Math.max(6, Math.round(Math.sqrt(points.length)))) })

  return defineQueryChart({
    marks: [
      rect(bins, {
        x1: 'x1',
        x2: 'x2',
        y: 'value',
        inset: 1,
        radius: 3,
        key: (row) => `${row.x1}:${row.x2}`,
      }),
    ],
    x: 'linear',
    y: 'linear',
  })
}

export const histogramPlugin: ChartVizPlugin = {
  id: 'histogram',
  chartType: 'histogram',
  recommend,
  buildChart,
}
