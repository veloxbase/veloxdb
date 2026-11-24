import { areaY, lineY, type DomChartDefinition } from '@tanstack/charts'

import { defineQueryChart } from '@/features/dashboards/charts/define-query-chart'

/** Axis-less trailing trend for KPI tiles. Returns null when there is nothing to draw. */
export function defineKpiSparkline(trend: number[] | undefined): DomChartDefinition | null {
  if (!trend || trend.length < 2) return null
  const rows = trend.map((y, index) => ({ x: index, y }))
  return defineQueryChart({
    marks: [
      areaY(rows, { x: 'x', y: 'y', fillOpacity: 0.16, key: (row) => String(row.x) }),
      lineY(rows, { x: 'x', y: 'y', strokeWidth: 1.75, points: false, key: (row) => String(row.x) }),
    ],
    // lineY/areaY materialize x and y — TanStack throws if those scales are null.
    x: 'linear',
    y: 'linear',
    hideGuides: true,
  })
}
