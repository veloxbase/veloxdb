import {
  ChartBarIcon,
  CheckIcon,
  CodeIcon,
  GearIcon,
  LayoutIcon,
  NotePencilIcon,
  PencilSimpleIcon,
  PlusIcon,
  ExportIcon,
  TableIcon,
} from '@phosphor-icons/react'

import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

type DashboardToolbarProps = {
  activeView: 'logic' | 'app'
  onChangeView: (view: 'logic' | 'app') => void
  editMode: boolean
  onToggleEditMode: () => void
  onAddChart: () => void
  onAddTable: () => void
  onAddNote: () => void
  onAddPage?: () => void
  onOpenSettings: () => void
  onOpenShare?: () => void
}

/** Dashboard header actions: view switcher, add widgets, edit/view toggle, settings. */
export function DashboardToolbar({
  activeView,
  onChangeView,
  editMode,
  onToggleEditMode,
  onAddChart,
  onAddTable,
  onAddNote,
  onAddPage,
  onOpenSettings,
  onOpenShare,
}: DashboardToolbarProps) {
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {/* Logic | App View Switcher */}
      <div className="flex items-center rounded-md border border-border bg-muted/40 p-0.5">
        <button
          type="button"
          className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium transition-colors ${
            activeView === 'logic'
              ? 'bg-background text-foreground shadow-xs'
              : 'text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => onChangeView('logic')}
          title="Queries: SQL cells, parameters, and visuals"
        >
          <CodeIcon className="size-3" />
          Queries
        </button>
        <button
          type="button"
          className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium transition-colors ${
            activeView === 'app'
              ? 'bg-background text-foreground shadow-xs'
              : 'text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => onChangeView('app')}
          title="Dashboard: interactive grid layout"
        >
          <LayoutIcon className="size-3" />
          Dashboard
        </button>
      </div>

      {activeView === 'app' ? (
        <>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs">
                <PlusIcon className="size-3.5" />
                Add widget
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-44 p-1">
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
                onClick={onAddChart}
              >
                <ChartBarIcon className="size-3.5 text-muted-foreground" />
                Chart
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
                onClick={onAddTable}
              >
                <TableIcon className="size-3.5 text-muted-foreground" />
                Table
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
                onClick={onAddNote}
              >
                <NotePencilIcon className="size-3.5 text-muted-foreground" />
                Note
              </button>
              {onAddPage ? (
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
                  onClick={onAddPage}
                >
                  <LayoutIcon className="size-3.5 text-muted-foreground" />
                  Page
                </button>
              ) : null}
            </PopoverContent>
          </Popover>

          {editMode ? (
            <Button
              variant="secondary"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={onToggleEditMode}
              title="Finish editing and return to view mode"
            >
              <CheckIcon className="size-3.5" />
              Done editing
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={onToggleEditMode}
              title="Move and resize widgets on the grid"
            >
              <PencilSimpleIcon className="size-3.5" />
              Edit layout
            </Button>
          )}
        </>
      ) : null}

      {onOpenShare && (
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 text-xs text-foreground"
          onClick={onOpenShare}
          title="Export dashboard as a report"
        >
          <ExportIcon className="size-3.5 text-primary" />
          Export
        </Button>
      )}

      <Button variant="ghost" size="icon-sm" onClick={onOpenSettings} title="Dashboard settings">
        <GearIcon />
      </Button>
    </div>
  )
}
