import { describe, expect, it } from 'vitest'
import { composeDashboardGrid } from './dashboard-grid-composer'
import type { ValidatedWidgetItem } from './dashboard-generator-types'

describe('dashboard-grid-composer', () => {
  it('handles empty widget list', () => {
    const dashboard = composeDashboardGrid('conn-1', 'Empty Board', 'No widgets', [])
    expect(dashboard.name).toBe('Empty Board')
    expect(dashboard.connectionId).toBe('conn-1')
    expect(dashboard.layout).toHaveLength(0)
    expect(Object.keys(dashboard.widgets)).toHaveLength(0)
  })

  it('lays out 3 KPIs in top row and 2 charts underneath without overlapping', () => {
    const items: ValidatedWidgetItem[] = [
      {
        id: 'kpi-1',
        title: 'Total Sales',
        kind: 'kpi',
        sql: 'SELECT 100 AS val',
        viz: { chartType: 'kpi', encodings: {}, options: {} },
        rowCount: 1,
        columns: ['val'],
      },
      {
        id: 'kpi-2',
        title: 'Active Users',
        kind: 'kpi',
        sql: 'SELECT 50 AS val',
        viz: { chartType: 'kpi', encodings: {}, options: {} },
        rowCount: 1,
        columns: ['val'],
      },
      {
        id: 'kpi-3',
        title: 'Retention Rate',
        kind: 'kpi',
        sql: 'SELECT 0.85 AS val',
        viz: { chartType: 'kpi', encodings: {}, options: {} },
        rowCount: 1,
        columns: ['val'],
      },
      {
        id: 'chart-1',
        title: 'Monthly Revenue',
        kind: 'chart',
        sql: 'SELECT month, rev FROM monthly_rev',
        viz: { chartType: 'line', encodings: {}, options: {} },
        rowCount: 12,
        columns: ['month', 'rev'],
      },
      {
        id: 'chart-2',
        title: 'Category Breakdown',
        kind: 'chart',
        sql: 'SELECT cat, cnt FROM categories',
        viz: { chartType: 'bar', encodings: {}, options: {} },
        rowCount: 5,
        columns: ['cat', 'cnt'],
      },
    ]

    const dashboard = composeDashboardGrid('conn-1', 'Executive Dashboard', 'Key metrics', items)

    expect(dashboard.layout).toHaveLength(5)
    expect(Object.keys(dashboard.widgets)).toHaveLength(5)

    // Check KPIs: should all be at y=0, each width 4
    const kpiSlots = dashboard.layout.filter((l) => l.i.startsWith('kpi'))
    expect(kpiSlots).toHaveLength(3)
    expect(kpiSlots.map((s) => s.y)).toEqual([0, 0, 0])
    expect(kpiSlots.map((s) => s.x)).toEqual([0, 4, 8])
    expect(kpiSlots.map((s) => s.w)).toEqual([4, 4, 4])
    expect(kpiSlots.map((s) => s.h)).toEqual([2, 2, 2])

    // Check Charts: should start below KPIs at y=2
    const chartSlots = dashboard.layout.filter((l) => l.i.startsWith('chart'))
    expect(chartSlots).toHaveLength(2)
    expect(chartSlots.map((s) => s.y)).toEqual([2, 2])
    expect(chartSlots.map((s) => s.x)).toEqual([0, 6])
    expect(chartSlots.map((s) => s.w)).toEqual([6, 6])
    expect(chartSlots.map((s) => s.h)).toEqual([4, 4])
  })

  it('wraps 4 KPIs evenly with width 3 each', () => {
    const items: ValidatedWidgetItem[] = [1, 2, 3, 4].map((idx) => ({
      id: `kpi-${idx}`,
      title: `Metric ${idx}`,
      kind: 'kpi',
      sql: `SELECT ${idx} AS val`,
      viz: { chartType: 'kpi', encodings: {}, options: {} },
      rowCount: 1,
      columns: ['val'],
    }))

    const dashboard = composeDashboardGrid('conn-1', 'KPIs Board', undefined, items)
    expect(dashboard.layout).toHaveLength(4)
    expect(dashboard.layout.map((s) => s.w)).toEqual([3, 3, 3, 3])
    expect(dashboard.layout.map((s) => s.x)).toEqual([0, 3, 6, 9])
    expect(dashboard.layout.map((s) => s.y)).toEqual([0, 0, 0, 0])

    // Verify v2 cells generation (4 SQL cells + 4 visual cells = 8 cells)
    expect(dashboard.cells).toHaveLength(8)
    const sqlCells = dashboard.cells.filter((c) => c.type === 'sql')
    const visualCells = dashboard.cells.filter((c) => c.type === 'visual')
    expect(sqlCells).toHaveLength(4)
    expect(visualCells).toHaveLength(4)
    expect(dashboard.widgets['kpi-1']?.query?.sourceCellId).toBe('kpi-1_sql')
  })
})
