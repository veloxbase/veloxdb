import type { Dashboard, VizConfig, Widget, WidgetLayout } from '@/data/types'
import { DASHBOARD_VERSION } from '@/features/dashboards/dashboard-types'

export function createEmptyDashboard(connectionId: string, name: string): Dashboard {
  const now = Date.now()
  return {
    version: DASHBOARD_VERSION,
    id: crypto.randomUUID(),
    name,
    description: undefined,
    connectionId,
    cells: [],
    layout: [],
    widgets: {},
    variables: [],
    theme: 'inherit',
    refreshIntervalSec: null,
    pages: [{ id: 'page_overview', name: 'Overview', widgetIds: [] }],
    createdAt: now,
    updatedAt: now,
  }
}

/** Static note widget — content lives in `viz.options.content`; no query is attached. */
export function createTextWidget(id: string, title: string, content = ''): Widget {
  return {
    id,
    kind: 'text',
    title,
    query: null,
    viz: { chartType: 'line', encodings: {}, options: { content } },
    locked: false,
  }
}

/** Default layout slot for chart widgets on the dashboard grid. */
const DEFAULT_CHART_LAYOUT = { w: 6, h: 4 } as const

export function createChartWidget(
  id: string,
  title: string,
  query: { connectionId: string; sql: string; savedQueryId?: string | null },
  viz: VizConfig,
  layout?: Partial<Pick<WidgetLayout, 'x' | 'y' | 'w' | 'h'>>,
): { widget: Widget; layout: WidgetLayout } {
  return {
    widget: {
      id,
      kind: 'chart',
      title,
      query: {
        providerId: 'sql-query',
        connectionId: query.connectionId,
        sql: query.sql,
        savedQueryId: query.savedQueryId ?? null,
      },
      viz,
      locked: false,
    },
    layout: {
      i: id,
      x: layout?.x ?? 0,
      y: layout?.y ?? 0,
      w: layout?.w ?? DEFAULT_CHART_LAYOUT.w,
      h: layout?.h ?? DEFAULT_CHART_LAYOUT.h,
    },
  }
}

export function duplicateDashboardDocument(source: Dashboard, newId: string): Dashboard {
  const now = Date.now()
  return {
    ...source,
    id: newId,
    name: `${source.name} (copy)`,
    createdAt: now,
    updatedAt: now,
  }
}
