import { boxY } from '@tanstack/charts'

import type { QueryResult, VizConfig } from '@/data/types'
import { defineQueryChart } from '@/features/dashboards/charts/define-query-chart'
import { coerceQueryResult } from '@/features/dashboards/data/typed-rows'
import type { ColumnSchema } from '@/features/dashboards/data/column-analysis'
import {
  categoryValue,
  numericValue,
  resolveXColumn,
  resolveYColumns,
} from '@/features/plugins/builtins/viz/shared'
import type { ChartVizPlugin } from '@/features/plugins/types'

function recommend(columns: ColumnSchema[]): number {
  const categorical = columns.find((column) => column.role === 'categorical' && column.cardinality !== 'high')
  const numeric = columns.find((column) => column.role === 'numeric')
  if (!categorical || !numeric) return 0.04
  const sampleSize = numeric.sampleSize ?? 0
  const distinct = numeric.distinctCount ?? 0
  if (sampleSize >= 12 && distinct >= 8) return 0.83
  return 0.16
}

function buildChart(data: QueryResult, viz: VizConfig) {
  const typed = coerceQueryResult(data)
  const xColumn = resolveXColumn(typed, viz)
  const [yColumn] = resolveYColumns(typed, viz, xColumn)
  const rows = typed.rows.flatMap((row) => {
    const y = yColumn ? numericValue(row, yColumn) : null
    if (y == null) return []
    return [{ x: categoryValue(row, xColumn), y }]
  })

  return defineQueryChart({
    marks: [
      boxY(rows, {
        x: 'x',
        y: 'y',
      }),
    ],
    x: 'band',
    y: 'linear',
  })
}

export const boxPlugin: ChartVizPlugin = {
  id: 'box',
  chartType: 'box',
  recommend,
  buildChart,
}
