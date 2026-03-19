import { useEffect, useMemo, useRef, useState } from 'react'
import { createColumnHelper, getCoreRowModel, useReactTable, type RowSelectionState } from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'

import type { QueryResult } from '@/data/types'
import { ResultsToolbar } from '@/features/queries/components/ResultsToolbar'
import { copyRows, downloadRowsAsCsv, downloadRowsAsJson } from '@/features/queries/results-export'
import type { ResultEditPatch, ResultRow } from '@/features/queries/result-edits'

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

function renderLoadingSkeleton() {
  const placeholderColumns = 5
  const placeholderRows = 8
  const columnKeys = Array.from({ length: placeholderColumns }, (_, index) => `column-${index + 1}`)
  const rowKeys = Array.from({ length: placeholderRows }, (_, index) => `row-${index + 1}`)

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="grid border-b border-border bg-muted/20" style={{ gridTemplateColumns: `repeat(${placeholderColumns}, minmax(150px, 1fr))` }}>
        {columnKeys.map((columnKey) => (
          <div key={columnKey} className="border-r border-border px-3 py-2 last:border-r-0">
            <div className="h-3 w-16 animate-pulse bg-muted" />
          </div>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden p-3">
        <div className="space-y-2">
          {rowKeys.map((rowKey) => (
            <div
              key={rowKey}
              className="grid gap-2"
              style={{ gridTemplateColumns: `repeat(${placeholderColumns}, minmax(150px, 1fr))` }}
            >
              {columnKeys.map((columnKey) => (
                <div key={`${rowKey}-${columnKey}`} className="h-6 animate-pulse bg-muted/80" />
              ))}
            </div>
          ))}
        </div>
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
  const [pendingEdits, setPendingEdits] = useState<Record<string, Record<string, string | null>>>({})
  const [editingCell, setEditingCell] = useState<{ rowId: string; columnId: string } | null>(null)

  const columns = useMemo(() => result?.columns ?? [], [result?.columns])
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
  const resultSignature = useMemo(() => {
    if (!result) {
      return 'no-result'
    }
    return `${result.executionMs}:${result.rowCount}:${result.columns.join('|')}`
  }, [result])

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
                <span className={value === null ? 'text-muted-foreground' : ''}>
                  {formatValue(value)}
                </span>
              )
            }

            if (isCellEditing) {
              return (
                <input
                  className="h-6 w-full border border-border bg-background px-1 text-xs outline-none focus:border-ring"
                  defaultValue={toEditableValue(value)}
                  onBlur={(event) => {
                    const nextValue = event.target.value === '' ? null : event.target.value
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
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.currentTarget.blur()
                    }
                    if (event.key === 'Escape') {
                      setEditingCell(null)
                    }
                  }}
                />
              )
            }

            return (
              <button
                type="button"
                className={`w-full truncate text-left ${value === null ? 'text-muted-foreground' : ''}`}
                title="Double click to edit"
                onDoubleClick={() => setEditingCell({ rowId, columnId })}
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

  // TanStack table is intentionally used directly here for dynamic grid state.
  // eslint-disable-next-line react-hooks/incompatible-library
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
  const templateColumns =
    visibleColumns.length > 0
      ? `repeat(${visibleColumns.length}, minmax(180px, 1fr))`
      : 'minmax(0, 1fr)'
  const hasEdits = Object.keys(pendingEdits).length > 0

  useEffect(() => {
    setPendingEdits({})
    setRowSelection({})
    setEditingCell(null)
  }, [resultSignature])

  const handleSave = async () => {
    if (!onSaveEdits) {
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
      return
    }

    await onSaveEdits(patches)
    setPendingEdits({})
  }

  const getRowsForAction = () => {
    const selected = table.getSelectedRowModel().rows
    const targetRows = selected.length > 0 ? selected : table.getRowModel().rows

    return targetRows.map((row) => row.original)
  }

  const handleCopy = async () => {
    const selectedRows = getRowsForAction()
    await copyRows(
      visibleColumns.filter((column) => column.id !== '__select').map((column) => column.id),
      selectedRows,
    )
  }

  const handleDownloadCsv = () => {
    downloadRowsAsCsv(
      'query-results.csv',
      visibleColumns.filter((column) => column.id !== '__select').map((column) => column.id),
      getRowsForAction(),
    )
  }

  const handleDownloadJson = () => {
    downloadRowsAsJson(
      'query-results.json',
      visibleColumns.filter((column) => column.id !== '__select').map((column) => column.id),
      getRowsForAction(),
    )
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
    <div className="flex h-full flex-col overflow-hidden">
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
      <div className="grid border-b border-border bg-muted/30" style={{ gridTemplateColumns: templateColumns }}>
        {visibleColumns.map((column) => (
          <div
            key={column.id}
            className="truncate border-r border-border px-3 py-2 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground last:border-r-0"
          >
            {column.id}
          </div>
        ))}
      </div>

      <div ref={parentRef} className="min-h-0 flex-1 overflow-auto">
        <div
          className="relative w-full"
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
                className={`absolute left-0 top-0 grid w-full border-b border-border/60 text-xs ${
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
                    className="truncate border-r border-border/60 px-3 py-2 last:border-r-0"
                    title={formatValue(cell.getValue() as string | null)}
                  >
                    {cell.renderValue() as string}
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      </div>
      <div className="border-t border-border bg-muted/10 px-3 py-1.5 text-[11px] text-muted-foreground">
        {saveDisabledReason && !canEdit ? saveDisabledReason : `${Object.keys(rowSelection).length} row(s) selected`}
      </div>
    </div>
  )
}

