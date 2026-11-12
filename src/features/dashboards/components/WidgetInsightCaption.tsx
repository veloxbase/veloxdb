import { ArrowDownRightIcon, ArrowUpRightIcon, WarningIcon } from '@phosphor-icons/react'

import type { WidgetInsight } from '@/features/dashboards/ai/widget-insight'
import { cn } from '@/lib/utils'

const TONE_CLASS: Record<WidgetInsight['tone'], string> = {
  neutral: 'text-muted-foreground',
  up: 'text-emerald-600 dark:text-emerald-400',
  down: 'text-rose-600 dark:text-rose-400',
  warn: 'text-amber-600 dark:text-amber-400',
}

/** One-line heuristic insight under a tile title (app view). */
export function WidgetInsightCaption({ insight, className }: { insight: WidgetInsight | null; className?: string }) {
  if (!insight) return null
  const Icon = insight.tone === 'up' ? ArrowUpRightIcon : insight.tone === 'down' ? ArrowDownRightIcon : insight.tone === 'warn' ? WarningIcon : null
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1', TONE_CLASS[insight.tone], className)} title={insight.text}>
      {Icon ? <Icon className="size-3 shrink-0" weight="bold" /> : null}
      <span className="truncate">{insight.text}</span>
    </span>
  )
}
