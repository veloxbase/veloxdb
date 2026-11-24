import { describe, expect, it } from 'vitest'

import type { Dashboard } from '@/data/types'
import { syncDashboardFromCells } from './sync-dashboard-from-cells'

describe('syncDashboardFromCells', () => {
  const baseDashboard: Dashboard = {
    version: 2,
    id: 'dash-test',
    name: 'Sync Test',
    connectionId: 'conn-1',
    cells: [],
    layout: [],
    widgets: {},
    variables: [],
    theme: 'inherit',
    refreshIntervalSec: null,
    createdAt: 1000,
    updatedAt: 1000,
  }

  it('rebuilds variables from input cells', () => {
    const dash: Dashboard = {
      ...baseDashboard,
      cells: [
        { id: 'in-1', type: 'input', varName: 'startDate', inputType: 'date', defaultValue: '2026-01-01' },
        { id: 'in-2', type: 'input', varName: 'tier', inputType: 'dropdown', defaultValue: 'pro', options: ['free', 'pro'] },
      ],
    }

    const synced = syncDashboardFromCells(dash)
    expect(synced.variables).toEqual([
      { name: 'startDate', type: 'date', defaultValue: '2026-01-01' },
      { name: 'tier', type: 'select', defaultValue: 'pro', options: ['free', 'pro'] },
    ])
  })

  it('rebuilds widgets and appends layout slots for showInApp cells', () => {
    const dash: Dashboard = {
      ...baseDashboard,
      cells: [
        { id: 'sql-1', type: 'sql', title: 'Orders Query', sql: 'SELECT * FROM orders', outputName: 'orders', showInApp: false },
        {
          id: 'viz-1',
          type: 'visual',
          kind: 'chart',
          title: 'Orders Chart',
          sourceCellId: 'sql-1',
          viz: { chartType: 'bar', encodings: {}, options: {} },
          showInApp: true,
        },
        {
          id: 'note-1',
          type: 'markdown',
          title: 'Notes',
          content: 'Important analysis',
          showInApp: true,
        },
      ],
    }

    const synced = syncDashboardFromCells(dash)

    // Only viz-1 and note-1 are showInApp
    expect(Object.keys(synced.widgets)).toEqual(['viz-1', 'note-1'])
    expect(synced.widgets['viz-1']).toEqual({
      id: 'viz-1',
      kind: 'chart',
      title: 'Orders Chart',
      query: {
        providerId: 'sql-query',
        connectionId: 'conn-1',
        sql: 'SELECT * FROM orders',
        savedQueryId: null,
        sourceCellId: 'sql-1',
      },
      viz: { chartType: 'bar', encodings: {}, options: {} },
      locked: false,
    })

    expect(synced.widgets['note-1']?.kind).toBe('text')
    expect(synced.widgets['note-1']?.viz?.options?.content).toBe('Important analysis')

    // Layout has 2 slots
    expect(synced.layout).toHaveLength(2)
    expect(synced.layout[0]?.i).toBe('viz-1')
    expect(synced.layout[1]?.i).toBe('note-1')
  })

  it('preserves existing layout slots when cells are modified', () => {
    const dash: Dashboard = {
      ...baseDashboard,
      cells: [
        { id: 'sql-1', type: 'sql', title: 'Q', sql: 'SELECT 1', outputName: 'q', showInApp: false },
        {
          id: 'viz-1',
          type: 'visual',
          kind: 'kpi',
          title: 'Metric',
          sourceCellId: 'sql-1',
          viz: null,
          showInApp: true,
        },
      ],
      layout: [{ i: 'viz-1', x: 2, y: 3, w: 4, h: 2, isStatic: true }],
    }

    const synced = syncDashboardFromCells(dash)
    expect(synced.layout).toEqual([{ i: 'viz-1', x: 2, y: 3, w: 4, h: 2, isStatic: true }])
  })

  it('removes layout slot when showInApp is toggled to false', () => {
    const dash: Dashboard = {
      ...baseDashboard,
      cells: [
        { id: 'sql-1', type: 'sql', title: 'Q', sql: 'SELECT 1', outputName: 'q', showInApp: false },
        {
          id: 'viz-1',
          type: 'visual',
          kind: 'kpi',
          title: 'Metric',
          sourceCellId: 'sql-1',
          viz: null,
          showInApp: false, // hidden from App view
        },
      ],
      layout: [{ i: 'viz-1', x: 0, y: 0, w: 3, h: 2 }],
    }

    const synced = syncDashboardFromCells(dash)
    expect(synced.widgets).toEqual({})
    expect(synced.layout).toEqual([])
  })
})
