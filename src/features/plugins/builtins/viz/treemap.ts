import { treemap } from '@tanstack/charts/hierarchy/treemap'

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
  const categorical = columns.find((column) => column.role === 'categorical')
  const numericCount = columns.filter((column) => column.role === 'numeric').length
  if (!categorical || numericCount !== 1) return 0.04
  if (categorical.cardinality === 'high') return 0.58
  return 0.22
}

function buildChart(data: QueryResult, viz: VizConfig) {
  const typed = coerceQueryResult(data)
  const nameColumn = resolveXColumn(typed, viz)
  const parentColumn = resolveSeriesColumn(viz)
  const [valueColumn] = resolveYColumns(typed, viz, nameColumn)
  const rows = typed.rows.flatMap((row) => {
    const amount = valueColumn ? numericValue(row, valueColumn) : null
    if (amount == null || amount < 0) return []
    const name = categoryValue(row, nameColumn)
    const parent = parentColumn ? categoryValue(row, parentColumn) : ''
    return [{
      path: parent ? `${parent}/${name}` : name,
      amount,
    }]
  })

  return defineQueryChart({
    marks: [
      treemap(rows, {
        path: 'path',
        value: 'amount',
        label: (node) => node.name,
        paddingInner: 2,
        paddingOuter: 2,
        color: (node) => node.name,
        radius: 4,
      }),
    ],
    x: null,
    y: null,
  })
}

export const treemapPlugin: ChartVizPlugin = {
  id: 'treemap',
  chartType: 'treemap',
  recommend,
  buildChart,
}
