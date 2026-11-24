import { pie, polar, radialArc } from '@tanstack/charts/polar'

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
import type { ChartBuildContext, ChartVizPlugin } from '@/features/plugins/types'

function recommend(columns: ColumnSchema[]): number {
  const categorical = columns.find((column) => column.role === 'categorical')
  const numericCount = columns.filter((column) => column.role === 'numeric').length
  if (!categorical || numericCount !== 1) return 0.05
  if (categorical.cardinality === 'high') return 0.15
  return columns.length === 2 ? 0.6 : 0.35
}

const UNSELECTED_SLICE_OPACITY = 0.3

function buildChart(data: QueryResult, viz: VizConfig, donut: boolean, context?: ChartBuildContext) {
  const typed = coerceQueryResult(data)
  const nameColumn = resolveXColumn(typed, viz)
  const [valueColumn] = resolveYColumns(typed, viz, nameColumn)
  const slices = typed.rows.flatMap((row) => {
    const amount = numericValue(row, valueColumn)
    if (amount == null || amount < 0) return []
    return [{ name: categoryValue(row, nameColumn), amount, row }]
  })
  const pieRows = pie(slices, { value: 'amount' })
  const innerRadius = donut ? ({ radius }: { radius: number }) => radius * 0.52 : 0

  const selection = context?.selection && context.selection.column === nameColumn ? context.selection : null
  // `pie()` already fixed every slice's angles, so splitting into two arcs keeps geometry
  // identical while letting unselected slices fade.
  const selected = selection ? pieRows.filter((slice) => slice.name === selection.value) : pieRows
  const unselected = selection ? pieRows.filter((slice) => slice.name !== selection.value) : []

  return defineQueryChart({
    marks: [
      polar({
        marks: [
          radialArc(unselected, {
            color: 'name',
            key: 'name',
            innerRadius,
            stroke: 'transparent',
            strokeWidth: 2,
            fillOpacity: UNSELECTED_SLICE_OPACITY,
          }),
          radialArc(selected, {
            color: 'name',
            key: 'name',
            innerRadius,
            stroke: 'transparent',
            strokeWidth: 2,
          }),
        ],
      }),
    ],
    x: null,
    y: null,
  })
}

export const piePlugin: ChartVizPlugin = {
  id: 'pie',
  chartType: 'pie',
  recommend,
  buildChart: (data, viz, context) => buildChart(data, viz, false, context),
}

export const donutPlugin: ChartVizPlugin = {
  id: 'donut',
  chartType: 'donut',
  recommend,
  buildChart: (data, viz, context) => buildChart(data, viz, true, context),
}
