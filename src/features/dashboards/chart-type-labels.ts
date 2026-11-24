import type { ChartType } from '@/data/types'
import type { BuilderChartType } from '@/features/dashboards/chart-builder-state'

export const CHART_TYPE_LABELS: Record<BuilderChartType, string> = {
  line: 'Line',
  area: 'Area',
  bar: 'Bar',
  horizontalBar: 'Horizontal bar',
  pie: 'Pie',
  donut: 'Donut',
  scatter: 'Scatter',
  heatmap: 'Heatmap',
  treemap: 'Treemap',
  gauge: 'Gauge',
  kpi: 'KPI',
  combo: 'Combo (bar + line)',
  histogram: 'Histogram',
  box: 'Box plot',
  waterfall: 'Waterfall',
  table: 'Table',
}

export const GENERATED_CHART_TYPES: ChartType[] = [
  'kpi',
  'line',
  'area',
  'bar',
  'horizontalBar',
  'pie',
  'donut',
  'combo',
  'scatter',
  'heatmap',
  'histogram',
  'box',
  'treemap',
  'gauge',
  'waterfall',
]

export function isGeneratedChartType(value: string): value is ChartType {
  return GENERATED_CHART_TYPES.includes(value as ChartType)
}

export function usesSingleY(chartType: BuilderChartType): boolean {
  return chartType === 'kpi' || chartType === 'gauge' || chartType === 'histogram' || chartType === 'box' || chartType === 'treemap' || chartType === 'waterfall' || chartType === 'heatmap'
}

export function showsSeriesField(chartType: BuilderChartType): boolean {
  return chartType !== 'table' && chartType !== 'kpi' && chartType !== 'gauge' && chartType !== 'histogram'
}

export function showsSizeField(chartType: BuilderChartType): boolean {
  return chartType === 'scatter'
}

export function showsBarLayoutField(chartType: BuilderChartType): boolean {
  return chartType === 'bar' || chartType === 'horizontalBar'
}

export function xFieldLabel(chartType: BuilderChartType): string {
  if (chartType === 'histogram') return 'Value'
  if (chartType === 'scatter') return 'X (numeric)'
  if (chartType === 'heatmap' || chartType === 'box' || chartType === 'treemap' || chartType === 'waterfall') return 'Category'
  return 'X axis'
}

export function yFieldLabel(chartType: BuilderChartType): string {
  if (chartType === 'kpi' || chartType === 'gauge') return 'Value'
  if (chartType === 'scatter') return 'Y (numeric)'
  if (chartType === 'heatmap' || chartType === 'treemap' || chartType === 'waterfall' || chartType === 'box') return 'Value'
  if (chartType === 'histogram') return 'Value'
  if (chartType === 'combo') return 'Y values (first bar, next line)'
  return 'Y values'
}

export function seriesFieldLabel(chartType: BuilderChartType): string {
  if (chartType === 'heatmap') return 'Y axis'
  if (chartType === 'treemap') return 'Parent / group'
  if (chartType === 'scatter') return 'Color'
  return 'Series'
}
