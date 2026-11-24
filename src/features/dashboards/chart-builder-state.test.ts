import { describe, expect, it } from 'vitest'

import { defaultEncodings } from '@/features/dashboards/chart-builder-state'
import type { ColumnSchema } from '@/features/dashboards/data/column-analysis'

const columns: ColumnSchema[] = [
  { name: 'month', role: 'temporal', sampleSize: 4, distinctCount: 4 },
  { name: 'plan', role: 'categorical', cardinality: 'low', sampleSize: 4, distinctCount: 2 },
  { name: 'revenue', role: 'numeric', sampleSize: 4, distinctCount: 4 },
]

describe('defaultEncodings', () => {
  it('picks the extra low-cardinality category as series', () => {
    expect(defaultEncodings(columns, 'bar')).toEqual({
      x: 'month',
      y: ['revenue'],
      series: 'plan',
      size: null,
    })
  })

  it('maps scatter to two numerics plus optional size', () => {
    const scatterColumns: ColumnSchema[] = [
      { name: 'price', role: 'numeric', sampleSize: 8, distinctCount: 8 },
      { name: 'quantity', role: 'numeric', sampleSize: 8, distinctCount: 8 },
      { name: 'weight', role: 'numeric', sampleSize: 8, distinctCount: 8 },
      { name: 'region', role: 'categorical', cardinality: 'low', sampleSize: 8, distinctCount: 3 },
    ]
    expect(defaultEncodings(scatterColumns, 'scatter')).toEqual({
      x: 'price',
      y: ['quantity'],
      series: 'region',
      size: 'weight',
    })
  })

  it('maps heatmap categories to x and series', () => {
    const heatColumns: ColumnSchema[] = [
      { name: 'weekday', role: 'categorical', cardinality: 'low', sampleSize: 7, distinctCount: 7 },
      { name: 'hour', role: 'categorical', cardinality: 'low', sampleSize: 7, distinctCount: 6 },
      { name: 'events', role: 'numeric', sampleSize: 7, distinctCount: 7 },
    ]
    expect(defaultEncodings(heatColumns, 'heatmap')).toEqual({
      x: 'weekday',
      y: ['events'],
      series: 'hour',
      size: null,
    })
  })
})
