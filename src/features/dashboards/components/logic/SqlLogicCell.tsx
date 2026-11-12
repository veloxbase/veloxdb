import { useState } from 'react'
import Editor from '@monaco-editor/react'
import { PlayIcon, SpinnerGapIcon } from '@phosphor-icons/react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { NotebookCell } from '@/data/types'
import { useCellData } from '@/features/dashboards/hooks/useCellData'
import { LogicCell } from './LogicCell'

type SqlLogicCellProps = {
  dashboardId: string
  connectionId: string
  cell: Extract<NotebookCell, { type: 'sql' }>
  isDark: boolean
  variableValues: Record<string, string>
  dragHandleProps?: Record<string, unknown>
  onUpdate: (patch: Partial<NotebookCell>) => void
  onDelete: () => void
  onDuplicate?: () => void
  onMoveUp?: () => void
  onMoveDown?: () => void
  onToggleShowInApp: () => void
}

export function SqlLogicCell({
  dashboardId,
  connectionId,
  cell,
  isDark,
  variableValues,
  dragHandleProps,
  onUpdate,
  onDelete,
  onDuplicate,
  onMoveUp,
  onMoveDown,
  onToggleShowInApp,
}: SqlLogicCellProps) {
  const [showPreview, setShowPreview] = useState(true)
  const cellDataQuery = useCellData(dashboardId, connectionId, cell, variableValues)

  const handleRun = () => {
    void cellDataQuery.refetch()
  }

  const queryResult = cellDataQuery.data
  const isTruncated = queryResult?.truncated ?? false
  const error = cellDataQuery.error ? (cellDataQuery.error as Error).message : null

  const statusBadge = (
    <div className="flex items-center gap-2">
      {cellDataQuery.isFetching ? (
        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
          <SpinnerGapIcon className="size-3 animate-spin" />
          Running…
        </span>
      ) : queryResult ? (
        <span className="text-[11px] text-muted-foreground">
          {queryResult.rowCount.toLocaleString()} rows
        </span>
      ) : null}

      <Button
        variant="outline"
        size="sm"
        className="h-6 gap-1 px-2 text-[11px]"
        onClick={handleRun}
        disabled={cellDataQuery.isFetching || !cell.sql?.trim()}
      >
        <PlayIcon className="size-3 text-primary fill-primary" />
        Run
      </Button>
    </div>
  )

  return (
    <LogicCell
      cell={cell}
      dragHandleProps={dragHandleProps}
      onDelete={onDelete}
      onDuplicate={onDuplicate}
      onMoveUp={onMoveUp}
      onMoveDown={onMoveDown}
      onToggleShowInApp={onToggleShowInApp}
      statusBadge={statusBadge}
      isTruncated={isTruncated}
      error={error}
    >
      <div className="space-y-3">
        {/* Cell Header Inputs */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div>
            <label className="text-[10px] font-medium uppercase text-muted-foreground">
              Cell Title
            </label>
            <Input
              value={cell.title}
              onChange={(e) => onUpdate({ title: e.target.value })}
              placeholder="e.g. Monthly Revenue Query"
              className="mt-0.5 h-7 text-xs"
            />
          </div>
          <div>
            <label className="text-[10px] font-medium uppercase text-muted-foreground">
              Output Name
            </label>
            <Input
              value={cell.outputName}
              onChange={(e) =>
                onUpdate({
                  outputName: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
                })
              }
              placeholder="e.g. monthly_revenue"
              className="mt-0.5 h-7 font-mono text-xs"
            />
          </div>
        </div>

        {/* Monaco SQL Editor */}
        <div className="overflow-hidden rounded-md border border-border/80">
          <Editor
            height="130px"
            language="sql"
            theme={isDark ? 'vs-dark' : 'light'}
            value={cell.sql}
            onChange={(val) => onUpdate({ sql: val ?? '' })}
            options={{
              minimap: { enabled: false },
              lineNumbers: 'on',
              lineNumbersMinChars: 3,
              scrollBeyondLastLine: false,
              fontSize: 12,
              fontFamily: 'JetBrains Mono Variable, monospace',
              tabSize: 2,
              automaticLayout: true,
              wordWrap: 'on',
              padding: { top: 6, bottom: 6 },
            }}
          />
        </div>

        {/* Data Preview Table */}
        {queryResult && queryResult.columns.length > 0 ? (
          <div>
            <div className="flex items-center justify-between pb-1">
              <button
                type="button"
                className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
                onClick={() => setShowPreview((p) => !p)}
              >
                Preview Output ({Math.min(queryResult.rows.length, 5)} of {queryResult.rowCount.toLocaleString()} rows) {showPreview ? '▼' : '▶'}
              </button>
            </div>

            {showPreview ? (
              <div className="max-h-44 overflow-auto rounded border border-border/60 bg-muted/10 text-xs">
                <table className="w-full border-collapse text-left text-[11px]">
                  <thead>
                    <tr className="border-b border-border/80 bg-muted/40 font-mono text-muted-foreground">
                      {queryResult.columns.map((col) => (
                        <th key={col} className="px-2 py-1 font-medium">
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {queryResult.rows.slice(0, 5).map((row, rIdx) => (
                      <tr
                        key={rIdx}
                        className="border-b border-border/40 hover:bg-muted/20 font-mono"
                      >
                        {queryResult.columns.map((col) => (
                          <td key={col} className="truncate px-2 py-1 max-w-[200px]">
                            {row[col] == null ? (
                              <span className="text-muted-foreground/60 italic">null</span>
                            ) : (
                              String(row[col])
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </LogicCell>
  )
}
