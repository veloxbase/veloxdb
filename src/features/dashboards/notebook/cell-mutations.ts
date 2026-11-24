import type { Dashboard, NotebookCell } from '@/data/types'
import { migrateDashboard } from '@/features/dashboards/dashboard-migrate'
import { syncDashboardFromCells } from './sync-dashboard-from-cells'

function ensureCells(dashboard: Dashboard): Dashboard {
  const hasNoCells = !Array.isArray(dashboard.cells) || dashboard.cells.length === 0
  const hasWidgetsOrVariables =
    (dashboard.widgets && typeof dashboard.widgets === 'object' && Object.keys(dashboard.widgets).length > 0) ||
    (Array.isArray(dashboard.variables) && dashboard.variables.length > 0)

  if (hasNoCells && hasWidgetsOrVariables) {
    try {
      return migrateDashboard(dashboard)
    } catch {
      return dashboard
    }
  }
  return dashboard
}

/**
 * Returns any visual cells that reference the given SQL cell ID.
 */
export function getDependentCells(dashboard: Dashboard, cellId: string): NotebookCell[] {
  const dash = ensureCells(dashboard)
  return (dash.cells ?? []).filter(
    (c) => c.type === 'visual' && c.sourceCellId === cellId,
  )
}

/**
 * Adds a new notebook cell and re-syncs the dashboard projection.
 */
export function addCell(
  dashboard: Dashboard,
  cell: NotebookCell,
  insertIndex?: number,
): Dashboard {
  const dash = ensureCells(dashboard)
  const currentCells = [...(dash.cells ?? [])]
  if (insertIndex !== undefined && insertIndex >= 0 && insertIndex <= currentCells.length) {
    currentCells.splice(insertIndex, 0, cell)
  } else {
    currentCells.push(cell)
  }

  return syncDashboardFromCells({
    ...dash,
    cells: currentCells,
  })
}

/**
 * Updates an existing cell by ID and re-syncs.
 */
export function updateCell(
  dashboard: Dashboard,
  cellId: string,
  patch: Partial<NotebookCell>,
): Dashboard {
  const dash = ensureCells(dashboard)
  const currentCells = (dash.cells ?? []).map((c) => {
    if (c.id !== cellId) return c
    return { ...c, ...patch } as NotebookCell
  })

  return syncDashboardFromCells({
    ...dash,
    cells: currentCells,
  })
}

/**
 * Deletes a cell. If the cell is a SQL cell with dependent visual cells,
 * either removes them (when `forceCascade: true`) or throws an Error.
 */
export function deleteCell(
  dashboard: Dashboard,
  cellId: string,
  options?: { forceCascade?: boolean },
): Dashboard {
  const dash = ensureCells(dashboard)
  const dependents = getDependentCells(dash, cellId)
  if (dependents.length > 0 && !options?.forceCascade) {
    const titles = dependents.map((d) => `"${'title' in d ? d.title : d.id}"`).join(', ')
    throw new Error(`Cannot delete query cell: referenced by visual cells ${titles}.`)
  }

  const idsToDelete = new Set<string>([cellId])
  if (options?.forceCascade) {
    for (const dep of dependents) {
      idsToDelete.add(dep.id)
    }
  }

  const nextCells = (dash.cells ?? []).filter((c) => !idsToDelete.has(c.id))

  return syncDashboardFromCells({
    ...dash,
    cells: nextCells,
  })
}

/**
 * Reorders a cell in the linear logic flow using activeId and overId.
 */
export function reorderCells(
  dashboard: Dashboard,
  activeId: string,
  overId: string,
): Dashboard {
  const dash = ensureCells(dashboard)
  const currentCells = [...(dash.cells ?? [])]
  const oldIndex = currentCells.findIndex((c) => c.id === activeId)
  const newIndex = currentCells.findIndex((c) => c.id === overId)

  if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) {
    return dash
  }

  const [moved] = currentCells.splice(oldIndex, 1)
  if (moved) {
    currentCells.splice(newIndex, 0, moved)
  }

  return syncDashboardFromCells({
    ...dash,
    cells: currentCells,
  })
}

/**
 * Toggles whether a visual or markdown or sql cell appears on the App canvas.
 */
export function toggleCellShowInApp(
  dashboard: Dashboard,
  cellId: string,
): Dashboard {
  const dash = ensureCells(dashboard)
  const currentCells = (dash.cells ?? []).map((c) => {
    if (c.id !== cellId) return c
    if ('showInApp' in c) {
      return { ...c, showInApp: !c.showInApp } as NotebookCell
    }
    return c
  })

  return syncDashboardFromCells({
    ...dash,
    cells: currentCells,
  })
}

/**
 * Duplicates a visual cell, pointing the copy to the exact same source SQL cell.
 */
export function duplicateVisualCell(
  dashboard: Dashboard,
  visualCellId: string,
): Dashboard {
  const dash = ensureCells(dashboard)
  const currentCells = [...(dash.cells ?? [])]
  const index = currentCells.findIndex((c) => c.id === visualCellId)
  if (index === -1) return dash

  const original = currentCells[index]
  if (!original || original.type !== 'visual') return dash

  const newId = crypto.randomUUID()
  const duplicate: NotebookCell = {
    ...original,
    id: newId,
    title: `${original.title} (copy)`,
  }

  currentCells.splice(index + 1, 0, duplicate)

  return syncDashboardFromCells({
    ...dash,
    cells: currentCells,
  })
}
