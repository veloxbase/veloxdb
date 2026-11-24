import type { WidgetKind } from '@/data/types'

export const GRID_COLS = 12
export const GRID_ROW_HEIGHT = 64
export const GRID_MARGIN: [number, number] = [8, 8]
export const GRID_COMPACT_TYPE = 'vertical' as const

export const DEFAULT_WIDGET_SIZE: Record<WidgetKind, { w: number; h: number }> = {
  chart: { w: 6, h: 4 },
  kpi: { w: 3, h: 2 },
  table: { w: 6, h: 4 },
  text: { w: 4, h: 2 },
  markdown: { w: 4, h: 3 },
  image: { w: 4, h: 3 },
  divider: { w: 12, h: 1 },
  filter: { w: 3, h: 1 },
}

export const WIDGET_SIZE_CONSTRAINTS: Record<
  WidgetKind,
  { minW: number; minH: number; maxW?: number; maxH?: number }
> = {
  chart: { minW: 3, minH: 2, maxW: 12 },
  kpi: { minW: 2, minH: 2, maxW: 6 },
  table: { minW: 4, minH: 3, maxW: 12 },
  text: { minW: 2, minH: 1, maxW: 12 },
  markdown: { minW: 2, minH: 2, maxW: 12 },
  image: { minW: 2, minH: 2, maxW: 12 },
  divider: { minW: 4, minH: 1, maxW: 12, maxH: 2 },
  filter: { minW: 2, minH: 1, maxW: 12, maxH: 2 },
}
