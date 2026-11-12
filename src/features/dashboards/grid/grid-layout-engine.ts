import type { Widget, WidgetLayout } from '@/data/types'
import { GRID_COLS } from '@/features/dashboards/grid-constants'

import { compactLayout } from '@/features/dashboards/grid/grid-compaction'
import { clampSlot, constraintsForWidget } from '@/features/dashboards/grid/grid-snap'

function findSlot(layout: WidgetLayout[], itemId: string): WidgetLayout | undefined {
  return layout.find((slot) => slot.i === itemId)
}

function withConstraints(
  layout: WidgetLayout[],
  widgets: Record<string, Widget>,
): WidgetLayout[] {
  return layout.map((slot) => {
    const widget = widgets[slot.i]
    return clampSlot(slot, constraintsForWidget(widget), GRID_COLS)
  })
}

export function moveItem(
  layout: WidgetLayout[],
  widgets: Record<string, Widget>,
  itemId: string,
  x: number,
  y: number,
): WidgetLayout[] {
  const current = findSlot(layout, itemId)
  if (!current || current.isStatic) return layout

  const next = layout.map((slot) =>
    slot.i === itemId ? { ...slot, x, y } : slot,
  )
  return compactLayout(withConstraints(next, widgets), GRID_COLS)
}

export function resizeItem(
  layout: WidgetLayout[],
  widgets: Record<string, Widget>,
  itemId: string,
  w: number,
  h: number,
): WidgetLayout[] {
  const current = findSlot(layout, itemId)
  if (!current || current.isStatic) return layout

  const next = layout.map((slot) =>
    slot.i === itemId ? { ...slot, w, h } : slot,
  )
  return compactLayout(withConstraints(next, widgets), GRID_COLS)
}

export function applyGridLayoutChange(
  layout: WidgetLayout[],
  widgets: Record<string, Widget>,
): WidgetLayout[] {
  return compactLayout(withConstraints(layout, widgets), GRID_COLS)
}
