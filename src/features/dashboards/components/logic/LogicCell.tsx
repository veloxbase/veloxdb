import { useState, type ReactNode } from 'react'
import {
  DotsThreeVerticalIcon,
  EyeIcon,
  EyeSlashIcon,
  TrashIcon,
  CopyIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  DotsSixVerticalIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react'

import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import type { NotebookCell } from '@/data/types'

type LogicCellProps = {
  cell: NotebookCell
  children: ReactNode
  dragHandleProps?: Record<string, unknown>
  onDelete: () => void
  onDuplicate?: () => void
  onMoveUp?: () => void
  onMoveDown?: () => void
  onToggleShowInApp?: () => void
  statusBadge?: ReactNode
  isTruncated?: boolean
  error?: string | null
}

const TYPE_CONFIG: Record<
  NotebookCell['type'],
  { label: string; color: string }
> = {
  sql: { label: 'SQL', color: 'bg-primary/10 text-primary border-primary/20' },
  input: { label: 'INPUT', color: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20' },
  visual: { label: 'VISUAL', color: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20' },
  markdown: { label: 'NOTE', color: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20' },
}

export function LogicCell({
  cell,
  children,
  dragHandleProps,
  onDelete,
  onDuplicate,
  onMoveUp,
  onMoveDown,
  onToggleShowInApp,
  statusBadge,
  isTruncated,
  error,
}: LogicCellProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const typeConfig = TYPE_CONFIG[cell.type]
  const hasShowInApp = 'showInApp' in cell
  const showInApp = hasShowInApp ? cell.showInApp : false

  return (
    <div className="group relative rounded-lg border border-border/70 bg-card shadow-xs transition-colors hover:border-border">
      {/* Header Bar */}
      <div className="flex items-center justify-between gap-2 border-b border-border/50 bg-muted/20 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          {/* Drag Handle */}
          <button
            type="button"
            className="cursor-grab text-muted-foreground/60 transition-colors hover:text-foreground active:cursor-grabbing"
            {...dragHandleProps}
            title="Drag to reorder"
          >
            <DotsSixVerticalIcon className="size-4" />
          </button>

          {/* Type Badge */}
          <span
            className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold tracking-wider ${typeConfig.color}`}
          >
            {typeConfig.label}
          </span>

          {/* Title / Name */}
          <span className="truncate text-xs font-medium text-foreground">
            {'title' in cell ? cell.title : `{{${cell.varName}}}`}
          </span>
        </div>

        {/* Right Actions & Status */}
        <div className="flex items-center gap-2">
          {isTruncated ? (
            <span
              className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400"
              title="Row limit reached; results were truncated"
            >
              <WarningCircleIcon className="size-3" />
              Truncated
            </span>
          ) : null}

          {statusBadge}

          {/* Show In App Toggle */}
          {hasShowInApp && onToggleShowInApp ? (
            <Button
              variant={showInApp ? 'secondary' : 'ghost'}
              size="sm"
              className={`h-6 gap-1 px-1.5 text-[11px] ${
                showInApp ? 'text-foreground' : 'text-muted-foreground'
              }`}
              onClick={onToggleShowInApp}
              title={showInApp ? 'Visible on dashboard' : 'Hidden from dashboard'}
            >
              {showInApp ? <EyeIcon className="size-3 text-primary" /> : <EyeSlashIcon className="size-3" />}
              <span>{showInApp ? 'On dashboard' : 'Hidden'}</span>
            </Button>
          ) : null}

          {/* Actions Popover */}
          <Popover open={menuOpen} onOpenChange={setMenuOpen}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon-xs" className="size-6">
                <DotsThreeVerticalIcon className="size-3.5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-36 p-1">
              {onDuplicate ? (
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-accent"
                  onClick={() => {
                    setMenuOpen(false)
                    onDuplicate()
                  }}
                >
                  <CopyIcon className="size-3.5 text-muted-foreground" />
                  <span>Duplicate</span>
                </button>
              ) : null}
              {onMoveUp ? (
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-accent"
                  onClick={() => {
                    setMenuOpen(false)
                    onMoveUp()
                  }}
                >
                  <ArrowUpIcon className="size-3.5 text-muted-foreground" />
                  <span>Move up</span>
                </button>
              ) : null}
              {onMoveDown ? (
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-accent"
                  onClick={() => {
                    setMenuOpen(false)
                    onMoveDown()
                  }}
                >
                  <ArrowDownIcon className="size-3.5 text-muted-foreground" />
                  <span>Move down</span>
                </button>
              ) : null}
              <div className="my-1 border-t border-border" />
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs text-destructive hover:bg-destructive/10"
                onClick={() => {
                  setMenuOpen(false)
                  onDelete()
                }}
              >
                <TrashIcon className="size-3.5 text-destructive" />
                <span>Delete</span>
              </button>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Error Message if any */}
      {error ? (
        <div className="border-b border-destructive/20 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      {/* Cell Body */}
      <div className="p-3">{children}</div>
    </div>
  )
}
