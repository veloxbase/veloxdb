import { describe, expect, it } from 'vitest'

import { migrateDashboard } from './dashboard-migrate'

describe('dashboard-migrate v1 -> v2', () => {
  it('migrates a v1 dashboard with 2 SQL charts, 1 note, and 1 variable', () => {
    const v1Doc = {
      version: 1,
      id: 'dash-1',
      name: 'Revenue Dashboard',
      description: 'Q3 metrics',
      connectionId: 'conn-1',
      variables: [
        { name: 'country', type: 'text', defaultValue: 'US' },
      ],
      layout: [
        { i: 'w-kpi', x: 0, y: 0, w: 4, h: 2 },
        { i: 'w-chart', x: 4, y: 0, w: 8, h: 4 },
        { i: 'w-note', x: 0, y: 4, w: 12, h: 2 },
      ],
      widgets: {
        'w-kpi': {
          id: 'w-kpi',
          kind: 'kpi',
          title: 'Total Revenue',
          query: {
            providerId: 'sql-query',
            connectionId: 'conn-1',
            sql: 'SELECT SUM(amount) AS total FROM sales WHERE country = {{country}}',
            savedQueryId: null,
          },
          viz: { chartType: 'kpi', encodings: {}, options: {} },
          locked: false,
        },
        'w-chart': {
          id: 'w-chart',
          kind: 'chart',
          title: 'Monthly Breakdown',
          query: {
            providerId: 'sql-query',
            connectionId: 'conn-1',
            sql: 'SELECT month, sum(amount) as mrr FROM sales GROUP BY 1',
            savedQueryId: null,
          },
          viz: { chartType: 'bar', encodings: {}, options: {} },
          locked: false,
        },
        'w-note': {
          id: 'w-note',
          kind: 'text',
          title: 'Notes',
          query: null,
          viz: { chartType: 'line', encodings: {}, options: { content: 'Keep eye on churn' } },
          locked: false,
        },
      },
      theme: 'inherit',
      refreshIntervalSec: null,
      createdAt: 1000,
      updatedAt: 1000,
    }

    const migrated = migrateDashboard(v1Doc)

    expect(migrated.version).toBe(3)
    expect(migrated.pages?.[0]?.name).toBe('Overview')
    expect(migrated.id).toBe('dash-1')
    expect(migrated.name).toBe('Revenue Dashboard')

    // Expect 1 input cell + 2 SQL cells + 2 visual cells + 1 markdown cell = 6 cells
    expect(migrated.cells).toHaveLength(6)

    // Input cell
    expect(migrated.cells[0]).toEqual({
      id: 'input_country',
      type: 'input',
      varName: 'country',
      inputType: 'text',
      defaultValue: 'US',
    })

    // KPI SQL and Visual cells
    const kpiSql = migrated.cells.find((c) => c.id === 'w-kpi_sql')
    const kpiVisual = migrated.cells.find((c) => c.id === 'w-kpi')
    expect(kpiSql).toBeDefined()
    expect(kpiSql?.type).toBe('sql')
    if (kpiSql?.type === 'sql') {
      expect(kpiSql.sql).toBe('SELECT SUM(amount) AS total FROM sales WHERE country = {{country}}')
      expect(kpiSql.showInApp).toBe(false)
    }

    expect(kpiVisual).toBeDefined()
    expect(kpiVisual?.type).toBe('visual')
    if (kpiVisual?.type === 'visual') {
      expect(kpiVisual.sourceCellId).toBe('w-kpi_sql')
      expect(kpiVisual.kind).toBe('kpi')
      expect(kpiVisual.showInApp).toBe(true)
    }

    // Chart SQL and Visual cells
    const chartSql = migrated.cells.find((c) => c.id === 'w-chart_sql')
    const chartVisual = migrated.cells.find((c) => c.id === 'w-chart')
    expect(chartSql).toBeDefined()
    expect(chartVisual).toBeDefined()
    if (chartVisual?.type === 'visual') {
      expect(chartVisual.sourceCellId).toBe('w-chart_sql')
      expect(chartVisual.kind).toBe('chart')
      expect(chartVisual.showInApp).toBe(true)
    }

    // Markdown cell
    const noteCell = migrated.cells.find((c) => c.id === 'w-note')
    expect(noteCell).toBeDefined()
    expect(noteCell?.type).toBe('markdown')
    if (noteCell?.type === 'markdown') {
      expect(noteCell.content).toBe('Keep eye on churn')
      expect(noteCell.showInApp).toBe(true)
    }

    // Layout slots preserved
    expect(migrated.layout).toEqual([
      { i: 'w-kpi', x: 0, y: 0, w: 4, h: 2 },
      { i: 'w-chart', x: 4, y: 0, w: 8, h: 4 },
      { i: 'w-note', x: 0, y: 4, w: 12, h: 2 },
    ])

    // Widgets have sourceCellId populated
    expect(migrated.widgets['w-kpi']?.query?.sourceCellId).toBe('w-kpi_sql')
    expect(migrated.widgets['w-chart']?.query?.sourceCellId).toBe('w-chart_sql')
  })

  it('maps a v1 select variable to a dropdown input cell with its options', () => {
    const migrated = migrateDashboard({
      version: 1,
      id: 'dash-2',
      name: 'Filters',
      connectionId: 'conn-1',
      variables: [
        { name: 'tier', type: 'select', defaultValue: '', options: ['free', 'pro'], label: 'Plan tier' },
      ],
      layout: [],
      widgets: {},
      theme: 'inherit',
      refreshIntervalSec: null,
      createdAt: 1,
      updatedAt: 1,
    })

    expect(migrated.cells).toEqual([
      {
        id: 'input_tier',
        type: 'input',
        varName: 'tier',
        inputType: 'dropdown',
        defaultValue: '',
        options: ['free', 'pro'],
      },
    ])
    expect(migrated.variables).toEqual([
      { name: 'tier', type: 'select', defaultValue: '', options: ['free', 'pro'], label: 'Plan tier' },
    ])
  })
})

describe('dashboard-migrate v2 select variables', () => {
  const baseV2 = {
    version: 2,
    id: 'dash-3',
    name: 'Ops',
    connectionId: 'conn-1',
    layout: [],
    widgets: {},
    theme: 'inherit',
    refreshIntervalSec: null,
    createdAt: 1,
    updatedAt: 1,
  }

  it('accepts select variables with options and label alongside a dropdown input cell', () => {
    const migrated = migrateDashboard({
      ...baseV2,
      cells: [
        { id: 'input_region', type: 'input', varName: 'region', inputType: 'dropdown', defaultValue: 'EU', options: ['EU', 'US'] },
      ],
      variables: [
        { name: 'region', type: 'select', defaultValue: 'EU', options: ['EU', 'US'], label: 'Region' },
        { name: 'date_from', type: 'date', defaultValue: '2026-01-01' },
      ],
    })

    expect(migrated.variables[0]).toEqual({
      name: 'region',
      type: 'select',
      defaultValue: 'EU',
      options: ['EU', 'US'],
      label: 'Region',
    })
    expect(migrated.variables[1]).toEqual({ name: 'date_from', type: 'date', defaultValue: '2026-01-01' })
  })

  it('rejects an unknown variable type', () => {
    expect(() =>
      migrateDashboard({
        ...baseV2,
        cells: [],
        variables: [{ name: 'x', type: 'multiselect', defaultValue: '' }],
      }),
    ).toThrow('Dashboard document failed validation.')
  })
})
