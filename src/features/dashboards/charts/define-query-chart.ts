import { defineChart, type ChartMark, type DomChartDefinition } from '@tanstack/charts'
import { scaleBand } from '@tanstack/charts/scales/band'
import { scaleLinear } from '@tanstack/charts/scales/linear'
import { tooltip } from '@tanstack/charts/tooltip'
import { scaleUtc } from 'd3-scale'

import { queryChartTheme } from '@/features/dashboards/charts/chart-theme'

export type QueryChartScale = 'band' | 'linear' | 'utc'

const TICK_FONT_SIZE = 11

function axisOptions(
  scale: QueryChartScale,
  options?: { grid?: boolean; label?: string; hideAxis?: boolean },
) {
  const axis = options?.hideAxis
    ? false
    : {
        ticks: { size: 0, padding: 8 },
        tickLabels: { fontSize: TICK_FONT_SIZE },
        label: options?.label ? { text: options.label } : undefined,
      }
  if (scale === 'band') {
    return {
      scale: () => scaleBand().padding(0.28),
      axis,
      grid: options?.grid ?? false,
    }
  }
  if (scale === 'utc') {
    return { scale: scaleUtc, axis, grid: options?.grid ?? false }
  }
  return {
    scale: scaleLinear,
    nice: true,
    axis,
    grid: options?.grid ?? true,
  }
}

/** Shared tooltip, theme, and inferred scales for SQL-backed dashboard charts. */
export function defineQueryChart(input: {
  marks: readonly ChartMark[]
  x: QueryChartScale | null
  y: QueryChartScale | null
  xLabel?: string
  yLabel?: string
  /** Keep scales (required when marks bind x/y) but hide axes, grid, and their margins. */
  hideGuides?: boolean
}): DomChartDefinition {
  const hideGuides = Boolean(input.hideGuides)
  const x = input.x === null
    ? null
    : axisOptions(input.x, { label: hideGuides ? undefined : input.xLabel, hideAxis: hideGuides, grid: false })
  const y = input.y === null
    ? null
    : axisOptions(input.y, {
        label: hideGuides ? undefined : input.yLabel,
        hideAxis: hideGuides,
        grid: hideGuides ? false : input.y === 'linear',
      })

  return defineChart({
    marks: input.marks,
    x,
    y,
    guides: hideGuides ? false : undefined,
    margin: hideGuides ? 0 : undefined,
    theme: queryChartTheme,
    tooltip,
  } as never) as unknown as DomChartDefinition
}
