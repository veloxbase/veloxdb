import { describe, expect, it } from 'vitest'

import type { Dashboard } from '@/data/types'
import {
  appendLayoutSlot,
  deleteWidget,
  duplicateWidget,
  nextLayoutY,
  toggleWidgetLock,
} from '@/features/dashboards/dashboard-layout'

function emptyDashboard(): Dashboard {
  return {
    version: 2,
    id: 'd1',
    name: 'Test',
    connectionId: 'c1',
    cells: [],
    layout: [],
    widgets: {},
    variables: [],
    theme: 'inherit',
    refreshIntervalSec: null,
    createdAt: 0,
    updatedAt: 0,
  }
}

describe('nextLayoutY', () => {
  it('returns 0 for empty layout', () => {
    expect(nextLayoutY([])).toBe(0)
  })

  it('returns max y + h', () => {
    expect(nextLayoutY([
      { i: 'a', x: 0, y: 0, w: 6, h: 4 },
      { i: 'b', x: 0, y: 4, w: 6, h: 2 },
    ])).toBe(6)
  })
})

describe('appendLayoutSlot', () => {
  it('appends below existing widgets', () => {
    const base = {
      ...emptyDashboard(),
      layout: [{ i: 'a', x: 0, y: 0, w: 6, h: 4 }],
    }
    const next = appendLayoutSlot(base, 'b', 'chart')
    expect(next.layout).toHaveLength(2)
    expect(next.layout[1]?.y).toBe(4)
  })
})

describe('deleteWidget', () => {
  it('removes widget and layout slot', () => {
    const base: Dashboard = {
      ...emptyDashboard(),
      widgets: {
        a: { id: 'a', kind: 'text', title: 'A', query: null, viz: null, locked: false },
      },
      layout: [{ i: 'a', x: 0, y: 0, w: 4, h: 2 }],
    }
    const next = deleteWidget(base, 'a')
    expect(next.widgets).toEqual({})
    expect(next.layout).toHaveLength(0)
  })
})

describe('duplicateWidget', () => {
  it('creates a copy with new id below the original', () => {
    const base: Dashboard = {
      ...emptyDashboard(),
      widgets: {
        a: { id: 'a', kind: 'chart', title: 'Sales', query: null, viz: null, locked: false },
      },
      layout: [{ i: 'a', x: 0, y: 0, w: 6, h: 4 }],
    }
    const next = duplicateWidget(base, 'a')
    const ids = Object.keys(next.widgets)
    expect(ids).toHaveLength(2)
    expect(next.layout).toHaveLength(2)
    expect(next.layout[1]?.y).toBe(4)
  })
})

describe('toggleWidgetLock', () => {
  it('flips locked and isStatic', () => {
    const base: Dashboard = {
      ...emptyDashboard(),
      widgets: {
        a: { id: 'a', kind: 'chart', title: 'A', query: null, viz: null, locked: false },
      },
      layout: [{ i: 'a', x: 0, y: 0, w: 6, h: 4 }],
    }
    const locked = toggleWidgetLock(base, 'a')
    expect(locked.widgets.a?.locked).toBe(true)
    expect(locked.layout[0]?.isStatic).toBe(true)
  })
})
