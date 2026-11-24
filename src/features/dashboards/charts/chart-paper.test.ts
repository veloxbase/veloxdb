import { describe, expect, it } from 'vitest'

import { buildVizConfig } from '@/features/dashboards/chart-builder-state'
import {
  CHART_GRAIN_STRENGTH,
  GRAIN_AUTO_COLORS,
  GRAIN_COLOR_BACK,
  chartGrainPalette,
  grainColorBack,
  chartGrainStrengthParams,
  chartPaperConfigFromFields,
  chartPaperFieldsFromConfig,
  mergeChartPaperConfig,
  normalizePaperHex,
  parseChartPaperOptions,
} from '@/features/dashboards/charts/chart-paper'

describe('chartGrainPalette', () => {
  it('uses the Paper grain-gradient demo colors for auto', () => {
    expect(chartGrainPalette('auto')).toEqual({
      colors: [...GRAIN_AUTO_COLORS],
    })
  })

  it('maps accent to the first chart token', () => {
    expect(chartGrainPalette('accent')).toEqual({
      colors: ['var(--chart-1)'],
    })
  })

  it('maps neutral to a single gray', () => {
    expect(chartGrainPalette('neutral')).toEqual({
      colors: ['#8a8a94'],
    })
  })

  it('uses a single custom hex', () => {
    expect(chartGrainPalette('custom', '#aabbcc')).toEqual({
      colors: ['#aabbcc'],
    })
  })

  it('falls back to auto when custom has no valid hex', () => {
    expect(chartGrainPalette('custom')).toEqual({
      colors: [...GRAIN_AUTO_COLORS],
    })
  })
})

describe('grainColorBack', () => {
  it('returns the mapped hex for a named theme', () => {
    expect(grainColorBack('forest')).toBe(GRAIN_COLOR_BACK.forest)
    expect(grainColorBack('light')).toBe('#ffffff')
    expect(grainColorBack('dark')).toBe('#000000')
  })
})

describe('chartGrainStrengthParams', () => {
  it('returns null when the grain is off', () => {
    expect(chartGrainStrengthParams('off')).toBeNull()
  })

  it('matches the frozen corners preset on medium', () => {
    expect(chartGrainStrengthParams('medium')).toEqual({
      softness: 1,
      intensity: 1,
      noise: 1,
    })
  })

  it('keeps soft quieter than medium', () => {
    const soft = CHART_GRAIN_STRENGTH.soft
    const medium = CHART_GRAIN_STRENGTH.medium
    expect(soft.intensity).toBeLessThan(medium.intensity)
    expect(soft.noise).toBeLessThan(medium.noise)
  })
})

describe('parseChartPaperOptions', () => {
  it('returns empty when paper is missing or junk', () => {
    expect(parseChartPaperOptions(undefined)).toEqual({})
    expect(parseChartPaperOptions({})).toEqual({})
    expect(parseChartPaperOptions({ paper: 'nope' })).toEqual({})
    expect(parseChartPaperOptions({ paper: { tint: 'neon', strength: 2, color: 'blue' } })).toEqual({})
  })

  it('accepts #abc and #aabbcc', () => {
    expect(parseChartPaperOptions({ paper: { tint: 'custom', color: '#abc' } })).toEqual({
      tint: 'custom',
      color: '#aabbcc',
    })
    expect(parseChartPaperOptions({ paper: { tint: 'custom', color: '#AAbbCC' } })).toEqual({
      tint: 'custom',
      color: '#aabbcc',
    })
  })

  it('keeps valid tint and strength overrides', () => {
    expect(parseChartPaperOptions({ paper: { tint: 'accent', strength: 'medium' } })).toEqual({
      tint: 'accent',
      strength: 'medium',
    })
  })
})

describe('mergeChartPaperConfig', () => {
  const settings = { chartPaperTint: 'auto' as const, chartPaperStrength: 'medium' as const }

  it('uses settings when widget paper is omitted', () => {
    expect(mergeChartPaperConfig({}, settings)).toEqual({ tint: 'auto', strength: 'medium' })
  })

  it('lets widget tint and strength win', () => {
    expect(mergeChartPaperConfig({ tint: 'neutral', strength: 'off' }, settings)).toEqual({
      tint: 'neutral',
      strength: 'off',
    })
  })

  it('falls custom without a valid color back to auto', () => {
    expect(mergeChartPaperConfig({ tint: 'custom' }, settings)).toEqual({
      tint: 'auto',
      strength: 'medium',
    })
  })

  it('keeps custom when the hex is valid', () => {
    expect(mergeChartPaperConfig({ tint: 'custom', color: '#abc' }, settings)).toEqual({
      tint: 'custom',
      color: '#aabbcc',
      strength: 'medium',
    })
  })
})

describe('normalizePaperHex', () => {
  it('rejects invalid values', () => {
    expect(normalizePaperHex('red')).toBeNull()
    expect(normalizePaperHex('#gg0000')).toBeNull()
  })
})

describe('chart paper field round-trip', () => {
  it('omits paper when every field inherits', () => {
    expect(chartPaperConfigFromFields({
      tint: 'inherit',
      strength: 'inherit',
      color: '#7300ff',
    })).toBeUndefined()
  })

  it('round-trips an override', () => {
    const fields = chartPaperFieldsFromConfig({ tint: 'custom', color: '#112233', strength: 'medium' })
    expect(chartPaperConfigFromFields(fields)).toEqual({
      tint: 'custom',
      color: '#112233',
      strength: 'medium',
    })
  })
})

describe('buildVizConfig paper options', () => {
  it('preserves a passed paper option', () => {
    const viz = buildVizConfig(
      'bar',
      { x: 'day', y: ['total'], series: null, size: null },
      { paper: { tint: 'accent', strength: 'medium' } },
    )
    expect(viz.options.paper).toEqual({ tint: 'accent', strength: 'medium' })
  })
})
