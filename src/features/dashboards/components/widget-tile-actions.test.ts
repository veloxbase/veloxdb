import { describe, expect, it } from 'vitest'

import type { DashboardVariable, VizConfig } from '@/data/types'
import { activeSelection, resolveFilterVariable } from './widget-tile-actions'

const variables: DashboardVariable[] = [
  { name: 'region', type: 'select', defaultValue: '', options: ['EU', 'US'] },
  { name: 'plan', type: 'select', defaultValue: 'pro', options: ['pro', 'team'] },
]

const viz = (options: Record<string, unknown> = {}): VizConfig => ({
  chartType: 'bar',
  encodings: { x: { column: 'region' }, y: [{ column: 'revenue' }] },
  options,
})

describe('resolveFilterVariable', () => {
  it('matches the x column to a variable of the same name', () => {
    expect(resolveFilterVariable(viz(), 'region', variables)?.name).toBe('region')
  })

  it('honours viz.options.filterVariable', () => {
    expect(resolveFilterVariable(viz({ filterVariable: 'plan' }), 'region', variables)?.name).toBe('plan')
  })

  it('returns null when no variable matches', () => {
    expect(resolveFilterVariable(viz(), 'country', variables)).toBeNull()
  })
})

describe('activeSelection', () => {
  it('returns the current value for the matched column', () => {
    expect(activeSelection(variables[0]!, 'region', { region: 'EU' })).toEqual({
      column: 'region',
      value: 'EU',
    })
  })

  it('is empty when the variable is at its blank default', () => {
    expect(activeSelection(variables[0]!, 'region', {})).toBeNull()
  })
})
