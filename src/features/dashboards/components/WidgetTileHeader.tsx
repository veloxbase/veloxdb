import {
  ArrowsClockwiseIcon,
  CopySimpleIcon,
  DotsSixVerticalIcon,
  LockIcon,
  LockOpenIcon,
  PencilSimpleIcon,
  SparkleIcon,
  TrashIcon,
} from '@phosphor-icons/react'

import { Button } from '@/components/ui/button'
import type { Widget } from '@/data/types'
import type { WidgetDragHandleProps } from '@/features/dashboards/components/widget-tile-actions'

type WidgetTileHeaderProps = WidgetDragHandleProps & {
  widget: Widget
  draggable: boolean
  isLoading?: boolean
  truncated?: boolean
  onRefresh?: () => void
  onAskVeloxy?: () => void
  onEdit?: () => void
  onDuplicate?: () => void
  onDelete?: () => void
  onToggleLock?: () => void
}

/** Unified edit-mode header: drag grip, title, refresh, and inline widget actions on one row. */
export function WidgetTileHeader({
  widget,
  draggable,
  isLoading = false,
  truncated = false,
  onRefresh,
  onAskVeloxy,
  onEdit,
  onDuplicate,
  onDelete,
  onToggleLock,
  dragActivatorRef,
  dragHandleListeners,
  dragHandleAttributes,
}: WidgetTileHeaderProps) {
  const canEdit = widget.kind === 'chart' || widget.kind === 'table' || widget.kind === 'kpi'

  return (
    <div
      ref={draggable ? dragActivatorRef : undefined}
      className={`${draggable ? 'widget-drag-handle ' : ''}flex shrink-0 items-center gap-1 border-b border-border bg-background px-2.5 py-1.5 ${
        draggable
          ? 'cursor-grab active:cursor-grabbing'
          : 'cursor-default'
      }`}
      title={draggable ? 'Drag from header to move' : 'Widget is locked'}
      {...(draggable ? dragHandleListeners : undefined)}
      {...(draggable ? dragHandleAttributes : undefined)}
    >
      <div className={`flex shrink-0 items-center justify-center rounded px-0.5 ${draggable ? 'text-muted-foreground' : 'text-muted-foreground/40'}`}>
        <DotsSixVerticalIcon className="size-4" weight="bold" />
      </div>
      <p className="min-w-0 flex-1 truncate text-xs font-medium text-foreground" title={widget.title}>
        {widget.title}
      </p>
      <div className="widget-tile-actions flex shrink-0 items-center gap-0.5">
        {truncated ? (
          <span
            className="widget-tile-action rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400"
            title="Result was truncated by the row limit."
          >
            Truncated
          </span>
        ) : null}
        {onRefresh ? (
          <Button
            variant="ghost"
            size="icon-xs"
            className="widget-tile-action"
            onClick={onRefresh}
            disabled={isLoading}
            title="Refresh"
          >
            <ArrowsClockwiseIcon className={isLoading ? 'animate-spin' : undefined} />
          </Button>
        ) : null}
        {canEdit && onAskVeloxy ? (
          <Button variant="ghost" size="icon-xs" className="widget-tile-action" onClick={onAskVeloxy} title="Ask Veloxy about this chart">
            <SparkleIcon weight="fill" />
          </Button>
        ) : null}
        {canEdit && onEdit ? (
          <Button variant="ghost" size="icon-xs" className="widget-tile-action" onClick={onEdit} title="Edit widget">
            <PencilSimpleIcon />
          </Button>
        ) : null}
        {onDuplicate ? (
          <Button variant="ghost" size="icon-xs" className="widget-tile-action" onClick={onDuplicate} title="Duplicate">
            <CopySimpleIcon />
          </Button>
        ) : null}
        {onToggleLock ? (
          <Button variant="ghost" size="icon-xs" className="widget-tile-action" onClick={onToggleLock} title={widget.locked ? 'Unlock' : 'Lock'}>
            {widget.locked ? <LockIcon /> : <LockOpenIcon />}
          </Button>
        ) : null}
        {onDelete ? (
          <Button variant="ghost" size="icon-xs" onClick={onDelete} title="Delete" className="widget-tile-action hover:text-destructive">
            <TrashIcon />
          </Button>
        ) : null}
      </div>
    </div>
  )
}
