import {
  ClockCounterClockwiseIcon,
  MagnifyingGlassIcon,
  StarIcon,
  TrashIcon,
} from '@phosphor-icons/react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { QueryHistoryEntry } from '@/features/queries/query-workspace-state'
import { cn } from '@/lib/utils'

type QueryHistoryPanelProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  history: QueryHistoryEntry[]
  onLoadQuery: (entry: QueryHistoryEntry) => void
  onClearHistory: () => void
  favorites: Set<string>
  onToggleFavorite: (entryId: string) => void
}

export function QueryHistoryPanel({
  open,
  onOpenChange,
  history,
  onLoadQuery,
  onClearHistory,
  favorites,
  onToggleFavorite,
}: QueryHistoryPanelProps) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'favorites'>('all')

  const searchLower = search.trim().toLowerCase()

  const filtered = useMemo(() => {
    let entries = history
    if (filter === 'favorites') {
      entries = entries.filter((e) => favorites.has(e.id))
    }
    if (searchLower) {
      entries = entries.filter((e) => e.sql.toLowerCase().includes(searchLower))
    }
    return entries
  }, [history, filter, searchLower, favorites])

  const handleLoad = useCallback(
    (entry: QueryHistoryEntry) => {
      onLoadQuery(entry)
      onOpenChange(false)
    },
    [onLoadQuery, onOpenChange],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl border-border p-0 sm:max-w-2xl">
        <DialogHeader className="border-b border-border px-4 py-3">
          <DialogTitle className="text-sm">{t("editor.queryHistory")}</DialogTitle>
          <DialogDescription className="text-xs">
            {t("editor.queryHistoryDesc")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <div className="relative flex-1">
            <MagnifyingGlassIcon className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/50" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("editor.searchQueryHistory")}
              className="h-7 border-border bg-background pl-7 text-xs"
            />
          </div>
          <Button
            variant={filter === 'all' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 text-[10px]"
            onClick={() => setFilter('all')}
          >
            {t("editor.all")}
          </Button>
          <Button
            variant={filter === 'favorites' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 text-[10px]"
            onClick={() => setFilter('favorites')}
          >
            <StarIcon className="mr-1 size-3" />
            {t("editor.favorites")}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-7 text-muted-foreground hover:text-destructive"
            title={t("editor.clearAllHistory")}
            onClick={onClearHistory}
          >
            <TrashIcon className="size-3.5" />
          </Button>
        </div>

        <div className="max-h-[50vh] min-h-[120px] overflow-auto">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-xs text-muted-foreground">
              <ClockCounterClockwiseIcon className="size-6 opacity-30" />
              {history.length === 0
                ? t("editor.queryHistoryEmpty")
                : t("editor.noMatchingQueries")}
            </div>
          ) : (
            <div className="divide-y divide-border">
              {filtered.map((entry) => {
                const isFavorite = favorites.has(entry.id)
                return (
                  <div
                    key={entry.id}
                    className="group flex items-start gap-2 px-3 py-2.5 transition hover:bg-accent/30"
                  >
                    <button
                      type="button"
                      className={cn(
                        'mt-0.5 shrink-0 rounded p-0.5 transition',
                        isFavorite ? 'text-amber-500' : 'text-muted-foreground/30 group-hover:text-muted-foreground/60',
                      )}
                      onClick={() => onToggleFavorite(entry.id)}
                      title={isFavorite ? t("editor.removeFromFavorites") : t("editor.addToFavorites")}
                    >
                      <StarIcon className="size-3.5" weight={isFavorite ? 'fill' : 'regular'} />
                    </button>

                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => handleLoad(entry)}
                    >
                      <pre className="line-clamp-2 whitespace-pre-wrap text-[11px] leading-relaxed text-foreground/90 font-mono">
                        {entry.sql}
                      </pre>
                      <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
						<span>{new Date(entry.executedAt).toLocaleString()}</span>
                        {entry.rowCount != null ? (
                          <span>
                            {entry.rowCount} row{entry.rowCount !== 1 ? 's' : ''}
                          </span>
                        ) : null}
                        {entry.executionMs ? <span>{entry.executionMs} ms</span> : null}
                      </div>
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
