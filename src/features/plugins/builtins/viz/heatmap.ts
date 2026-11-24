import { cell } from '@tanstack/charts'

import type { QueryResult, VizConfig } from '@/data/types'
import { defineQueryChart } from '@/features/dashboards/charts/define-query-chart'
import { coerceQueryResult } from '@/features/dashboards/data/typed-rows'
import type { ColumnSchema } from '@/features/dashboards/data/column-analysis'
import {
  categoryValue,
  numericValue,
  resolveSeriesColumn,
  resolveXColumn,
  resolveYColumns,
} from '@/features/plugins/builtins/viz/shared'
import type { ChartVizPlugin } from '@/features/plugins/types'

function recommend(columns: ColumnSchema[]): number {
  const categoricals = columns.filter((column) => column.role === 'categorical')
  const numericCount = columns.filter((column) => column.role === 'numeric').length
  if (categoricals.length >= 2 && numericCount >= 1) return 0.88
  return 0.04
}

function buildChart(data: QueryResult, viz: VizConfig) {
  const typed = coerceQueryResult(data)
  const xColumn = resolveXColumn(typed, viz)
  const yCategory = resolveSeriesColumn(viz)
  const [valueColumn] = resolveYColumns(typed, viz, xColumn)
  const rows = typed.rows.flatMap((row) => {
    const amount = valueColumn ? numericValue(row, valueColumn) : null
    if (amount == null) return []
    return [{
      x: categoryValue(row, xColumn),
      y: yCategory ? categoryValue(row, yCategory) : (valueColumn ?? 'value'),
      amount,
    }]
  })

  return defineQueryChart({
    marks: [
      cell(rows, {
        x: 'x',
        y: 'y',
        color: 'amount',
        inset: 1,
        radius: 3,
        key: (row) => `${row.x}:${row.y}`,
      }),
    ],
    x: 'band',
    y: 'band',
  })
}

export const heatmapPlugin: ChartVizPlugin = {
  id: 'heatmap',
  chartType: 'heatmap',
  recommend,
  buildChart,
}
