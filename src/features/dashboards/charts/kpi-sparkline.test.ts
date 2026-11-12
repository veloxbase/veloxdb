import { createChartScene } from '@tanstack/charts/scene'
import { describe, expect, it } from 'vitest'

import { defineKpiSparkline } from './kpi-sparkline'

// Our builders return a DOM chart definition; the scene compiler is typed for
// static definitions but accepts both at runtime.
type SceneDefinition = Parameters<typeof createChartScene>[0]

describe('defineKpiSparkline', () => {
  it('returns null when there are fewer than two points', () => {
    expect(defineKpiSparkline(undefined)).toBeNull()
    expect(defineKpiSparkline([1])).toBeNull()
  })

  it('compiles a hidden-axis line with real x/y scales', () => {
    const definition = defineKpiSparkline([10, 14, 12, 18])
    expect(definition).toBeTruthy()
    expect(() => createChartScene(definition! as unknown as SceneDefinition, { width: 240, height: 64 })).not.toThrow()
  })
})
