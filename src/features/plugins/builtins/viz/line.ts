import { areaY, lineY } from '@tanstack/charts'
import { stack } from '@tanstack/charts/stack'

import type { QueryResult, VizConfig } from '@/data/types'
import { defineQueryChart } from '@/features/dashboards/charts/define-query-chart'
import { coerceQueryResult } from '@/features/dashboards/data/typed-rows'
import type { ColumnSchema } from '@/features/dashboards/data/column-analysis'
import {
  axisValue,
  isTemporalColumn,
  resolveSeriesColumn,
  resolveXColumn,
  resolveYColumns,
  selectionStates,
  toLongSeries,
} from '@/features/plugins/builtins/viz/shared'
import type { ChartBuildContext, ChartVizPlugin } from '@/features/plugins/types'

function recommendLine(columns: ColumnSchema[]): number {
  const hasTemporal = columns.some((column) => column.role === 'temporal')
  const numericCount = columns.filter((column) => column.role === 'numeric').length
  if (hasTemporal && numericCount === 1) return 0.9
  if (hasTemporal && numericCount >= 2) return 0.7
  if (numericCount >= 2) return 0.35
  return 0.1
}

function recommendArea(columns: ColumnSchema[]): number {
  const hasTemporal = columns.some((column) => column.role === 'temporal')
  const numericCount = columns.filter((column) => column.role === 'numeric').length
  if (hasTemporal && numericCount >= 1) return 0.84
  return 0.08
}

function buildChart(data: QueryResult, viz: VizConfig, area: boolean, context?: ChartBuildContext) {
  const typed = coerceQueryResult(data)
  const xColumn = resolveXColumn(typed, viz)
  const yColumns = resolveYColumns(typed, viz, xColumn)
  const seriesColumn = resolveSeriesColumn(viz)
  const temporal = isTemporalColumn(typed, xColumn)
  const rows = toLongSeries(typed, xColumn, yColumns, axisValue, seriesColumn)
  const showPoints = typed.rows.length <= 24
  const stacked = Boolean(seriesColumn || yColumns.length > 1)
  // Lines are one path per series, so a selection can only meaningfully dim whole series.
  const states = seriesColumn ? selectionStates<(typeof rows)[number]>(context, seriesColumn) : undefined

  const marks = area
    ? [
        areaY(rows, {
          x: 'x',
          y: 'y',
          z: 'series',
          fillOpacity: 0.32,
          layout: stacked ? stack() : undefined,
          states,
          key: (row) => `${row.series}:${String(row.x)}`,
        }),
        lineY(rows, {
          x: 'x',
          y: 'y',
          z: 'series',
          strokeWidth: 2.25,
          points: showPoints,
          states,
          key: (row) => `${row.series}:${String(row.x)}`,
        }),
      ]
    : [
        lineY(rows, {
          x: 'x',
          y: 'y',
          z: 'series',
          strokeWidth: 2.25,
          points: showPoints,
          states,
          key: (row) => `${row.series}:${String(row.x)}`,
        }),
      ]

  return defineQueryChart({
    marks,
    x: temporal ? 'utc' : 'band',
    y: 'linear',
  })
}

export const linePlugin: ChartVizPlugin = {
  id: 'line',
  chartType: 'line',
  recommend: recommendLine,
  buildChart: (data, viz, context) => buildChart(data, viz, false, context),
}

export const areaPlugin: ChartVizPlugin = {
  id: 'area',
  chartType: 'area',
  recommend: recommendArea,
  buildChart: (data, viz, context) => buildChart(data, viz, true, context),
}
