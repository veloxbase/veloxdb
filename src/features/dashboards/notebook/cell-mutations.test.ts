import { describe, expect, it } from 'vitest'

import type { Dashboard } from '@/data/types'
import {
  addCell,
  deleteCell,
  duplicateVisualCell,
  reorderCells,
  toggleCellShowInApp,
  updateCell,
} from './cell-mutations'

describe('cell-mutations', () => {
  const initialDashboard: Dashboard = {
    version: 2,
    id: 'dash-mut',
    name: 'Mutation Test',
    connectionId: 'conn-1',
    cells: [
      { id: 'q1', type: 'sql', title: 'Query 1', sql: 'SELECT 1', outputName: 'q1', showInApp: false },
      { id: 'v1', type: 'visual', kind: 'chart', title: 'Chart 1', sourceCellId: 'q1', viz: null, showInApp: true },
      { id: 'm1', type: 'markdown', title: 'Header', content: '# Hello', showInApp: true },
    ],
    layout: [],
    widgets: {},
    variables: [],
    theme: 'inherit',
    refreshIntervalSec: null,
    createdAt: 1000,
    updatedAt: 1000,
  }

  it('adds a new cell and syncs widgets', () => {
    const updated = addCell(initialDashboard, {
      id: 'v2',
      type: 'visual',
      kind: 'kpi',
      title: 'KPI 2',
      sourceCellId: 'q1',
      viz: null,
      showInApp: true,
    })

    expect(updated.cells).toHaveLength(4)
    expect(updated.widgets['v2']).toBeDefined()
    expect(updated.layout.find((s) => s.i === 'v2')).toBeDefined()
  })

  it('updates a cell and updates derived widget', () => {
    const updated = updateCell(initialDashboard, 'q1', { sql: 'SELECT 2' })
    expect(updated.cells.find((c) => c.id === 'q1')?.type === 'sql' && (updated.cells.find((c) => c.id === 'q1') as any).sql).toBe('SELECT 2')
    // Derived visual widget should have updated sql
    expect(updated.widgets['v1']?.query?.sql).toBe('SELECT 2')
  })

  it('blocks deletion of SQL cell if visual cells depend on it', () => {
    expect(() => deleteCell(initialDashboard, 'q1')).toThrow(/Cannot delete query cell: referenced by visual cells "Chart 1"/)
  })

  it('cascades deletion of SQL cell and dependents when forceCascade is true', () => {
    const updated = deleteCell(initialDashboard, 'q1', { forceCascade: true })
    expect(updated.cells).toHaveLength(1)
    expect(updated.cells[0]?.id).toBe('m1')
    expect(updated.widgets['v1']).toBeUndefined()
  })

  it('reorders cells correctly', () => {
    const updated = reorderCells(initialDashboard, 'm1', 'q1')
    expect(updated.cells.map((c) => c.id)).toEqual(['m1', 'q1', 'v1'])
  })

  it('toggles showInApp and updates layout', () => {
    const toggledOff = toggleCellShowInApp(initialDashboard, 'v1')
    const v1Off = toggledOff.cells.find((c) => c.id === 'v1')
    expect(v1Off && 'showInApp' in v1Off ? v1Off.showInApp : undefined).toBe(false)
    expect(toggledOff.widgets['v1']).toBeUndefined()
    expect(toggledOff.layout.find((s) => s.i === 'v1')).toBeUndefined()

    const toggledOn = toggleCellShowInApp(toggledOff, 'v1')
    const v1On = toggledOn.cells.find((c) => c.id === 'v1')
    expect(v1On && 'showInApp' in v1On ? v1On.showInApp : undefined).toBe(true)
    expect(toggledOn.widgets['v1']).toBeDefined()
    expect(toggledOn.layout.find((s) => s.i === 'v1')).toBeDefined()
  })

  it('duplicates visual cell pointing to same sourceCellId', () => {
    const updated = duplicateVisualCell(initialDashboard, 'v1')
    expect(updated.cells).toHaveLength(4)
    const duplicate = updated.cells[2] // inserted after v1
    expect(duplicate?.type).toBe('visual')
    if (duplicate?.type === 'visual') {
      expect(duplicate.title).toBe('Chart 1 (copy)')
      expect(duplicate.sourceCellId).toBe('q1')
    }
  })

  it('safely mutates legacy dashboard without deleting existing widgets', () => {
    const legacyDash: Dashboard = {
      version: 1 as any,
      id: 'legacy-dash',
      name: 'Legacy',
      connectionId: 'conn-1',
      cells: [] as any,
      layout: [{ i: 'w1', x: 0, y: 0, w: 6, h: 4, isStatic: false }],
      widgets: {
        w1: {
          id: 'w1',
          kind: 'chart',
          title: 'Existing Chart',
          query: { providerId: 'sql-query', connectionId: 'conn-1', sql: 'SELECT 42', savedQueryId: null },
          viz: { chartType: 'bar', encodings: {}, options: {} },
          locked: false,
        },
      },
      variables: [{ name: 'tenant', type: 'text', defaultValue: 'acme' }],
      theme: 'inherit',
      refreshIntervalSec: null,
      createdAt: 1000,
      updatedAt: 1000,
    }

    const updated = addCell(legacyDash, {
      id: 'new-sql',
      type: 'sql',
      title: 'New Query',
      sql: 'SELECT 100',
      outputName: 'new_query',
      showInApp: false,
    })

    // Existing chart widget and variable should still be preserved
    expect(updated.widgets['w1']).toBeDefined()
    expect(updated.variables.find((v) => v.name === 'tenant')).toBeDefined()
    // Cells array should contain the migrated input, sql, visual, plus the new SQL cell
    expect(updated.cells.length).toBeGreaterThanOrEqual(4)
  })
})
