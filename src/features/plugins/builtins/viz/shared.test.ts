import { describe, expect, it } from 'vitest'

import { coerceQueryResult } from '@/features/dashboards/data/typed-rows'
import {
  categoryValue,
  selectionStates,
  toLongSeries,
} from '@/features/plugins/builtins/viz/shared'

describe('toLongSeries', () => {
  it('uses the series column for long-form query results', () => {
    const typed = coerceQueryResult({
      columns: ['month', 'plan', 'revenue'],
      rows: [
        { month: '2024-01', plan: 'cloud', revenue: '10' },
        { month: '2024-01', plan: 'pro', revenue: '8' },
      ],
      rowCount: 2,
      executionMs: 1,
      truncated: false,
      commandTag: null,
    })

    const rows = toLongSeries(typed, 'month', ['revenue'], categoryValue, 'plan')
    expect(rows).toEqual([
      expect.objectContaining({ x: '2024-01', y: 10, series: 'cloud' }),
      expect.objectContaining({ x: '2024-01', y: 8, series: 'pro' }),
    ])
  })

  it('folds extra y columns when no series encoding is set', () => {
    const typed = coerceQueryResult({
      columns: ['month', 'revenue', 'cost'],
      rows: [{ month: '2024-01', revenue: '10', cost: '4' }],
      rowCount: 1,
      executionMs: 1,
      truncated: false,
      commandTag: null,
    })

    const rows = toLongSeries(typed, 'month', ['revenue', 'cost'], categoryValue)
    expect(rows.map((row) => row.series)).toEqual(['revenue', 'cost'])
    expect(rows.map((row) => row.y)).toEqual([10, 4])
  })
})

describe('selectionStates', () => {
  const east = { row: { region: 'east' } }
  const west = { row: { region: 'west' } }

  it('is a no-op when nothing is selected', () => {
    expect(selectionStates(undefined, 'region')).toBeUndefined()
    expect(selectionStates({ selection: null }, 'region')).toBeUndefined()
  })

  it('ignores a selection on a different column', () => {
    expect(selectionStates({ selection: { column: 'plan', value: 'pro' } }, 'region')).toBeUndefined()
  })

  it('dims every datum whose category is not the selected value', () => {
    const states = selectionStates({ selection: { column: 'region', value: 'east' } }, 'region')
    expect(states).toHaveLength(1)
    const when = states![0]!.when as (context: { datum: unknown }) => boolean
    expect(when({ datum: east })).toBe(false)
    expect(when({ datum: west })).toBe(true)
  })
})
