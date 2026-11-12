import { createChartScene } from '@tanstack/charts/scene'
import { beforeAll, describe, expect, it } from 'vitest'

import type { ChartType, QueryResult, VizConfig } from '@/data/types'
import { buildVizConfig } from '@/features/dashboards/chart-builder-state'
import { registerBuiltInPlugins } from '@/features/plugins/bootstrap'
import { getChartPlugin, listVizPlugins } from '@/features/plugins/registry'

// Our builders return a DOM chart definition; the scene compiler is typed for
// static definitions but accepts both at runtime.
type SceneDefinition = Parameters<typeof createChartScene>[0]

function result(columns: string[], rows: Array<Record<string, string>>): QueryResult {
  return {
    columns,
    rows,
    rowCount: rows.length,
    executionMs: 1,
    truncated: false,
    commandTag: null,
  }
}

beforeAll(() => {
  registerBuiltInPlugins()
})

const fixtures: Record<Exclude<ChartType, 'kpi'>, { result: QueryResult; viz: VizConfig }> = {
  line: {
    result: result(['day', 'total'], [{ day: '2024-01-01', total: '10' }, { day: '2024-01-02', total: '12' }]),
    viz: buildVizConfig('line', { x: 'day', y: ['total'], series: null, size: null }),
  },
  area: {
    result: result(['day', 'total'], [{ day: '2024-01-01', total: '10' }, { day: '2024-01-02', total: '12' }]),
    viz: buildVizConfig('area', { x: 'day', y: ['total'], series: null, size: null }),
  },
  bar: {
    result: result(['region', 'plan', 'revenue'], [
      { region: 'east', plan: 'cloud', revenue: '10' },
      { region: 'west', plan: 'pro', revenue: '8' },
    ]),
    viz: buildVizConfig('bar', { x: 'region', y: ['revenue'], series: 'plan', size: null }, { barLayout: 'stack' }),
  },
  horizontalBar: {
    result: result(['region', 'revenue'], [{ region: 'east', revenue: '10' }]),
    viz: buildVizConfig('horizontalBar', { x: 'region', y: ['revenue'], series: null, size: null }),
  },
  pie: {
    result: result(['region', 'revenue'], [{ region: 'east', revenue: '10' }, { region: 'west', revenue: '8' }]),
    viz: buildVizConfig('pie', { x: 'region', y: ['revenue'], series: null, size: null }),
  },
  donut: {
    result: result(['region', 'revenue'], [{ region: 'east', revenue: '10' }, { region: 'west', revenue: '8' }]),
    viz: buildVizConfig('donut', { x: 'region', y: ['revenue'], series: null, size: null }),
  },
  scatter: {
    result: result(['price', 'quantity'], [{ price: '10', quantity: '2' }, { price: '12', quantity: '5' }]),
    viz: buildVizConfig('scatter', { x: 'price', y: ['quantity'], series: null, size: null }),
  },
  heatmap: {
    result: result(['day', 'hour', 'count'], [{ day: 'mon', hour: '9', count: '3' }]),
    viz: buildVizConfig('heatmap', { x: 'day', y: ['count'], series: 'hour', size: null }),
  },
  histogram: {
    result: result(['amount'], Array.from({ length: 12 }, (_, i) => ({ amount: String(i) }))),
    viz: buildVizConfig('histogram', { x: null, y: ['amount'], series: null, size: null }),
  },
  box: {
    result: result(['region', 'amount'], [
      { region: 'east', amount: '4' },
      { region: 'east', amount: '8' },
      { region: 'west', amount: '6' },
    ]),
    viz: buildVizConfig('box', { x: 'region', y: ['amount'], series: null, size: null }),
  },
  combo: {
    result: result(['day', 'revenue', 'orders'], [{ day: '2024-01-01', revenue: '10', orders: '2' }]),
    viz: buildVizConfig('combo', { x: 'day', y: ['revenue', 'orders'], series: null, size: null }),
  },
  gauge: {
    result: result(['rate'], [{ rate: '0.42' }]),
    viz: buildVizConfig('gauge', { x: null, y: ['rate'], series: null, size: null }),
  },
  treemap: {
    result: result(['plan', 'revenue'], [{ plan: 'cloud', revenue: '10' }, { plan: 'pro', revenue: '6' }]),
    viz: buildVizConfig('treemap', { x: 'plan', y: ['revenue'], series: null, size: null }),
  },
  waterfall: {
    result: result(['step', 'delta'], [{ step: 'start', delta: '10' }, { step: 'cost', delta: '-3' }]),
    viz: buildVizConfig('waterfall', { x: 'step', y: ['delta'], series: null, size: null }),
  },
}

describe('built-in TanStack chart plugins', () => {
  it('registers every implemented chart type', () => {
    const types = listVizPlugins().map((plugin) => plugin.chartType)
    expect(types).toEqual(expect.arrayContaining(Object.keys(fixtures)))
  })

  it.each(Object.keys(fixtures) as Array<Exclude<ChartType, 'kpi'>>)('builds a %s chart from TanStack marks', (chartType) => {
    const fixture = fixtures[chartType]
    const definition = getChartPlugin(chartType)?.buildChart(fixture.result, fixture.viz)
    expect(definition).toBeTruthy()
    expect(() => createChartScene(definition! as unknown as SceneDefinition, { width: 320, height: 200 })).not.toThrow()
  })

  it('builds bar, line, and pie with a click-to-filter selection', () => {
    const selection = { column: 'region', value: 'east' }
    for (const chartType of ['bar', 'line', 'pie'] as const) {
      const fixture = fixtures[chartType]
      expect(getChartPlugin(chartType)?.buildChart(fixture.result, fixture.viz, { selection })).toBeTruthy()
    }
  })
})
