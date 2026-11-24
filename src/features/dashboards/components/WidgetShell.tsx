import { WarningCircleIcon } from '@phosphor-icons/react'
import type { ReactNode } from 'react'

import {
  chartGrainSurfaceClass,
  useResolvedChartPaper,
} from '@/features/dashboards/charts/ChartPaperBackdrop'
import type { ChartPaperConfig } from '@/features/dashboards/charts/chart-paper'
import { cn } from '@/lib/utils'

type WidgetShellProps = {
  isError: boolean
  errorMessage?: string
  title?: string
  titleClassName?: string
  /** One-line insight shown under the title in app view. */
  caption?: ReactNode
  /** Actions rendered on the right of the title row (app view hover). */
  headerActions?: ReactNode
  paper?: ChartPaperConfig | null
  backdrop?: ReactNode
  children: ReactNode
}

/** Shared body for dashboard widgets: error state and content. Title chrome lives in edit-mode `WidgetTileHeader`. */
export function WidgetShell({
  isError,
  errorMessage,
  title,
  titleClassName,
  caption,
  headerActions,
  paper,
  backdrop,
  children,
}: WidgetShellProps) {
  const grainClass = chartGrainSurfaceClass(useResolvedChartPaper(paper).strength)

  return (
    <div className={cn('widget-shell group/widget flex h-full min-h-0 flex-col overflow-hidden bg-transparent', grainClass)}>
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {backdrop}
        {isError ? (
          <div className="relative z-10 flex h-full items-center justify-center gap-2 px-4 text-center text-xs text-destructive">
            <WarningCircleIcon className="size-3.5 shrink-0" />
            <span>{errorMessage ?? 'Failed to load widget data.'}</span>
          </div>
        ) : (
          <>
            {title || headerActions ? (
              <div className="relative z-10 flex shrink-0 items-start gap-2 px-3 pt-2.5">
                <div className="min-w-0 flex-1">
                  {title ? (
                    <p className={cn('truncate text-[11px] font-medium tracking-wide text-foreground/85', titleClassName)}>
                      {title}
                    </p>
                  ) : null}
                  {caption ? (
                    <p className="truncate text-[10.5px] leading-snug text-muted-foreground">{caption}</p>
                  ) : null}
                </div>
                {headerActions ? (
                  <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/widget:opacity-100 focus-within:opacity-100">
                    {headerActions}
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className="relative z-10 min-h-0 flex-1">{children}</div>
          </>
        )}
      </div>
    </div>
  )
}
