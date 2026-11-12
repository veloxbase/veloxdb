import { GrainGradient } from '@paper-design/shaders-react'
import { useEffect, useState, type ReactNode } from 'react'

import {
  CHART_PAPER_MAX_PIXEL_COUNT,
  GRAIN_LAYOUT,
  chartGrainStrengthParams,
  grainColorBack,
  mergeChartPaperConfig,
  resolveGrainGradientPalette,
  type ChartPaperConfig,
  type GrainGradientPalette,
  type ResolvedChartPaper,
} from '@/features/dashboards/charts/chart-paper'
import '@/features/dashboards/charts/chart-canvas.css'
import { useSettings } from '@/lib/settings'
import { cn } from '@/lib/utils'

export function useResolvedChartPaper(paper?: ChartPaperConfig | null): ResolvedChartPaper {
  const settingsTint = useSettings((settings) => settings.chartPaperTint) ?? 'auto'
  const settingsStrength = useSettings((settings) => settings.chartPaperStrength) ?? 'medium'
  return mergeChartPaperConfig(paper, {
    chartPaperTint: settingsTint,
    chartPaperStrength: settingsStrength,
  })
}

export function chartGrainSurfaceClass(strength: ResolvedChartPaper['strength']): string {
  return strength === 'off' ? '' : 'chart-grain-surface'
}

type ChartPaperBackdropProps = {
  paper?: ChartPaperConfig | null
}

/** Grain Gradient backdrop. Parent must be `relative overflow-hidden`. */
export function ChartPaperBackdrop({ paper }: ChartPaperBackdropProps) {
  const theme = useSettings((settings) => settings.theme)
  const resolved = useResolvedChartPaper(paper)
  const params = chartGrainStrengthParams(resolved.strength)
  const [palette, setPalette] = useState<GrainGradientPalette | null>(null)

  useEffect(() => {
    if (!params) {
      setPalette(null)
      return
    }
    const apply = () => setPalette(resolveGrainGradientPalette(resolved.tint, resolved.color))
    const frame = requestAnimationFrame(apply)
    const observer = new MutationObserver(apply)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [params, resolved.tint, resolved.color])

  if (!params || !palette) return null

  return (
    <GrainGradient
      aria-hidden
      className="chart-paper-backdrop pointer-events-none absolute inset-0 z-0 size-full"
      style={{ width: '100%', height: '100%' }}
      colors={palette.colors}
      colorBack={grainColorBack(theme)}
      softness={params.softness}
      intensity={params.intensity}
      noise={params.noise}
      shape="corners"
      speed={0}
      frame={GRAIN_LAYOUT.frame}
      scale={GRAIN_LAYOUT.scale}
      rotation={GRAIN_LAYOUT.rotation}
      offsetX={GRAIN_LAYOUT.offsetX}
      offsetY={GRAIN_LAYOUT.offsetY}
      minPixelRatio={1}
      maxPixelCount={CHART_PAPER_MAX_PIXEL_COUNT}
    />
  )
}

type ChartGrainFrameProps = {
  paper?: ChartPaperConfig | null
  enabled?: boolean
  className?: string
  children: ReactNode
}

/** Preview frame with Grain Gradient and light-on-dark chart chrome. */
export function ChartGrainFrame({
  paper,
  enabled = true,
  className,
  children,
}: ChartGrainFrameProps) {
  const grainClass = enabled ? chartGrainSurfaceClass(useResolvedChartPaper(paper).strength) : ''

  return (
    <div className={cn('relative overflow-hidden', grainClass, className)}>
      {enabled ? <ChartPaperBackdrop paper={paper} /> : null}
      <div className="relative z-10 h-full min-h-0">{children}</div>
    </div>
  )
}
