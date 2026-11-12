import type { Widget, WidgetLayout } from '@/data/types'
import { GRID_COLS, WIDGET_SIZE_CONSTRAINTS } from '@/features/dashboards/grid-constants'

export type SizeConstraints = {
  minW: number
  minH: number
  maxW?: number
  maxH?: number
}

export function constraintsForWidget(widget: Widget | undefined): SizeConstraints {
  const kind = widget?.kind ?? 'chart'
  return WIDGET_SIZE_CONSTRAINTS[kind] ?? WIDGET_SIZE_CONSTRAINTS.chart
}

export function clampSlot(
  slot: WidgetLayout,
  constraints: SizeConstraints,
  cols: number = GRID_COLS,
): WidgetLayout {
  const maxW = constraints.maxW ?? cols
  const maxH = constraints.maxH ?? 200
  const w = Math.max(constraints.minW, Math.min(maxW, slot.w, cols - slot.x))
  const h = Math.max(constraints.minH, Math.min(maxH, slot.h))
  const x = Math.max(0, Math.min(cols - w, slot.x))
  const y = Math.max(0, slot.y)
  return { ...slot, x, y, w, h }
}
