import { barY, lineY } from '@tanstack/charts'

import type { QueryResult, VizConfig } from '@/data/types'
import { defineQueryChart } from '@/features/dashboards/charts/define-query-chart'
import { coerceQueryResult } from '@/features/dashboards/data/typed-rows'
import type { ColumnSchema } from '@/features/dashboards/data/column-analysis'
import {
  axisValue,
  isTemporalColumn,
  resolveXColumn,
  resolveYColumns,
  toLongSeries,
} from '@/features/plugins/builtins/viz/shared'
import type { ChartVizPlugin } from '@/features/plugins/types'

function recommend(columns: ColumnSchema[]): number {
  const hasTemporal = columns.some((column) => column.role === 'temporal')
  const numericCount = columns.filter((column) => column.role === 'numeric').length
  if (hasTemporal && numericCount >= 2) return 0.93
  if (numericCount >= 2) return 0.48
  return 0.06
}

function buildChart(data: QueryResult, viz: VizConfig) {
  const typed = coerceQueryResult(data)
  const xColumn = resolveXColumn(typed, viz)
  const yColumns = resolveYColumns(typed, viz, xColumn)
  const temporal = isTemporalColumn(typed, xColumn)
  const barColumn = yColumns[0]
  const lineColumn = yColumns[1] ?? yColumns[0]
  const barRows = barColumn ? toLongSeries(typed, xColumn, [barColumn], axisValue) : []
  const lineRows = lineColumn ? toLongSeries(typed, xColumn, [lineColumn], axisValue) : []

  return defineQueryChart({
    marks: [
      barY(barRows, {
        x: 'x',
        y: 'y',
        z: 'series',
        radius: 5,
        inset: 3,
        fillOpacity: 0.82,
        key: (row) => `bar:${row.series}:${String(row.x)}`,
      }),
      lineY(lineRows, {
        x: 'x',
        y: 'y',
        z: 'series',
        strokeWidth: 2.4,
        points: typed.rows.length <= 24,
        key: (row) => `line:${row.series}:${String(row.x)}`,
      }),
    ],
    x: temporal ? 'utc' : 'band',
    y: 'linear',
  })
}

export const comboPlugin: ChartVizPlugin = {
  id: 'combo',
  chartType: 'combo',
  recommend,
  buildChart,
}
