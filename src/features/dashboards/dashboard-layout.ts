import type { Dashboard, Widget, WidgetLayout } from '@/data/types'
import { DEFAULT_WIDGET_SIZE } from '@/features/dashboards/grid-constants'

export function nextLayoutY(layout: WidgetLayout[]): number {
  if (layout.length === 0) return 0
  return Math.max(...layout.map((slot) => slot.y + slot.h))
}

export function appendLayoutSlot(
  dashboard: Dashboard,
  widgetId: string,
  kind: Widget['kind'],
  partial?: Partial<Pick<WidgetLayout, 'x' | 'y' | 'w' | 'h'>>,
): Dashboard {
  const size = DEFAULT_WIDGET_SIZE[kind]
  const y = partial?.y ?? nextLayoutY(dashboard.layout)
  const slot: WidgetLayout = {
    i: widgetId,
    x: partial?.x ?? 0,
    y,
    w: partial?.w ?? size.w,
    h: partial?.h ?? size.h,
  }
  return {
    ...dashboard,
    layout: [...dashboard.layout, slot],
    updatedAt: Date.now(),
  }
}

export function deleteWidget(dashboard: Dashboard, widgetId: string): Dashboard {
  const { [widgetId]: _removed, ...widgets } = dashboard.widgets
  return {
    ...dashboard,
    widgets,
    layout: dashboard.layout.filter((slot) => slot.i !== widgetId),
    updatedAt: Date.now(),
  }
}

export function duplicateWidget(dashboard: Dashboard, widgetId: string): Dashboard {
  const source = dashboard.widgets[widgetId]
  const sourceLayout = dashboard.layout.find((slot) => slot.i === widgetId)
  if (!source || !sourceLayout) return dashboard

  const newId = crypto.randomUUID()
  const newWidget: Widget = {
    ...structuredClone(source),
    id: newId,
    title: `${source.title} (copy)`,
    locked: false,
  }
  const newY = sourceLayout.y + sourceLayout.h
  const newSlot: WidgetLayout = {
    i: newId,
    x: sourceLayout.x,
    y: newY,
    w: sourceLayout.w,
    h: sourceLayout.h,
    isStatic: false,
  }

  return {
    ...dashboard,
    widgets: { ...dashboard.widgets, [newId]: newWidget },
    layout: [...dashboard.layout, newSlot],
    updatedAt: Date.now(),
  }
}

export function toggleWidgetLock(dashboard: Dashboard, widgetId: string): Dashboard {
  const widget = dashboard.widgets[widgetId]
  if (!widget) return dashboard
  const locked = !widget.locked
  return {
    ...dashboard,
    widgets: {
      ...dashboard.widgets,
      [widgetId]: { ...widget, locked },
    },
    layout: dashboard.layout.map((slot) =>
      slot.i === widgetId ? { ...slot, isStatic: locked } : slot,
    ),
    updatedAt: Date.now(),
  }
}

export function mergeLayoutChange(dashboard: Dashboard, nextLayout: WidgetLayout[]): Dashboard {
  return {
    ...dashboard,
    layout: nextLayout.map((slot) => {
      const existing = dashboard.layout.find((item) => item.i === slot.i)
      return {
        ...slot,
        isStatic: existing?.isStatic ?? false,
      }
    }),
    updatedAt: Date.now(),
  }
}
