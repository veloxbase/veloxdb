import { barY } from '@tanstack/charts'
import { waterfall } from '@tanstack/charts/transform/waterfall'

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
  const hasCategory = columns.some((column) => column.role === 'categorical' || column.role === 'temporal')
  const numericCount = columns.filter((column) => column.role === 'numeric').length
  if (hasCategory && numericCount === 1) return 0.14
  return 0.03
}

function buildChart(data: QueryResult, viz: VizConfig) {
  const typed = coerceQueryResult(data)
  const xColumn = resolveXColumn(typed, viz)
  const [yColumn] = resolveYColumns(typed, viz, xColumn)
  const source = typed.rows.flatMap((row) => {
    const y = yColumn ? numericValue(row, yColumn) : null
    if (y == null) return []
    return [{ x: categoryValue(row, xColumn), y }]
  })
  const steps = waterfall(source, { value: 'y', total: true }).map((row) => ({
    ...row,
    label: 'x' in row && row.x != null && row.x !== '' ? String(row.x) : 'Total',
  }))

  return defineQueryChart({
    marks: [
      barY(steps, {
        x: 'label',
        y1: 'start',
        y2: 'end',
        color: 'kind',
        radius: 5,
        inset: 3,
        key: (row) => `${row.kind}:${row.label}`,
      }),
    ],
    x: 'band',
    y: 'linear',
  })
}

export const waterfallPlugin: ChartVizPlugin = {
  id: 'waterfall',
  chartType: 'waterfall',
  recommend,
  buildChart,
}
