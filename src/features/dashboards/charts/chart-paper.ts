import type { AppTheme, ChartPaperStrength, ChartPaperTint } from '@/lib/settings'

export type ChartPaperWidgetTint = ChartPaperTint | 'custom'

export type ChartPaperConfig = {
  tint?: ChartPaperWidgetTint
  color?: string
  strength?: ChartPaperStrength
}

export type GrainGradientPalette = {
  colors: string[]
}

export type GrainGradientStrengthParams = {
  softness: number
  intensity: number
  noise: number
}

export type GrainGradientLayout = {
  scale: number
  rotation: number
  offsetX: number
  offsetY: number
  frame: number
}

export type ResolvedChartPaper = {
  tint: ChartPaperWidgetTint
  color?: string
  strength: ChartPaperStrength
}

export type ChartPaperFieldValue = {
  tint: 'inherit' | ChartPaperWidgetTint
  strength: 'inherit' | ChartPaperStrength
  color: string
}

/** Default Grain Gradient look from https://shaders.paper.design/grain-gradient */
export const GRAIN_AUTO_COLORS = ['#7300ff'] as const
export const DEFAULT_CHART_PAPER_HEX = '#7300ff'

/** Paper `colorBack` hex per theme — edit these if a theme needs a different plate. */
export const GRAIN_COLOR_BACK: Record<Exclude<AppTheme, 'system'>, string> = {
  light: '#ffffff',
  dark: '#000000',
  sepia: '#f3e6c4',
  ocean: '#0b1520',
  forest: '#101a12',
  rose: '#1a1216',
  slate: '#0e1116',
  amber: '#16110a',
}

export function grainColorBack(theme: AppTheme): string {
  if (theme === 'system') {
    const prefersDark = typeof window !== 'undefined'
      && window.matchMedia('(prefers-color-scheme: dark)').matches
    return prefersDark ? GRAIN_COLOR_BACK.dark : GRAIN_COLOR_BACK.light
  }
  return GRAIN_COLOR_BACK[theme]
}

/** Frozen still of the corners preset (speed stays 0 — no animation). */
export const GRAIN_LAYOUT: GrainGradientLayout = {
  scale: 1.04,
  rotation: 0,
  offsetX: -0.04,
  offsetY: 0,
  frame: 4200,
}

export const EMPTY_CHART_PAPER_FIELDS: ChartPaperFieldValue = {
  tint: 'inherit',
  strength: 'inherit',
  color: DEFAULT_CHART_PAPER_HEX,
}

const PAPER_HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/
const TINTS = new Set<ChartPaperWidgetTint>(['auto', 'neutral', 'accent', 'custom'])
const STRENGTHS = new Set<ChartPaperStrength>(['off', 'soft', 'medium'])

export function isValidPaperHex(value: unknown): value is string {
  return typeof value === 'string' && PAPER_HEX_RE.test(value)
}

export function normalizePaperHex(value: string): string | null {
  if (!isValidPaperHex(value)) return null
  if (value.length === 4) {
    const r = value[1]
    const g = value[2]
    const b = value[3]
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase()
  }
  return value.toLowerCase()
}

export function chartGrainPalette(
  tint: ChartPaperWidgetTint,
  color?: string,
): GrainGradientPalette {
  if (tint === 'custom') {
    const hex = color ? normalizePaperHex(color) : null
    if (hex) {
      return { colors: [hex] }
    }
  }
  if (tint === 'neutral') {
    return { colors: ['#8a8a94'] }
  }
  if (tint === 'accent') {
    return { colors: ['var(--chart-1)'] }
  }
  return { colors: [...GRAIN_AUTO_COLORS] }
}

/** Soft is quieter; medium matches the frozen corners preset. */
export const CHART_GRAIN_STRENGTH: Record<Exclude<ChartPaperStrength, 'off'>, GrainGradientStrengthParams> = {
  soft: { softness: 0.75, intensity: 0.55, noise: 0.4 },
  medium: { softness: 1, intensity: 1, noise: 1 },
}

export const CHART_PAPER_MAX_PIXEL_COUNT = 400_000

export function chartGrainStrengthParams(strength: ChartPaperStrength): GrainGradientStrengthParams | null {
  if (strength === 'off') return null
  return CHART_GRAIN_STRENGTH[strength]
}

export function parseChartPaperOptions(options: Record<string, unknown> | null | undefined): ChartPaperConfig {
  const raw = options?.paper
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const paper = raw as Record<string, unknown>
  const tint = typeof paper.tint === 'string' && TINTS.has(paper.tint as ChartPaperWidgetTint)
    ? (paper.tint as ChartPaperWidgetTint)
    : undefined
  const strength = typeof paper.strength === 'string' && STRENGTHS.has(paper.strength as ChartPaperStrength)
    ? (paper.strength as ChartPaperStrength)
    : undefined
  const parsedColor = typeof paper.color === 'string' ? normalizePaperHex(paper.color) ?? undefined : undefined
  return {
    ...(tint ? { tint } : {}),
    ...(strength ? { strength } : {}),
    ...(parsedColor ? { color: parsedColor } : {}),
  }
}

export function mergeChartPaperConfig(
  paper: ChartPaperConfig | null | undefined,
  settings: { chartPaperTint: ChartPaperTint; chartPaperStrength: ChartPaperStrength },
): ResolvedChartPaper {
  const strength = paper?.strength ?? settings.chartPaperStrength
  const tint = paper?.tint ?? settings.chartPaperTint
  if (tint === 'custom') {
    const parsedColor = paper?.color ? normalizePaperHex(paper.color) : null
    if (!parsedColor) return { tint: 'auto', strength }
    return { tint: 'custom', color: parsedColor, strength }
  }
  return { tint, strength }
}

export function chartPaperFieldsFromConfig(paper: ChartPaperConfig): ChartPaperFieldValue {
  return {
    tint: paper.tint ?? 'inherit',
    strength: paper.strength ?? 'inherit',
    color: paper.color ?? DEFAULT_CHART_PAPER_HEX,
  }
}

export function chartPaperConfigFromFields(fields: ChartPaperFieldValue): ChartPaperConfig | undefined {
  const config: ChartPaperConfig = {}
  if (fields.tint !== 'inherit') config.tint = fields.tint
  if (fields.strength !== 'inherit') config.strength = fields.strength
  if (fields.tint === 'custom') {
    const hex = normalizePaperHex(fields.color)
    if (hex) config.color = hex
  }
  return Object.keys(config).length > 0 ? config : undefined
}

export function vizOptionsWithPaper(
  existing: Record<string, unknown> | undefined,
  paper: ChartPaperConfig | undefined,
): Record<string, unknown> {
  const next = { ...existing }
  if (paper) next.paper = paper
  else delete next.paper
  return next
}

/** Resolve a CSS color expression to an rgb()/rgba() string the shader can parse. */
export function resolveCssColor(cssColor: string, root: Element = document.documentElement): string {
  const probe = document.createElement('span')
  probe.style.color = cssColor
  root.appendChild(probe)
  const resolved = getComputedStyle(probe).color
  probe.remove()
  return resolved || cssColor
}

export function resolveGrainGradientPalette(
  tint: ChartPaperWidgetTint,
  color?: string,
  root: Element = document.documentElement,
): GrainGradientPalette {
  const spec = chartGrainPalette(tint, color)
  return {
    colors: spec.colors.map((entry) => resolveCssColor(entry, root)),
  }
}
