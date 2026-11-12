import type { Dashboard, DashboardVariable, NotebookCell, Widget, WidgetLayout } from '@/data/types'
import { DEFAULT_WIDGET_SIZE } from '@/features/dashboards/grid-constants'

function nextSlotY(layout: WidgetLayout[]): number {
  if (layout.length === 0) return 0
  return Math.max(...layout.map((slot) => slot.y + slot.h))
}

/**
 * Pure synchronization function that projects the canonical `cells` array
 * into `variables`, `widgets`, and `layout`.
 */
export function syncDashboardFromCells(dashboard: Dashboard): Dashboard {
  const cells = dashboard.cells ?? []
  const oldWidgets = dashboard.widgets ?? {}
  const oldLayout = dashboard.layout ?? []

  // 1. Rebuild variables from 'input' cells
  const variables: DashboardVariable[] = []
  for (const cell of cells) {
    if (cell.type === 'input') {
      variables.push(
        cell.inputType === 'dropdown'
          ? { name: cell.varName, type: 'select', defaultValue: cell.defaultValue, options: cell.options ?? [] }
          : { name: cell.varName, type: cell.inputType, defaultValue: cell.defaultValue },
      )
    }
  }

  // 2. Map of SQL cells by id for resolving source SQL
  const sqlCellsById = new Map<string, Extract<NotebookCell, { type: 'sql' }>>()
  for (const cell of cells) {
    if (cell.type === 'sql') {
      sqlCellsById.set(cell.id, cell)
    }
  }

  // 3. Rebuild widgets from showInApp cells
  const widgets: Record<string, Widget> = {}
  const activeWidgetIds = new Set<string>()

  for (const cell of cells) {
    if (!('showInApp' in cell) || !cell.showInApp) continue

    const existingWidget = oldWidgets[cell.id]
    activeWidgetIds.add(cell.id)

    if (cell.type === 'visual') {
      const sourceSqlCell = sqlCellsById.get(cell.sourceCellId)
      const resolvedSql = sourceSqlCell?.sql ?? existingWidget?.query?.sql ?? ''

      widgets[cell.id] = {
        id: cell.id,
        kind: cell.kind,
        title: cell.title,
        query: {
          providerId: 'sql-query',
          connectionId: dashboard.connectionId,
          sql: resolvedSql,
          savedQueryId: existingWidget?.query?.savedQueryId ?? null,
          sourceCellId: cell.sourceCellId,
        },
        viz: cell.viz,
        locked: existingWidget?.locked ?? false,
      }
    } else if (cell.type === 'markdown') {
      widgets[cell.id] = {
        id: cell.id,
        kind: 'text',
        title: cell.title,
        query: null,
        viz: {
          chartType: 'line',
          encodings: {},
          options: { content: cell.content },
        },
        locked: existingWidget?.locked ?? false,
      }
    } else if (cell.type === 'sql') {
      widgets[cell.id] = {
        id: cell.id,
        kind: 'table',
        title: cell.title,
        query: {
          providerId: 'sql-query',
          connectionId: dashboard.connectionId,
          sql: cell.sql,
          savedQueryId: null,
          sourceCellId: cell.id,
        },
        viz: null,
        locked: existingWidget?.locked ?? false,
      }
    }
  }

  // 4. Rebuild layout: keep existing valid slots, drop orphans, append new slots
  const layout: WidgetLayout[] = []
  const existingLayoutIds = new Set<string>()

  for (const slot of oldLayout) {
    if (activeWidgetIds.has(slot.i)) {
      layout.push(slot)
      existingLayoutIds.add(slot.i)
    }
  }

  for (const cell of cells) {
    if (!('showInApp' in cell) || !cell.showInApp) continue
    if (existingLayoutIds.has(cell.id)) continue

    const kind = cell.type === 'markdown' ? 'text' : cell.type === 'sql' ? 'table' : cell.kind
    const size = DEFAULT_WIDGET_SIZE[kind] ?? { w: 6, h: 4 }
    const y = nextSlotY(layout)

    layout.push({
      i: cell.id,
      x: 0,
      y,
      w: size.w,
      h: size.h,
      isStatic: false,
    })
    existingLayoutIds.add(cell.id)
  }

  return {
    ...dashboard,
    variables,
    widgets,
    layout,
    updatedAt: Date.now(),
  }
}
