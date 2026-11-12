import {
  CaretDownIcon,
  CheckIcon,
  DatabaseIcon,
  PlusIcon,
} from '@phosphor-icons/react'
import { useState } from 'react'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { ConnectionSummary, DatabaseEngine } from '@/data/types'
import { cn } from '@/lib/utils'

type VeloxyConnectionSelectorProps = {
  activeConnectionId: string | null
  activeEngine: DatabaseEngine | null
  activeDatabaseName?: string | null
  connections?: ConnectionSummary[]
  onSelectConnection?: (id: string) => void
  onNewConnection?: () => void
}

function engineBadgeClass(engine: DatabaseEngine): string {
  switch (engine) {
    case 'postgres':
      return 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30'
    case 'mysql':
      return 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30'
    case 'sqlite':
      return 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
    case 'duckdb':
      return 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border-yellow-500/30'
    default:
      return 'bg-muted text-muted-foreground border-border'
  }
}

export function VeloxyConnectionSelector({
  activeConnectionId,
  activeEngine,
  activeDatabaseName,
  connections = [],
  onSelectConnection,
  onNewConnection,
}: VeloxyConnectionSelectorProps) {
  const [open, setOpen] = useState(false)

  const activeConnection = connections.find((c) => c.id === activeConnectionId)
  const displayName = activeConnection
    ? `${activeConnection.name}${activeConnection.database ? ` (${activeConnection.database})` : ''}`
    : activeEngine
      ? `${activeEngine}${activeDatabaseName ? ` (${activeDatabaseName})` : ''}`
      : 'Select Database'

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-5 max-w-[150px] items-center gap-1 truncate rounded border border-border/80 bg-muted/40 px-1.5 text-[10px] font-medium text-foreground transition-colors hover:border-border hover:bg-accent/60"
          title={`Active database connection: ${displayName}`}
        >
          <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" />
          <span className="truncate">{displayName}</span>
          <CaretDownIcon className="size-2.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-64 p-1.5 shadow-xl">
        <div className="mb-1.5 px-2 py-1 border-b border-border/60">
          <div className="flex items-center justify-between text-[11px] font-semibold text-foreground">
            <span className="flex items-center gap-1.5">
              <DatabaseIcon className="size-3.5 text-muted-foreground" />
              <span>Database Connection</span>
            </span>
            <span className="text-[10px] font-normal text-muted-foreground">
              {connections.length} {connections.length === 1 ? 'saved' : 'saved'}
            </span>
          </div>
        </div>

        <div className="max-h-60 overflow-y-auto space-y-0.5">
          {connections.length > 0 ? (
            connections.map((conn) => {
              const isSelected = conn.id === activeConnectionId
              return (
                <button
                  key={conn.id}
                  type="button"
                  onClick={() => {
                    onSelectConnection?.(conn.id)
                    setOpen(false)
                  }}
                  className={cn(
                    'flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs transition-colors',
                    isSelected
                      ? 'bg-accent font-medium text-foreground'
                      : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                  )}
                >
                  <div className="min-w-0 pr-2">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={cn(
                          'rounded border px-1 py-0 text-[9px] font-mono font-medium uppercase leading-tight',
                          engineBadgeClass(conn.engine)
                        )}
                      >
                        {conn.engine}
                      </span>
                      <p className="truncate text-xs font-medium text-foreground">{conn.name}</p>
                    </div>
                    <p className="truncate text-[10px] text-muted-foreground pl-0.5 mt-0.5">
                      {conn.database || conn.filePath || `${conn.host}:${conn.port}`}
                    </p>
                  </div>
                  {isSelected ? <CheckIcon className="size-3.5 shrink-0 text-emerald-500" /> : null}
                </button>
              )
            })
          ) : (
            <p className="p-2 text-center text-xs text-muted-foreground">No saved connections</p>
          )}
        </div>

        {onNewConnection ? (
          <div className="mt-1.5 border-t border-border/60 pt-1">
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                onNewConnection()
              }}
              className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <PlusIcon className="size-3" />
              <span>Add Database Connection…</span>
            </button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
