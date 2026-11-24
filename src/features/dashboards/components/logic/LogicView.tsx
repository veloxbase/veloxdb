import { CodeIcon } from '@phosphor-icons/react'

import { Button } from '@/components/ui/button'
import type { Dashboard, NotebookCell } from '@/data/types'
import {
  addCell,
  deleteCell,
  duplicateVisualCell,
  getDependentCells,
  reorderCells,
  toggleCellShowInApp,
  updateCell,
} from '@/features/dashboards/notebook/cell-mutations'
import { AddCellMenu } from './AddCellMenu'
import { InputLogicCell } from './InputLogicCell'
import { MarkdownLogicCell } from './MarkdownLogicCell'
import { SqlLogicCell } from './SqlLogicCell'
import { VisualLogicCell } from './VisualLogicCell'

type LogicViewProps = {
  dashboardId: string
  connectionId: string
  draft: Dashboard
  isDark: boolean
  variableValues: Record<string, string>
  onDraftChange: (next: Dashboard) => void
  onOpenWidgetEditor: (widgetId: string) => void
}

export function LogicView({
  dashboardId,
  connectionId,
  draft,
  isDark,
  variableValues,
  onDraftChange,
  onOpenWidgetEditor,
}: LogicViewProps) {
  const cells = draft.cells ?? []

  const handleAddSql = () => {
    const id = crypto.randomUUID()
    const cell: NotebookCell = {
      id,
      type: 'sql',
      title: 'Query',
      sql: '',
      outputName: `query_${cells.length + 1}`,
      showInApp: false,
    }
    onDraftChange(addCell(draft, cell))
  }

  const handleAddInput = () => {
    const id = crypto.randomUUID()
    const cell: NotebookCell = {
      id,
      type: 'input',
      varName: `var_${cells.length + 1}`,
      inputType: 'text',
      defaultValue: '',
    }
    onDraftChange(addCell(draft, cell))
  }

  const handleAddChart = () => {
    const id = crypto.randomUUID()
    const firstSql = cells.find((c) => c.type === 'sql')
    const cell: NotebookCell = {
      id,
      type: 'visual',
      kind: 'chart',
      title: 'Chart',
      sourceCellId: firstSql?.id ?? '',
      viz: { chartType: 'bar', encodings: {}, options: {} },
      showInApp: true,
    }
    onDraftChange(addCell(draft, cell))
  }

  const handleAddTable = () => {
    const id = crypto.randomUUID()
    const firstSql = cells.find((c) => c.type === 'sql')
    const cell: NotebookCell = {
      id,
      type: 'visual',
      kind: 'table',
      title: 'Table View',
      sourceCellId: firstSql?.id ?? '',
      viz: null,
      showInApp: true,
    }
    onDraftChange(addCell(draft, cell))
  }

  const handleAddMarkdown = () => {
    const id = crypto.randomUUID()
    const cell: NotebookCell = {
      id,
      type: 'markdown',
      title: 'Note',
      content: '',
      showInApp: true,
    }
    onDraftChange(addCell(draft, cell))
  }

  const handleUpdate = (cellId: string, patch: Partial<NotebookCell>) => {
    onDraftChange(updateCell(draft, cellId, patch))
  }

  const handleDelete = (cellId: string) => {
    const dependents = getDependentCells(draft, cellId)
    if (dependents.length > 0) {
      const titles = dependents.map((d) => `"${'title' in d ? d.title : d.id}"`).join(', ')
      if (!window.confirm(`Deleting this query will also delete dependent visual cells (${titles}). Proceed?`)) {
        return
      }
      onDraftChange(deleteCell(draft, cellId, { forceCascade: true }))
      return
    }

    onDraftChange(deleteCell(draft, cellId))
  }

  const handleDuplicate = (cellId: string) => {
    onDraftChange(duplicateVisualCell(draft, cellId))
  }

  const handleMove = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= cells.length) return
    const activeCell = cells[index]
    const targetCell = cells[targetIndex]
    if (!activeCell || !targetCell) return
    onDraftChange(reorderCells(draft, activeCell.id, targetCell.id))
  }

  const handleToggleShowInApp = (cellId: string) => {
    onDraftChange(toggleCellShowInApp(draft, cellId))
  }

  if (cells.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <CodeIcon className="size-6" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground">No logic cells in this dashboard</h3>
          <p className="mt-1 max-w-sm text-xs text-muted-foreground">
            Logic view is a linear notebook of SQL queries, input parameters, charts, and notes. Add your first SQL query to get started.
          </p>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={handleAddSql}>
            <CodeIcon className="size-3.5" />
            Add SQL Query
          </Button>
          <AddCellMenu
            onAddSql={handleAddSql}
            onAddInput={handleAddInput}
            onAddChart={handleAddChart}
            onAddTable={handleAddTable}
            onAddMarkdown={handleAddMarkdown}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6">
      <div className="mx-auto max-w-4xl space-y-4">
        {/* Top Add Menu */}
        <div className="flex items-center justify-between pb-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Notebook Cells ({cells.length})
            </span>
          </div>
          <AddCellMenu
            onAddSql={handleAddSql}
            onAddInput={handleAddInput}
            onAddChart={handleAddChart}
            onAddTable={handleAddTable}
            onAddMarkdown={handleAddMarkdown}
          />
        </div>

        {/* Cell List */}
        <div className="space-y-4">
          {cells.map((cell, idx) => {
            const isFirst = idx === 0
            const isLast = idx === cells.length - 1

            if (cell.type === 'sql') {
              return (
                <SqlLogicCell
                  key={cell.id}
                  dashboardId={dashboardId}
                  connectionId={connectionId}
                  cell={cell}
                  isDark={isDark}
                  variableValues={variableValues}
                  onUpdate={(patch) => handleUpdate(cell.id, patch)}
                  onDelete={() => handleDelete(cell.id)}
                  onMoveUp={!isFirst ? () => handleMove(idx, 'up') : undefined}
                  onMoveDown={!isLast ? () => handleMove(idx, 'down') : undefined}
                  onToggleShowInApp={() => handleToggleShowInApp(cell.id)}
                />
              )
            }

            if (cell.type === 'input') {
              return (
                <InputLogicCell
                  key={cell.id}
                  cell={cell}
                  onUpdate={(patch) => handleUpdate(cell.id, patch)}
                  onDelete={() => handleDelete(cell.id)}
                  onMoveUp={!isFirst ? () => handleMove(idx, 'up') : undefined}
                  onMoveDown={!isLast ? () => handleMove(idx, 'down') : undefined}
                />
              )
            }

            if (cell.type === 'visual') {
              return (
                <VisualLogicCell
                  key={cell.id}
                  dashboardId={dashboardId}
                  connectionId={connectionId}
                  cell={cell}
                  allCells={cells}
                  isDark={isDark}
                  variableValues={variableValues}
                  onUpdate={(patch) => handleUpdate(cell.id, patch)}
                  onDelete={() => handleDelete(cell.id)}
                  onDuplicate={() => handleDuplicate(cell.id)}
                  onMoveUp={!isFirst ? () => handleMove(idx, 'up') : undefined}
                  onMoveDown={!isLast ? () => handleMove(idx, 'down') : undefined}
                  onToggleShowInApp={() => handleToggleShowInApp(cell.id)}
                  onOpenWidgetEditor={() => onOpenWidgetEditor(cell.id)}
                />
              )
            }

            if (cell.type === 'markdown') {
              return (
                <MarkdownLogicCell
                  key={cell.id}
                  cell={cell}
                  variableValues={variableValues}
                  onUpdate={(patch) => handleUpdate(cell.id, patch)}
                  onDelete={() => handleDelete(cell.id)}
                  onMoveUp={!isFirst ? () => handleMove(idx, 'up') : undefined}
                  onMoveDown={!isLast ? () => handleMove(idx, 'down') : undefined}
                  onToggleShowInApp={() => handleToggleShowInApp(cell.id)}
                />
              )
            }

            return null
          })}
        </div>

        {/* Bottom Add Menu */}
        <div className="flex justify-center pt-2 pb-6">
          <AddCellMenu
            onAddSql={handleAddSql}
            onAddInput={handleAddInput}
            onAddChart={handleAddChart}
            onAddTable={handleAddTable}
            onAddMarkdown={handleAddMarkdown}
          />
        </div>
      </div>
    </div>
  )
}
