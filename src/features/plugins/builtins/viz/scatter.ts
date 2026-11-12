import { dot } from '@tanstack/charts'

import type { QueryResult, VizConfig } from '@/data/types'
import { defineQueryChart } from '@/features/dashboards/charts/define-query-chart'
import { coerceQueryResult } from '@/features/dashboards/data/typed-rows'
import type { ColumnSchema } from '@/features/dashboards/data/column-analysis'
import {
  numericValue,
  resolveSeriesColumn,
  resolveSizeColumn,
  resolveXColumn,
  resolveYColumns,
} from '@/features/plugins/builtins/viz/shared'
import type { ChartVizPlugin } from '@/features/plugins/types'

function recommend(columns: ColumnSchema[]): number {
  const hasTemporal = columns.some((column) => column.role === 'temporal')
  const numericCount = columns.filter((column) => column.role === 'numeric').length
  if (numericCount >= 2 && !hasTemporal) return 0.86
  if (numericCount >= 2) return 0.42
  return 0.05
}

function buildChart(data: QueryResult, viz: VizConfig) {
  const typed = coerceQueryResult(data)
  const xColumn = resolveXColumn(typed, viz)
  const [yColumn] = resolveYColumns(typed, viz, xColumn)
  const seriesColumn = resolveSeriesColumn(viz)
  const sizeColumn = resolveSizeColumn(viz)
  const rows = typed.rows.flatMap((row, index) => {
    const x = numericValue(row, xColumn)
    const y = yColumn ? numericValue(row, yColumn) : null
    if (x == null || y == null) return []
    return [{
      x,
      y,
      series: seriesColumn ? String(row[seriesColumn] ?? 'series') : 'value',
      size: sizeColumn ? numericValue(row, sizeColumn) : 5,
      key: `${index}:${x}:${y}`,
    }]
  })

  return defineQueryChart({
    marks: [
      dot(rows, {
        x: 'x',
        y: 'y',
        z: 'series',
        r: (row) => Math.max(3, Math.min(14, Number(row.size ?? 5))),
        fillOpacity: 0.72,
        key: 'key',
      }),
    ],
    x: 'linear',
    y: 'linear',
  })
}

export const scatterPlugin: ChartVizPlugin = {
  id: 'scatter',
  chartType: 'scatter',
  recommend,
  buildChart,
}
