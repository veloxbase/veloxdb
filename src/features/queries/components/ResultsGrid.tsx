import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
} from 'react'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
  type Cell,
  type RowSelectionState,
} from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'

import type { QueryResult } from '@/data/types'
import { ResultsToolbar } from '@/features/queries/components/ResultsToolbar'
import { copyRows, downloadRowsAsCsv, downloadRowsAsJson } from '@/features/queries/results-export'
import type { ResultEditPatch, ResultRow } from '@/features/queries/result-edits'

const SELECT_COLUMN_WIDTH_PX = 44
const DEFAULT_DATA_COLUMN_WIDTH_PX = 180
const MIN_COLUMN_WIDTH_PX = 48
const MAX_COLUMN_WIDTH_PX = 640

type ResultsGridProps = {
  result: QueryResult | null
  isPending?: boolean
  isSaving?: boolean
  canEdit?: boolean
  editableColumns?: string[]
  primaryKeyColumns?: string[]
  saveDisabledReason?: string
  onRefresh?: () => void
  onSaveEdits?: (patches: ResultEditPatch[]) => Promise<void>
}

function formatValue(value: string | null | undefined) {
  if (value === null) {
    return 'NULL'
  }

  if (value === undefined || value === '') {
    return ''
  }

  return value
}

function toEditableValue(value: string | null | undefined) {
  return value ?? ''
}

function ResultEditInput({
  defaultValue,
  onBlurCommit,
  onEscape,
}: {
  defaultValue: string
  onBlurCommit: (raw: string) => void
  onEscape: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const skipBlurCommitRef = useRef(false)

  useLayoutEffect(() => {
    const element = inputRef.current
    if (!element) {
      return
    }
    element.focus()
    element.select()
  }, [])

  return (
    <input
      ref={inputRef}
      className="h-6 w-full min-w-0 border border-border bg-background px-1 text-xs outline-none focus:border-ring"
      defaultValue={defaultValue}
      onBlur={(event) => {
        if (skipBlurCommitRef.current) {
          skipBlurCommitRef.current = false
          return
        }
        onBlurCommit(event.target.value)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.currentTarget.blur()
        }
        if (event.key === 'Escape') {
          skipBlurCommitRef.current = true
          onEscape()
        }
      }}
    />
  )
}

