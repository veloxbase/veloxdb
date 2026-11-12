import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Chart } from '@tanstack/charts/react'
import type { ChartPoint, DomChartDefinition } from '@tanstack/charts'

import { ErrorBoundary } from '@/components/ErrorBoundary'
import { ChartSkeleton } from '@/features/dashboards/charts/ChartSkeleton'
import { cn } from '@/lib/utils'
import '@/features/dashboards/charts/chart-canvas.css'

type ChartCanvasProps = {
  definition: DomChartDefinition | null
  ariaLabel: string
  loading?: boolean
  error?: string | null
  /** Fires on click / Enter over a mark; `null` when the click missed every mark. */
  onSelect?: (point: ChartPoint | null) => void
}

/** Fills its parent and renders a TanStack chart definition. */
export function ChartCanvas({ definition, ariaLabel, loading, error, onSelect }: ChartCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (!rect) return
      const width = Math.floor(rect.width)
      const height = Math.floor(rect.height)
      setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  let body: ReactNode
  if (error) {
    body = (
      <div className="flex h-full items-center justify-center px-4 text-center text-xs text-destructive">
        {error}
      </div>
    )
  } else if (!definition) {
    body = loading ? (
      <ChartSkeleton />
    ) : (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        No data
      </div>
    )
  } else if (size.width > 0 && size.height > 0) {
    body = (
      <ErrorBoundary
        fallback={
          <div className="flex h-full items-center justify-center px-4 text-center text-xs text-muted-foreground">
            Chart could not be drawn.
          </div>
        }
      >
        <Chart
          definition={definition}
          width={size.width}
          height={size.height}
          ariaLabel={ariaLabel}
          className={cn('chart-canvas size-full', onSelect && 'chart-canvas--selectable')}
          onSelect={onSelect}
        />
      </ErrorBoundary>
    )
  } else {
    body = null
  }

  return (
    <div ref={hostRef} className="chart-canvas absolute inset-0 min-h-0 w-full text-xs text-foreground">
      {body}
    </div>
  )
}
