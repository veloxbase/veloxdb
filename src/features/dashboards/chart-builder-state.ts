import type { ChartType, ColumnRef, VizConfig, Widget } from '@/data/types'
import type { ColumnSchema } from '@/features/dashboards/data/column-analysis'

/** Chart Builder adds a `table` option alongside the registered chart-type `VizPlugin`s. */
export type BuilderChartType = ChartType | 'table'

export type ChartEncodings = {
  x: string | null
  y: string[]
  series: string | null
  size: string | null
}

/** Partial encodings from the model or a pin — missing or unknown columns fall back. */
export type RequestedEncodings = {
  x?: string | null
  y?: string[]
  series?: string | null
  size?: string | null
}

export const EMPTY_ENCODINGS: ChartEncodings = { x: null, y: [], series: null, size: null }

function lowCardinalities(columns: ColumnSchema[]): ColumnSchema[] {
  return columns.filter((column) => column.role === 'categorical' && column.cardinality !== 'high')
}

function pickSeries(columns: ColumnSchema[], xName: string | null | undefined): string | null {
  return lowCardinalities(columns).find((column) => column.name !== xName)?.name ?? null
}

/** Picks sensible default X/Y/series encodings from analyzed columns for the given chart type. */
export function defaultEncodings(columns: ColumnSchema[], chartType: BuilderChartType): ChartEncodings {
  const temporal = columns.find((column) => column.role === 'temporal')
  const categoricals = columns.filter((column) => column.role === 'categorical')
  const lowCats = lowCardinalities(columns)
  const numerics = columns.filter((column) => column.role === 'numeric')

  if (chartType === 'kpi' || chartType === 'gauge' || chartType === 'histogram') {
    return { x: null, y: numerics[0] ? [numerics[0].name] : [], series: null, size: null }
  }

  if (chartType === 'scatter') {
    const xColumn = numerics[0]
    const yColumn = numerics[1] ?? numerics[0]
    return {
      x: xColumn?.name ?? null,
      y: yColumn ? [yColumn.name] : [],
      series: pickSeries(columns, xColumn?.name),
      size: numerics[2]?.name ?? null,
    }
  }

  if (chartType === 'heatmap') {
    const xColumn = categoricals[0] ?? columns[0]
    const yCat = categoricals.find((column) => column.name !== xColumn?.name)
    return {
      x: xColumn?.name ?? null,
      y: numerics[0] ? [numerics[0].name] : [],
      series: yCat?.name ?? null,
      size: null,
    }
  }

  if (chartType === 'box' || chartType === 'treemap' || chartType === 'waterfall') {
    const xColumn = lowCats[0] ?? categoricals[0] ?? temporal ?? columns[0]
    return {
      x: xColumn?.name ?? null,
      y: numerics[0] ? [numerics[0].name] : [],
      series: pickSeries(columns, xColumn?.name),
      size: null,
    }
  }

  if (chartType === 'combo') {
    const xColumn = temporal ?? lowCats[0] ?? columns[0]
    const yColumns = numerics.slice(0, 2).map((column) => column.name)
    return {
      x: xColumn?.name ?? null,
      y: yColumns,
      series: pickSeries(columns, xColumn?.name),
      size: null,
    }
  }

  const xColumn = temporal ?? lowCats[0] ?? categoricals[0] ?? columns[0]
  const yColumns = numerics.length > 0
    ? chartType === 'line' || chartType === 'area' || chartType === 'bar' || chartType === 'horizontalBar'
      ? [numerics[0].name]
      : [numerics[0].name]
    : columns.filter((column) => column.name !== xColumn?.name).slice(0, 1).map((column) => column.name)

  return {
    x: xColumn?.name ?? null,
    y: yColumns,
    series: pickSeries(columns, xColumn?.name),
    size: null,
  }
}

/**
 * Merges requested encodings with defaults. A requested column is kept only
 * when it exists in `columns`; otherwise that field falls back.
 */
export function resolveEncodings(
  columns: ColumnSchema[],
  chartType: BuilderChartType,
  requested?: RequestedEncodings | null,
): ChartEncodings {
  const defaults = defaultEncodings(columns, chartType)
  if (!requested) return defaults
  const names = new Set(columns.map((column) => column.name))
  const requestedY = requested.y?.filter((name) => names.has(name)) ?? []
  return {
    x: requested.x && names.has(requested.x) ? requested.x : defaults.x,
    y: requestedY.length > 0 ? requestedY : defaults.y,
    series: requested.series === null
      ? null
      : requested.series && names.has(requested.series)
        ? requested.series
        : defaults.series,
    size: requested.size === null
      ? null
      : requested.size && names.has(requested.size)
        ? requested.size
        : defaults.size,
  }
}

/** Builds a `VizConfig` for chart types backed by a `VizPlugin` (excludes `table`, which has no viz). */
export function buildVizConfig(
  chartType: ChartType,
  encodings: ChartEncodings,
  options?: Record<string, unknown>,
): VizConfig {
  const x: ColumnRef | undefined = encodings.x ? { column: encodings.x } : undefined
  const y: ColumnRef[] = encodings.y.map((column) => ({ column }))
  const series: ColumnRef | undefined = encodings.series ? { column: encodings.series } : undefined
  const size: ColumnRef | undefined = encodings.size ? { column: encodings.size } : undefined

  return {
    chartType,
    encodings: { x, y: y.length > 0 ? y : undefined, series, size },
    options: options ?? {},
  }
}

/** Reverse `VizConfig` encodings into Chart Builder picker state. */
export function vizConfigToEncodings(viz: VizConfig | null | undefined): ChartEncodings {
  if (!viz) return { ...EMPTY_ENCODINGS }
  return {
    x: viz.encodings.x?.column ?? null,
    y: viz.encodings.y?.map((ref) => ref.column) ?? [],
    series: viz.encodings.series?.column ?? null,
    size: viz.encodings.size?.column ?? null,
  }
}

export function applyWidgetPatch(
  widget: Widget,
  patch: { title?: string; viz?: VizConfig | null },
): Widget {
  return {
    ...widget,
    title: patch.title ?? widget.title,
    viz: patch.viz !== undefined ? patch.viz : widget.viz,
    locked: widget.locked,
  }
}
