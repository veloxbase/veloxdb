import type { Widget } from '@/data/types'

/** Discriminator for which dashboard widget component should render a widget. */
export type WidgetRendererKind = 'kpi' | 'chart' | 'table' | 'text' | 'unknown'

/** Routes by `widget.kind` first so text/note widgets never hit data-fetching chart components. */
export function resolveWidgetRendererKind(widget: Widget): WidgetRendererKind {
  if (widget.kind === 'text' || widget.kind === 'markdown') return 'text'
  if (widget.kind === 'table') return 'table'
  if (widget.kind === 'chart' && widget.viz?.chartType === 'kpi') return 'kpi'
  if (widget.kind === 'chart') return 'chart'
  if (widget.kind === 'kpi') return 'kpi'
  return 'unknown'
}

export function getTextWidgetContent(widget: Widget): string {
  const content = widget.viz?.options?.content
  return typeof content === 'string' ? content : ''
}
