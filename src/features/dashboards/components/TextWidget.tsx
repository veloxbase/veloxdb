import {
  FlameIcon,
  InfoIcon,
  LightbulbIcon,
  SparkleIcon,
  WarningIcon,
} from '@phosphor-icons/react'

import type { Widget } from '@/data/types'
import { MarkdownRenderer } from '@/features/dashboards/components/notes/MarkdownRenderer'
import { parseNoteOptions } from '@/features/dashboards/components/notes/note-options'
import { WidgetTileHeader } from '@/features/dashboards/components/WidgetTileHeader'
import type { WidgetDragHandleProps, WidgetTileActions } from '@/features/dashboards/components/widget-tile-actions'
import { getTextWidgetContent } from '@/features/dashboards/widget-routing'

type TextWidgetProps = WidgetDragHandleProps & {
  widget: Widget
  editMode?: boolean
  tileActions?: WidgetTileActions
  variableValues?: Record<string, string>
}

const STYLE_CLASSES = {
  card: 'bg-card text-card-foreground border-border',
  'callout-info': 'bg-blue-500/5 text-blue-950 dark:text-blue-100 border-l-4 border-l-blue-500 border-border/60',
  'callout-success': 'bg-emerald-500/5 text-emerald-950 dark:text-emerald-100 border-l-4 border-l-emerald-500 border-border/60',
  'callout-warning': 'bg-amber-500/5 text-amber-950 dark:text-amber-100 border-l-4 border-l-amber-500 border-border/60',
  'callout-insight': 'bg-purple-500/5 text-purple-950 dark:text-purple-100 border-l-4 border-l-purple-500 border-border/60',
  'callout-danger': 'bg-red-500/5 text-red-950 dark:text-red-100 border-l-4 border-l-red-500 border-border/60',
  banner: 'bg-transparent text-foreground border-transparent shadow-none',
}

const STYLE_ICONS = {
  card: null,
  'callout-info': <InfoIcon className="size-4 text-blue-500 shrink-0" />,
  'callout-success': <LightbulbIcon className="size-4 text-emerald-500 shrink-0" />,
  'callout-warning': <WarningIcon className="size-4 text-amber-500 shrink-0" />,
  'callout-insight': <SparkleIcon className="size-4 text-purple-500 shrink-0" />,
  'callout-danger': <FlameIcon className="size-4 text-red-500 shrink-0" />,
  banner: null,
}

/** Static note widget with rich Markdown and preset card themes. */
export function TextWidget({
  widget,
  editMode = false,
  tileActions,
  variableValues = {},
  dragActivatorRef,
  dragHandleListeners,
  dragHandleAttributes,
}: TextWidgetProps) {
  const fallbackContent = getTextWidgetContent(widget)
  const options = parseNoteOptions(widget.viz?.options, fallbackContent)

  const styleClass = STYLE_CLASSES[options.style] ?? STYLE_CLASSES.card
  const defaultIcon = STYLE_ICONS[options.style]

  const body = (
    <div className={`flex h-full flex-col overflow-hidden rounded-md border p-3.5 transition-colors ${styleClass}`}>
      {/* Optional Note Header (Title & Icon) */}
      {options.showTitle && widget.title && options.style !== 'banner' && !editMode ? (
        <div className="mb-2 flex items-center gap-1.5 border-b border-border/40 pb-1.5">
          {options.icon ? (
            <span className="text-sm shrink-0">{options.icon}</span>
          ) : (
            defaultIcon
          )}
          <span className="truncate text-xs font-semibold tracking-tight text-foreground">
            {widget.title}
          </span>
        </div>
      ) : null}

      {/* Rendered Markdown Body */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <MarkdownRenderer
          content={options.content}
          variableValues={variableValues}
          fontSize={options.fontSize}
        />
      </div>
    </div>
  )

  if (!editMode || !tileActions) return body

  return (
    <div className="flex h-full min-h-0 flex-col">
      <WidgetTileHeader
        widget={widget}
        draggable={!widget.locked}
        dragActivatorRef={dragActivatorRef}
        dragHandleListeners={dragHandleListeners}
        dragHandleAttributes={dragHandleAttributes}
        {...tileActions}
      />
      <div className="dashboard-grid-tile__body dashboard-grid-tile__body--interactive min-h-0 flex-1 overflow-hidden">
        {body}
      </div>
    </div>
  )
}
