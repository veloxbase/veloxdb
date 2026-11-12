import { barX, barY } from '@tanstack/charts'

import type { QueryResult, VizConfig } from '@/data/types'
import { defineQueryChart } from '@/features/dashboards/charts/define-query-chart'
import { coerceQueryResult } from '@/features/dashboards/data/typed-rows'
import type { ColumnSchema } from '@/features/dashboards/data/column-analysis'
import {
  categoryValue,
  resolveBarLayout,
  resolveSeriesColumn,
  resolveXColumn,
  resolveYColumns,
  selectionStates,
  toLongSeries,
} from '@/features/plugins/builtins/viz/shared'
import type { ChartBuildContext, ChartVizPlugin } from '@/features/plugins/types'

function recommend(columns: ColumnSchema[]): number {
  const categoricals = columns.filter((column) => column.role === 'categorical')
  const numericCount = columns.filter((column) => column.role === 'numeric').length
  const lowCard = categoricals.find((column) => column.cardinality !== 'high')
  if (categoricals.length >= 2 && numericCount >= 1) return 0.62
  if (lowCard && numericCount >= 1) return 0.8
  if (numericCount >= 1 && columns.length <= 3) return 0.3
  return 0.1
}

function buildChart(data: QueryResult, viz: VizConfig, horizontal: boolean, context?: ChartBuildContext) {
  const typed = coerceQueryResult(data)
  const xColumn = resolveXColumn(typed, viz)
  const yColumns = resolveYColumns(typed, viz, xColumn)
  const seriesColumn = resolveSeriesColumn(viz)
  const rows = toLongSeries(typed, xColumn, yColumns, categoryValue, seriesColumn)
  const layout = resolveBarLayout(viz, Boolean(seriesColumn || yColumns.length > 1))
  // Highlight by series when the filter targets the series column, otherwise by x.
  const states = selectionStates<(typeof rows)[number]>(context, seriesColumn && context?.selection?.column === seriesColumn ? seriesColumn : xColumn)

  if (horizontal) {
    return defineQueryChart({
      marks: [
        barX(rows, {
          x: 'y',
          y: 'x',
          z: 'series',
          radius: 5,
          inset: 3,
          layout,
          states,
          key: (row) => `${row.series}:${String(row.x)}`,
        }),
      ],
      x: 'linear',
      y: 'band',
    })
  }

  return defineQueryChart({
    marks: [
      barY(rows, {
        x: 'x',
        y: 'y',
        z: 'series',
        radius: 5,
        inset: 3,
        layout,
        states,
        key: (row) => `${row.series}:${String(row.x)}`,
      }),
    ],
    x: 'band',
    y: 'linear',
  })
}

export const barPlugin: ChartVizPlugin = {
  id: 'bar',
  chartType: 'bar',
  recommend,
  buildChart: (data, viz, context) => buildChart(data, viz, false, context),
}

export const horizontalBarPlugin: ChartVizPlugin = {
  id: 'horizontalBar',
  chartType: 'horizontalBar',
  recommend: (columns) => recommend(columns) - 0.05,
  buildChart: (data, viz, context) => buildChart(data, viz, true, context),
}
