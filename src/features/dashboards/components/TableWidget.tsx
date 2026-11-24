import { useVirtualizer } from '@tanstack/react-virtual'
import { useMemo, useRef } from 'react'

import type { Widget } from '@/data/types'
import { ChartPaperBackdrop } from '@/features/dashboards/charts/ChartPaperBackdrop'
import { parseChartPaperOptions } from '@/features/dashboards/charts/chart-paper'
import { WidgetShell } from '@/features/dashboards/components/WidgetShell'
import { WidgetTileHeader } from '@/features/dashboards/components/WidgetTileHeader'
import { AskVeloxyTileButton, askVeloxyHandler } from '@/features/dashboards/components/AskVeloxyTileButton'
import type { WidgetInteractions, WidgetTileActions, WidgetDragHandleProps } from '@/features/dashboards/components/widget-tile-actions'
import { coerceQueryResult, type TypedCellValue, type TypedQueryResult } from '@/features/dashboards/data/typed-rows'
import { useWidgetData } from '@/features/dashboards/hooks/useWidgetData'

const ROW_HEIGHT_PX = 28
const SAMPLE_ROWS = 48
const CHAR_PX = 7.25
const CELL_PAD_PX = 20
const MIN_COL_PX = 72
const MAX_COL_PX = 260

function formatCell(value: TypedCellValue): string {
  if (value === null) return 'NULL'
  if (value instanceof Date) return value.toLocaleString()
  if (typeof value === 'number') return value.toLocaleString()
  return String(value)
}

function fitColumnWidth(column: string, rows: TypedQueryResult['rows']): number {
  let longest = column.length
  const limit = Math.min(rows.length, SAMPLE_ROWS)
  for (let index = 0; index < limit; index += 1) {
    const length = formatCell(rows[index][column]).length
    if (length > longest) longest = length
  }
  return Math.min(MAX_COL_PX, Math.max(MIN_COL_PX, Math.ceil(longest * CHAR_PX) + CELL_PAD_PX))
}

function columnTemplate(typed: TypedQueryResult): string {
  return typed.columns.map((column, index) => (
    index === typed.columns.length - 1
      ? 'minmax(8rem, 1fr)'
      : `${fitColumnWidth(column, typed.rows)}px`
  )).join(' ')
}

type TableWidgetProps = WidgetDragHandleProps & {
  dashboardId: string
  widget: Widget
  editMode?: boolean
  tileActions?: WidgetTileActions
  variableValues?: Record<string, string>
  interactions?: WidgetInteractions
}

/** Bounded, virtualized read-only table for the `table` widget kind. Row count is capped by `maxQueryRows`. */
export function TableWidget({
  dashboardId,
  widget,
  editMode = false,
  tileActions,
  variableValues = {},
  interactions,
  dragActivatorRef,
  dragHandleListeners,
  dragHandleAttributes,
}: TableWidgetProps) {
  const dataQuery = useWidgetData(dashboardId, widget, variableValues)
  const paper = parseChartPaperOptions(widget.viz?.options)
  const parentRef = useRef<HTMLDivElement | null>(null)
  const typed = dataQuery.data ? coerceQueryResult(dataQuery.data) : null
  const rows = typed?.rows ?? []
  const template = useMemo(() => (typed ? columnTemplate(typed) : ''), [typed])

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT_PX,
    overscan: 10,
  })

  const body = (
    <WidgetShell
      isError={dataQuery.isError}
      errorMessage={dataQuery.error instanceof Error ? dataQuery.error.message : undefined}
      title={editMode ? undefined : widget.title}
      headerActions={editMode ? undefined : (
        <AskVeloxyTileButton widget={widget} data={dataQuery.data} variableValues={variableValues} interactions={interactions} />
      )}
      paper={paper}
      backdrop={<ChartPaperBackdrop paper={paper} />}
    >
      {!typed || typed.columns.length === 0 ? (
        <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
          {dataQuery.isLoading ? 'Loading…' : 'No data'}
        </div>
      ) : (
        <div className="flex h-full flex-col overflow-hidden text-xs">
          <div
            className="grid shrink-0 border-b border-border bg-background/40"
            style={{ gridTemplateColumns: template }}
          >
            {typed.columns.map((column) => (
              <div key={column} className="min-w-0 truncate border-r border-border px-2 py-1 font-medium text-muted-foreground last:border-r-0" title={column}>
                {column}
              </div>
            ))}
          </div>
          <div ref={parentRef} className="min-h-0 flex-1 overflow-auto">
            <div className="relative" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const row = rows[virtualRow.index]
                if (!row) return null
                return (
                  <div
                    key={virtualRow.index}
                    className="absolute left-0 top-0 grid w-full border-b border-border/60"
                    style={{
                      height: `${virtualRow.size}px`,
                      transform: `translateY(${virtualRow.start}px)`,
                      gridTemplateColumns: template,
                    }}
                  >
                    {typed.columns.map((column) => (
                      <div key={column} className="min-w-0 truncate border-r border-border/60 px-2 py-1 last:border-r-0">
                        {formatCell(row[column])}
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </WidgetShell>
  )

  if (!editMode || !tileActions) return body

  return (
    <div className="flex h-full min-h-0 flex-col">
      <WidgetTileHeader
        widget={widget}
        draggable={!widget.locked}
        isLoading={dataQuery.isFetching}
        truncated={dataQuery.data?.truncated}
        onRefresh={() => void dataQuery.refetch()}
        onAskVeloxy={askVeloxyHandler(widget, dataQuery.data, variableValues, interactions)}
        dragActivatorRef={dragActivatorRef}
        dragHandleListeners={dragHandleListeners}
        dragHandleAttributes={dragHandleAttributes}
        {...tileActions}
      />
      <div className="dashboard-grid-tile__body dashboard-grid-tile__body--no-events min-h-0 flex-1 overflow-hidden">
        {body}
      </div>
    </div>
  )
}
