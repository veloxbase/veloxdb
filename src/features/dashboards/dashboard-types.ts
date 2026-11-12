import type {
  ChartType,
  ColumnRef,
  ColumnRole,
  Dashboard,
  DashboardTheme,
  DashboardVariable,
  NotebookCell,
  SavedQuery,
  SavedQueryInput,
  VizConfig,
  Widget,
  WidgetKind,
  WidgetLayout,
  WidgetQuery,
} from '@/data/types'

export type {
  ChartType,
  ColumnRef,
  ColumnRole,
  Dashboard,
  DashboardTheme,
  DashboardVariable,
  NotebookCell,
  SavedQuery,
  SavedQueryInput,
  VizConfig,
  Widget,
  WidgetKind,
  WidgetLayout,
  WidgetQuery,
}

/** Bump when the `Dashboard` shape changes; `migrateDashboard()` upgrades older docs to this version. */
export const DASHBOARD_VERSION = 3 as const

export const WIDGET_KINDS: WidgetKind[] = [
  'chart', 'kpi', 'table', 'text', 'markdown', 'image', 'divider', 'filter',
]

export const CHART_TYPES: ChartType[] = [
  'line', 'area', 'bar', 'horizontalBar', 'pie', 'donut',
  'scatter', 'heatmap', 'treemap', 'gauge', 'kpi',
  'combo', 'histogram', 'box', 'waterfall',
]

export const MAX_DASHBOARD_WIDGETS = 50
