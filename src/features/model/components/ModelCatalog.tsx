import { useCallback, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

import { CrosshairIcon } from '@phosphor-icons/react'

import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import type { TableInfo } from '@/data/types'
import type { TableKey } from '@/features/model/model-types'
import { tableKey } from '@/features/model/model-types'

type ModelCatalogProps = {
  tables: TableInfo[]
  onCanvasSet: ReadonlySet<TableKey>
  selectedKeys: readonly TableKey[]
  onSelectKey: (key: TableKey | null) => void
  onAddToCanvas: (table: TableInfo) => void
  onRemoveFromCanvas: (table: TableInfo) => void
  onRequestColumns: (key: TableKey) => void
  /** When set, tables on the diagram show a control to pan/zoom the canvas to that table. */
  onLocateOnDiagram?: (key: TableKey) => void
}

const ROW_H = 40

export function ModelCatalog({
  tables,
  onCanvasSet,
  selectedKeys,
  onSelectKey,
  onAddToCanvas,
  onRemoveFromCanvas,
  onRequestColumns,
  onLocateOnDiagram,
}: ModelCatalogProps) {
  const [needle, setNeedle] = useState('')
  const parentRef = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => {
    const n = needle.trim().toLowerCase()
    if (!n) return tables
    return tables.filter((t) => `${t.schema}.${t.name}`.toLowerCase().includes(n))
  }, [needle, tables])

  // eslint-disable-next-line react-hooks/incompatible-library -- same pattern as ResultsGrid virtualizer
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_H,
    overscan: 12,
  })

  const handleRowClick = useCallback(
    (table: TableInfo) => {
      const key = tableKey(table)
      onSelectKey(key)
      onRequestColumns(key)
    },
    [onRequestColumns, onSelectKey],
  )

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-2 p-3">
      <Input
        placeholder="Search tables…"
        value={needle}
        onChange={(e) => setNeedle(e.target.value)}
        className="h-8 text-xs"
      />
      <div
        ref={parentRef}
        className="min-h-0 flex-1 overflow-auto rounded-md border border-border bg-background/40"
      >
        <div
          className="relative w-full"
          style={{ height: `${virtualizer.getTotalSize()}px` }}
        >
          {virtualizer.getVirtualItems().map((vi) => {
            const table = filtered[vi.index]
            if (!table) return null
            const key = tableKey(table)
            const onCanvas = onCanvasSet.has(key)
            const selected = selectedKeys.includes(key)
            return (
              <div
                key={key}
                className="absolute left-0 top-0 flex w-full items-center gap-2 border-b border-border/60 px-2 text-xs"
                style={{
                  height: `${vi.size}px`,
                  transform: `translateY(${vi.start}px)`,
                  backgroundColor: selected ? 'var(--color-muted)' : undefined,
                }}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left hover:underline"
                  onClick={() => handleRowClick(table)}
                >
                  <span className="text-muted-foreground">{table.schema}.</span>
                  <span className="font-medium text-foreground">{table.name}</span>
                  {onCanvas ? (
                    <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                      on diagram
                    </span>
                  ) : null}
                </button>
                {onCanvas ? (
                  <>
                    {onLocateOnDiagram ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7 shrink-0"
                        title="Show on diagram"
                        aria-label={`Show ${key} on diagram`}
                        onClick={(e) => {
                          e.stopPropagation()
                          onLocateOnDiagram(key)
                        }}
                      >
                        <CrosshairIcon className="size-4" aria-hidden />
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 shrink-0 px-2 text-[11px]"
                      onClick={() => onRemoveFromCanvas(table)}
                    >
                      Remove
                    </Button>
                  </>
                ) : (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="h-7 shrink-0 px-2 text-[11px]"
                    onClick={() => onAddToCanvas(table)}
                  >
                    Add
                  </Button>
                )}
              </div>
            )
          })}
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {filtered.length} of {tables.length} tables
      </p>
    </div>
  )
}
