import { describe, expect, it } from 'vitest'

import type { Widget, WidgetLayout } from '@/data/types'
import { moveItem, resizeItem } from '@/features/dashboards/grid/grid-layout-engine'
import { compactLayout } from '@/features/dashboards/grid/grid-compaction'
import { colWidth, createGridMetrics, pixelSizeToGrid, pixelToGrid, slotToRect } from '@/features/dashboards/grid/grid-metrics'

const widgets: Record<string, Widget> = {
  a: { id: 'a', kind: 'chart', title: 'A', query: null, viz: null, locked: false },
  b: { id: 'b', kind: 'kpi', title: 'B', query: null, viz: null, locked: false },
  c: { id: 'c', kind: 'chart', title: 'C', query: null, viz: null, locked: true },
}

describe('grid-metrics', () => {
  it('converts grid units to pixels and back', () => {
    const metrics = createGridMetrics(1200)
    const slot: WidgetLayout = { i: 'a', x: 2, y: 1, w: 4, h: 3 }
    const rect = slotToRect(metrics, slot)
    const grid = pixelToGrid(metrics, rect.top, rect.left, slot.w, slot.h)
    expect(grid).toEqual({ x: 2, y: 1 })
    const size = pixelSizeToGrid(metrics, rect.width, rect.height, slot.x, slot.y)
    expect(size).toEqual({ w: 4, h: 3 })
  })

  it('does not change stored units when container width changes', () => {
    const narrow = createGridMetrics(800)
    const wide = createGridMetrics(1400)
    const slot: WidgetLayout = { i: 'a', x: 1, y: 0, w: 6, h: 2 }
    expect(slotToRect(narrow, slot).width).not.toBe(slotToRect(wide, slot).width)
    expect(colWidth(narrow)).toBeLessThan(colWidth(wide))
  })
})

describe('compactLayout', () => {
  it('removes vertical gaps', () => {
    const layout: WidgetLayout[] = [
      { i: 'a', x: 0, y: 4, w: 6, h: 2 },
      { i: 'b', x: 0, y: 0, w: 6, h: 2 },
    ]
    const compacted = compactLayout(layout, 12)
    expect(compacted.find((s) => s.i === 'a')?.y).toBe(2)
    expect(compacted.find((s) => s.i === 'b')?.y).toBe(0)
  })

  it('does not move static items', () => {
    const layout: WidgetLayout[] = [
      { i: 'c', x: 0, y: 2, w: 6, h: 2, isStatic: true },
      { i: 'a', x: 0, y: 5, w: 6, h: 2 },
    ]
    const compacted = compactLayout(layout, 12)
    expect(compacted.find((s) => s.i === 'c')?.y).toBe(2)
    expect(compacted.find((s) => s.i === 'a')?.y).toBe(4)
  })
})

describe('moveItem', () => {
  it('updates horizontal position', () => {
    const layout: WidgetLayout[] = [
      { i: 'a', x: 0, y: 0, w: 3, h: 2 },
      { i: 'b', x: 6, y: 0, w: 3, h: 2 },
    ]
    const next = moveItem(layout, widgets, 'a', 3, 0)
    expect(next.find((s) => s.i === 'a')).toMatchObject({ x: 3, y: 0 })
  })

  it('ignores locked/static items', () => {
    const layout: WidgetLayout[] = [
      { i: 'c', x: 0, y: 0, w: 6, h: 2, isStatic: true },
    ]
    const next = moveItem(layout, widgets, 'c', 3, 3)
    expect(next).toEqual(layout)
  })
})

describe('resizeItem', () => {
  it('clamps to widget constraints', () => {
    const layout: WidgetLayout[] = [
      { i: 'b', x: 0, y: 0, w: 3, h: 2 },
    ]
    const next = resizeItem(layout, widgets, 'b', 20, 1)
    const resized = next.find((s) => s.i === 'b')
    expect(resized?.w).toBeLessThanOrEqual(6)
    expect(resized?.h).toBeGreaterThanOrEqual(2)
  })
})
