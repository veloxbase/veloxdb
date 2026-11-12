import { useMemo } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { NotebookCell, QueryResult } from '@/data/types'
import { ChartCanvas } from '@/features/dashboards/charts/ChartCanvas'
import { useCellData } from '@/features/dashboards/hooks/useCellData'
import { getChartPlugin } from '@/features/plugins/registry'
import { LogicCell } from './LogicCell'

type VisualLogicCellProps = {
  dashboardId: string
  connectionId: string
  cell: Extract<NotebookCell, { type: 'visual' }>
  allCells: NotebookCell[]
  isDark: boolean
  variableValues: Record<string, string>
  dragHandleProps?: Record<string, unknown>
  onUpdate: (patch: Partial<NotebookCell>) => void
  onDelete: () => void
  onDuplicate?: () => void
  onMoveUp?: () => void
  onMoveDown?: () => void
  onToggleShowInApp: () => void
  onOpenWidgetEditor: () => void
}

export function VisualLogicCell({
  dashboardId,
  connectionId,
  cell,
  allCells,
  variableValues,
  dragHandleProps,
  onUpdate,
  onDelete,
  onDuplicate,
  onMoveUp,
  onMoveDown,
  onToggleShowInApp,
  onOpenWidgetEditor,
}: VisualLogicCellProps) {
  // Find available SQL cells
  const sqlCells = useMemo(
    () => allCells.filter((c): c is Extract<NotebookCell, { type: 'sql' }> => c.type === 'sql'),
    [allCells],
  )

  const selectedSqlCell = useMemo(
    () => sqlCells.find((c) => c.id === cell.sourceCellId),
    [sqlCells, cell.sourceCellId],
  )

  // Fetch data using the shared cellData hook
  const cellDataQuery = useCellData(
    dashboardId,
    connectionId,
    selectedSqlCell ?? { id: '', type: 'sql', title: '', sql: '', outputName: '', showInApp: false },
    variableValues,
  )

  const queryResult: QueryResult | undefined = cellDataQuery.data

  const chartPlugin = cell.viz ? getChartPlugin(cell.viz.chartType) : undefined
  const chartDef = useMemo(() => {
    if (!chartPlugin || !cell.viz || !queryResult || cell.kind !== 'chart') return null
    return chartPlugin.buildChart(queryResult, cell.viz)
  }, [chartPlugin, cell.viz, queryResult, cell.kind])

  return (
    <LogicCell
      cell={cell}
      dragHandleProps={dragHandleProps}
      onDelete={onDelete}
      onDuplicate={onDuplicate}
      onMoveUp={onMoveUp}
      onMoveDown={onMoveDown}
      onToggleShowInApp={onToggleShowInApp}
      error={cellDataQuery.error ? (cellDataQuery.error as Error).message : null}
    >
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div>
            <label className="text-[10px] font-medium uppercase text-muted-foreground">
              Visual Title
            </label>
            <Input
              value={cell.title}
              onChange={(e) => onUpdate({ title: e.target.value })}
              placeholder="e.g. Sales Trend"
              className="mt-0.5 h-7 text-xs"
            />
          </div>

          <div>
            <label className="text-[10px] font-medium uppercase text-muted-foreground">
              Visual Kind
            </label>
            <select
              value={cell.kind}
              onChange={(e) => onUpdate({ kind: e.target.value as 'chart' | 'kpi' | 'table' })}
              className="mt-0.5 h-7 w-full rounded-md border border-input bg-background px-2 text-xs shadow-xs focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="chart">Chart</option>
              <option value="kpi">KPI Card</option>
              <option value="table">Table</option>
            </select>
          </div>

          <div>
            <label className="text-[10px] font-medium uppercase text-muted-foreground">
              Source Query Cell
            </label>
            <select
              value={cell.sourceCellId}
              onChange={(e) => onUpdate({ sourceCellId: e.target.value })}
              className="mt-0.5 h-7 w-full rounded-md border border-input bg-background px-2 text-xs shadow-xs focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">Select a query cell</option>
              {sqlCells.map((sc) => (
                <option key={sc.id} value={sc.id}>
                  {sc.title || sc.outputName || 'Query'} ({sc.id})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Visual Preview */}
        <div className="relative min-h-32 rounded-md border border-border/60 bg-muted/5 p-2">
          {cell.kind === 'kpi' ? (
            <div className="flex h-28 flex-col items-center justify-center gap-1">
              <span className="text-2xl font-bold tracking-tight text-foreground">
                {queryResult && queryResult.rows[0]
                  ? String(Object.values(queryResult.rows[0])[0] ?? '—')
                  : '—'}
              </span>
              <span className="text-xs text-muted-foreground">{cell.title}</span>
            </div>
          ) : cell.kind === 'table' ? (
            <div className="max-h-36 overflow-auto text-xs">
              {queryResult && queryResult.columns.length > 0 ? (
                <table className="w-full border-collapse text-left text-[11px]">
                  <thead>
                    <tr className="border-b border-border/80 bg-muted/40 font-mono text-muted-foreground">
                      {queryResult.columns.map((c) => (
                        <th key={c} className="px-2 py-1 font-medium">{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {queryResult.rows.slice(0, 3).map((r, i) => (
                      <tr key={i} className="border-b border-border/40 font-mono">
                        {queryResult.columns.map((c) => (
                          <td key={c} className="truncate px-2 py-1">{String(r[c] ?? '')}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="py-6 text-center text-xs text-muted-foreground">No data</p>
              )}
            </div>
          ) : (
            <div className="h-44 w-full">
              <ChartCanvas
                definition={chartDef}
                ariaLabel={cell.title}
                loading={cellDataQuery.isFetching}
                error={cellDataQuery.error ? (cellDataQuery.error as Error).message : null}
              />
            </div>
          )}

          <div className="mt-2 flex items-center justify-end">
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-[11px]"
              onClick={onOpenWidgetEditor}
            >
              Configure Chart Encodings & Styling
            </Button>
          </div>
        </div>
      </div>
    </LogicCell>
  )
}