function renderLoadingSkeleton() {
  const dataColumnCount = 4
  const placeholderRows = 10
  const skeletonTemplateColumns = [
    `${SELECT_COLUMN_WIDTH_PX}px`,
    ...Array.from({ length: dataColumnCount }, () => `${DEFAULT_DATA_COLUMN_WIDTH_PX}px`),
  ].join(' ')
  const columnIndices = Array.from({ length: 1 + dataColumnCount }, (_, index) => index)
  const rowKeys = Array.from({ length: placeholderRows }, (_, index) => `skeleton-row-${index}`)

  const toolbarColumns = [
    { id: '__select', label: 'Select', visible: true, canHide: false },
    ...Array.from({ length: dataColumnCount }, (_, index) => ({
      id: `__skeleton_col_${index}`,
      label: `Column ${index + 1}`,
      visible: true,
      canHide: true,
    })),
  ]

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden">
      <ResultsToolbar
        columns={toolbarColumns}
        canEdit={false}
        isDirty={false}
        isBusy
        onToggleColumn={() => {}}
        onRefresh={() => {}}
        onCopy={() => {}}
        onDownloadCsv={() => {}}
        onDownloadJson={() => {}}
        onSave={() => {}}
      />
      <div className="min-h-0 min-w-0 flex-1 overflow-x-auto">
        <div className="flex h-full w-max min-w-full flex-col">
          <div
            className="sticky top-0 z-10 grid w-max min-w-full shrink-0 border-b border-border bg-muted/30"
            style={{ gridTemplateColumns: skeletonTemplateColumns }}
          >
            {columnIndices.map((columnIndex) => (
              <div
                key={`sk-h-${columnIndex}`}
                className="relative min-w-0 truncate border-r border-border px-3 py-2 pr-2 last:border-r-0"
              >
                <div
                  className={`h-3 animate-pulse rounded-sm bg-muted ${columnIndex === 0 ? 'w-10' : 'w-24 max-w-full'}`}
                />
              </div>
            ))}
          </div>
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
            <div className="w-max min-w-full">
              {rowKeys.map((rowKey) => (
                <div
                  key={rowKey}
                  className="grid w-max min-w-full border-b border-border/60 bg-background text-xs"
                  style={{ gridTemplateColumns: skeletonTemplateColumns, height: 36 }}
                >
                  {columnIndices.map((columnIndex) => (
                    <div
                      key={`${rowKey}-c${columnIndex}`}
                      className="flex min-w-0 items-center border-r border-border/60 px-3 py-2 last:border-r-0"
                    >
                      <div className="h-3.5 w-full max-w-[85%] animate-pulse rounded-sm bg-muted/80" />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="border-t border-border bg-muted/10 px-3 py-1.5 text-[11px] text-muted-foreground">
        <span className="inline-block h-3 w-40 animate-pulse rounded-sm bg-muted/60" aria-hidden />
      </div>
    </div>
  )
}

export function ResultsGrid({
  result,
  isPending = false,
  isSaving = false,
  canEdit = false,
  editableColumns = [],
  primaryKeyColumns = [],
  saveDisabledReason,
  onRefresh,
  onSaveEdits,
}: ResultsGridProps) {
  const parentRef = useRef<HTMLDivElement | null>(null)
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>({})
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({})
  const [pendingEdits, setPendingEdits] = useState<Record<string, Record<string, string | null>>>({})
  const [editingCell, setEditingCell] = useState<{ rowId: string; columnId: string } | null>(null)
  const [gridError, setGridError] = useState<string | null>(null)

  const columns = useMemo(() => result?.columns ?? [], [result?.columns])
  const columnsFingerprint = columns.join('\u0001')
  const queryResultEditResetKey =
    result != null
      ? `${result.executionMs}\u0000${result.rowCount}\u0000${columnsFingerprint}`
      : ''
  const editableColumnSet = useMemo(() => new Set(editableColumns), [editableColumns])
  const primaryKeySet = useMemo(() => new Set(primaryKeyColumns), [primaryKeyColumns])

  const indexedRows = useMemo(() => {
    const rows = result?.rows ?? []
    return rows.map((row, index) => {
      const pkValues = primaryKeyColumns.map((columnName) => row[columnName] ?? null)
      const hasCompletePrimaryKey =
        primaryKeyColumns.length > 0 &&
        pkValues.length === primaryKeyColumns.length &&
        pkValues.every((value) => value !== null)
      const rowId = hasCompletePrimaryKey ? `pk:${pkValues.join('\u001f')}` : `idx:${index}`
      const primaryKey = primaryKeyColumns.reduce<Record<string, string | null>>((accumulator, columnName) => {
        accumulator[columnName] = row[columnName] ?? null
        return accumulator
      }, {})

      return {
        rowId,
        row,
        primaryKey,
        hasCompletePrimaryKey,
      }
    })
  }, [primaryKeyColumns, result?.rows])

  const originalByRowId = useMemo(
    () =>
      indexedRows.reduce<Record<string, ResultRow>>((accumulator, item) => {
        accumulator[item.rowId] = item.row
        return accumulator
      }, {}),
    [indexedRows],
  )

  const data = useMemo(
    () =>
      indexedRows.map((item) => {
        const rowEdits = pendingEdits[item.rowId]
        if (!rowEdits) {
          return item.row
        }
        return { ...item.row, ...rowEdits }
      }),
    [indexedRows, pendingEdits],
  )
  const columnHelper = createColumnHelper<ResultRow>()
  const columnDefs = useMemo(
    () => [
      columnHelper.display({
        id: '__select',
        header: () => 'Select',
        enableHiding: false,
        cell: (context) => (
          <input
            type="checkbox"
            className="size-3"
            checked={context.row.getIsSelected()}
            onChange={context.row.getToggleSelectedHandler()}
            aria-label={`Select row ${context.row.index + 1}`}
          />
        ),
      }),
      ...columns.map((columnName) =>
        columnHelper.accessor(columnName, {
          id: columnName,
          header: () => columnName,
          cell: (context) => {
            const rowId = context.row.id
            const columnId = context.column.id
            const value = context.getValue()
            const isCellEditing = editingCell?.rowId === rowId && editingCell.columnId === columnId
            const isColumnEditable = canEdit && editableColumnSet.has(columnId) && !primaryKeySet.has(columnId)

            if (!isColumnEditable) {
              return (
                <span className={`block min-w-0 truncate ${value === null ? 'text-muted-foreground' : ''}`}>
                  {formatValue(value)}
                </span>
              )
            }

            if (isCellEditing) {
              return (
                <ResultEditInput
                  defaultValue={toEditableValue(value)}
                  onEscape={() => setEditingCell(null)}
                  onBlurCommit={(raw) => {
                    const nextValue = raw === '' ? null : raw
                    const originalValue = originalByRowId[rowId]?.[columnId] ?? null

                    setPendingEdits((current) => {
                      const next = { ...current }
                      const existing = { ...(next[rowId] ?? {}) }

                      if (nextValue === originalValue) {
                        delete existing[columnId]
                      } else {
                        existing[columnId] = nextValue
                      }

                      if (Object.keys(existing).length === 0) {
                        delete next[rowId]
                      } else {
                        next[rowId] = existing
                      }

                      return next
                    })
                    setEditingCell(null)
                  }}
                />
              )
            }

            return (
              <button
                type="button"
                className={`w-full min-w-0 truncate text-left ${value === null ? 'text-muted-foreground' : ''}`}
                title="Click to edit"
                onClick={() => setEditingCell({ rowId, columnId })}
              >
                {formatValue(value)}
              </button>
            )
          },
        }),
      ),
    ],
    [canEdit, columnHelper, columns, editableColumnSet, editingCell, originalByRowId, primaryKeySet],
  )

  // TanStack Table: React Compiler skips memoizing this hook by design.
  // eslint-disable-next-line react-hooks/incompatible-library -- useReactTable is intentionally dynamic
  const table = useReactTable({
    data,
    columns: columnDefs,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (_row, index) => indexedRows[index]?.rowId ?? `idx:${index}`,
    state: {
      rowSelection,
      columnVisibility,
    },
    onRowSelectionChange: setRowSelection,
    onColumnVisibilityChange: setColumnVisibility,
    enableRowSelection: true,
  })

  const rowVirtualizer = useVirtualizer({
    count: table.getRowModel().rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 36,
    overscan: 10,
  })

  const visibleColumns = table.getVisibleLeafColumns()

  const getColumnWidthPx = useCallback(
    (columnId: string) =>
      columnWidths[columnId] ??
      (columnId === '__select' ? SELECT_COLUMN_WIDTH_PX : DEFAULT_DATA_COLUMN_WIDTH_PX),
    [columnWidths],
  )

  const templateColumns =
    visibleColumns.length > 0
      ? visibleColumns.map((column) => `${getColumnWidthPx(column.id)}px`).join(' ')
      : 'minmax(0, 1fr)'

  const handleColumnResizePointerDown = useCallback(
    (columnId: string, event: PointerEvent<HTMLElement>) => {
      event.preventDefault()
      event.stopPropagation()
      const startX = event.clientX
      const startWidth = getColumnWidthPx(columnId)

      const clampWidth = (value: number) =>
        Math.min(MAX_COLUMN_WIDTH_PX, Math.max(MIN_COLUMN_WIDTH_PX, value))

      const onPointerMove = (moveEvent: globalThis.PointerEvent) => {
        const delta = moveEvent.clientX - startX
        const nextWidth = clampWidth(startWidth + delta)
        setColumnWidths((current) => ({ ...current, [columnId]: nextWidth }))
      }

      const onPointerUp = () => {
        window.removeEventListener('pointermove', onPointerMove)
        window.removeEventListener('pointerup', onPointerUp)
        window.removeEventListener('pointercancel', onPointerUp)
      }

      window.addEventListener('pointermove', onPointerMove)
      window.addEventListener('pointerup', onPointerUp)
      window.addEventListener('pointercancel', onPointerUp)
    },
    [getColumnWidthPx],
  )

  const renderBodyCell = useCallback((cell: Cell<ResultRow, unknown>) => {
    const cellDef = cell.column.columnDef.cell
    if (cellDef) {
      return flexRender(cellDef, cell.getContext())
    }
    return formatValue(cell.getValue() as string | null)
  }, [])

  const hasEdits = Object.keys(pendingEdits).length > 0

  useEffect(() => {
    setColumnWidths((previous) => {
      const identifiers = ['__select', ...columns]
      const next: Record<string, number> = {}
      for (const id of identifiers) {
        const fallback = id === '__select' ? SELECT_COLUMN_WIDTH_PX : DEFAULT_DATA_COLUMN_WIDTH_PX
        next[id] = previous[id] ?? fallback
      }
      return next
    })
  }, [columns])

  useEffect(() => {
    setPendingEdits({})
    setRowSelection({})
    setEditingCell(null)
    setGridError(null)
  }, [queryResultEditResetKey])

  const handleSave = async () => {
    if (!onSaveEdits) {
      return
    }
    if (!canEdit) {
      setGridError(saveDisabledReason ?? 'Editing is disabled for this result set.')
      return
    }

    const patches: ResultEditPatch[] = Object.entries(pendingEdits)
      .map(([rowId, changes]) => {
        const source = indexedRows.find((row) => row.rowId === rowId)
        if (!source || !source.hasCompletePrimaryKey || Object.keys(changes).length === 0) {
          return null
        }

        return {
          rowId,
          primaryKey: source.primaryKey,
          changes,
        }
      })
      .filter((patch): patch is ResultEditPatch => patch !== null)

    if (patches.length === 0) {
      setGridError('No editable row changes found. Ensure rows have primary keys and edited values differ.')
      return
    }

    setGridError(null)
    try {
      await onSaveEdits(patches)
      setPendingEdits({})
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save edits.'
      setGridError(message)
    }
  }

  const getRowsForAction = () => {
    const selected = table.getSelectedRowModel().rows
    const targetRows = selected.length > 0 ? selected : table.getRowModel().rows

    return targetRows.map((row) => row.original)
  }

  const handleCopy = async () => {
    const selectedRows = getRowsForAction()
    const exportColumns = visibleColumns.filter((column) => column.id !== '__select').map((column) => column.id)
    if (exportColumns.length === 0) {
      setGridError('No visible data columns to copy.')
      return
    }

    setGridError(null)
    try {
      await copyRows(exportColumns, selectedRows)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to copy rows.'
      setGridError(message)
    }
  }

  const handleDownloadCsv = () => {
    const exportColumns = visibleColumns.filter((column) => column.id !== '__select').map((column) => column.id)
    if (exportColumns.length === 0) {
      setGridError('No visible data columns to export.')
      return
    }

    setGridError(null)
    try {
      downloadRowsAsCsv('query-results.csv', exportColumns, getRowsForAction())
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to download CSV.'
      setGridError(message)
    }
  }

  const handleDownloadJson = () => {
    const exportColumns = visibleColumns.filter((column) => column.id !== '__select').map((column) => column.id)
    if (exportColumns.length === 0) {
      setGridError('No visible data columns to export.')
      return
    }

    setGridError(null)
    try {
      downloadRowsAsJson('query-results.json', exportColumns, getRowsForAction())
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to download JSON.'
      setGridError(message)
    }
  }

  if (isPending) {
    return renderLoadingSkeleton()
  }

  if (!result) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        Run a query to inspect rows here.
      </div>
    )
  }

  if (result.columns.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
        <span>Statement completed without a rowset.</span>
        <span>{result.commandTag ? `${result.commandTag} rows affected.` : 'No rows returned.'}</span>
      </div>
    )
  }

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden">
      <ResultsToolbar
        columns={table.getAllLeafColumns().map((column) => ({
          id: column.id,
          label: column.id === '__select' ? 'Select' : column.id,
          visible: column.getIsVisible(),
          canHide: column.getCanHide(),
        }))}
        canEdit={canEdit}
        isDirty={hasEdits}
        isBusy={isSaving}
        onToggleColumn={(columnId, visible) => table.getColumn(columnId)?.toggleVisibility(visible)}
        onRefresh={() => onRefresh?.()}
        onCopy={() => {
          void handleCopy()
        }}
        onDownloadCsv={handleDownloadCsv}
        onDownloadJson={handleDownloadJson}
        onSave={() => {
          void handleSave()
        }}
      />
      <div className="min-h-0 min-w-0 flex-1 overflow-x-auto">
        <div className="flex h-full w-max min-w-full flex-col">
          <div
            className="sticky top-0 z-10 grid w-max min-w-full shrink-0 border-b border-border bg-muted/30"
            style={{ gridTemplateColumns: templateColumns }}
          >
            {visibleColumns.map((column) => (
              <div
                key={column.id}
                className="relative min-w-0 truncate border-r border-border px-3 py-2 pr-2 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground last:border-r-0"
              >
                <span className="block truncate">{column.id === '__select' ? 'Select' : column.id}</span>
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={`Resize column ${column.id === '__select' ? 'Select' : column.id}`}
                  className="absolute right-0 top-0 z-10 h-full w-2 cursor-col-resize select-none border-0 bg-transparent p-0 hover:bg-primary/20"
                  onPointerDown={(event) => handleColumnResizePointerDown(column.id, event)}
                />
              </div>
            ))}
          </div>
          <div ref={parentRef} className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
            <div
              className="relative w-max min-w-full"
              style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const row = table.getRowModel().rows[virtualRow.index]
                if (!row) {
                  return null
                }

                return (
                  <div
                    key={row.id}
                    className={`absolute left-0 top-0 grid w-max min-w-full border-b border-border/60 text-xs ${
                      row.getIsSelected() ? 'bg-muted/40' : 'bg-background'
                    }`}
                    style={{
                      height: `${virtualRow.size}px`,
                      transform: `translateY(${virtualRow.start}px)`,
                      gridTemplateColumns: templateColumns,
                    }}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <div
                        key={cell.id}
                        className="min-w-0 truncate border-r border-border/60 px-3 py-2 last:border-r-0"
                        title={formatValue(cell.getValue() as string | null)}
                      >
                        {renderBodyCell(cell)}
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
      <div className="border-t border-border bg-muted/10 px-3 py-1.5 text-[11px] text-muted-foreground">
        {saveDisabledReason && !canEdit ? saveDisabledReason : `${Object.keys(rowSelection).length} row(s) selected`}
      </div>
      {gridError ? (
        <div className="border-t border-border bg-destructive/10 px-3 py-1.5 text-[11px] text-destructive">
          {gridError}
        </div>
      ) : null}
    </div>
  )
}

