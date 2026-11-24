import type { ChartTheme } from '@tanstack/charts'

/** Series colors follow shadcn `--chart-*` tokens so named themes restyle charts. */
export const CHART_PALETTE = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
] as const

/** Follows app light/dark tokens; no `isDark` switch. */
export const queryChartTheme: Partial<ChartTheme> = {
  foreground: 'var(--foreground)',
  muted: 'var(--muted-foreground)',
  grid: 'color-mix(in oklch, var(--foreground) 22%, transparent)',
  background: 'transparent',
  palette: CHART_PALETTE,
}
