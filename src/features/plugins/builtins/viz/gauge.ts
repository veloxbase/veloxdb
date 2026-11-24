import { polar, radialArc } from '@tanstack/charts/polar'

import type { QueryResult, VizConfig } from '@/data/types'
import { defineQueryChart } from '@/features/dashboards/charts/define-query-chart'
import { coerceQueryResult } from '@/features/dashboards/data/typed-rows'
import type { ColumnSchema } from '@/features/dashboards/data/column-analysis'
import { numericValue, resolveYColumns } from '@/features/plugins/builtins/viz/shared'
import type { ChartVizPlugin } from '@/features/plugins/types'

function recommend(columns: ColumnSchema[]): number {
  const numerics = columns.filter((column) => column.role === 'numeric')
  if (columns.length === 1 && numerics.length === 1 && (numerics[0]?.sampleSize ?? 1) <= 2) return 0.28
  return 0.03
}

function resolveTarget(value: number, explicit?: number | null): number {
  if (explicit != null && explicit > 0) return explicit
  if (value <= 1) return 1
  if (value <= 100) return 100
  return value
}

function buildChart(data: QueryResult, viz: VizConfig) {
  const typed = coerceQueryResult(data)
  const yColumns = resolveYColumns(typed, viz, typed.columns[0] ?? '')
  const valueColumn = viz.encodings.y?.[0]?.column ?? yColumns[0] ?? typed.columns[0]
  const targetColumn = viz.encodings.y?.[1]?.column
  const raw = valueColumn ? numericValue(typed.rows[0] ?? {}, valueColumn) : null
  const targetRaw = targetColumn ? numericValue(typed.rows[0] ?? {}, targetColumn) : null
  const value = raw ?? 0
  const target = resolveTarget(value, targetRaw)
  const pct = Math.max(0, Math.min(1, target === 0 ? 0 : value / target))
  const start = -Math.PI * 0.75
  const sweep = Math.PI * 1.5

  return defineQueryChart({
    marks: [
      polar({
        startAngle: start,
        endAngle: start + sweep,
        marks: [
          radialArc([{ id: 'track', start, end: start + sweep }], {
            startAngle: 'start',
            endAngle: 'end',
            innerRadius: ({ radius }) => radius * 0.68,
            outerRadius: ({ radius }) => radius,
            fillOpacity: 0.22,
            key: 'id',
          }),
          radialArc([{ id: 'value', start, end: start + sweep * pct }], {
            startAngle: 'start',
            endAngle: 'end',
            innerRadius: ({ radius }) => radius * 0.68,
            outerRadius: ({ radius }) => radius,
            key: 'id',
          }),
        ],
      }),
    ],
    x: null,
    y: null,
  })
}

export const gaugePlugin: ChartVizPlugin = {
  id: 'gauge',
  chartType: 'gauge',
  recommend,
  buildChart,
}
