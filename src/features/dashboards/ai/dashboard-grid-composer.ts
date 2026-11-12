import type { Dashboard, DashboardVariable, NotebookCell, Widget, WidgetLayout } from '@/data/types'
import { DASHBOARD_VERSION } from '@/features/dashboards/dashboard-types'
import type { ValidatedWidgetItem } from './dashboard-generator-types'

const GRID_COLUMNS = 12

function variableCells(variables: DashboardVariable[]): NotebookCell[] {
  return variables.map((variable) => ({
    id: `input_${variable.name}`,
    type: 'input' as const,
    varName: variable.name,
    inputType: variable.type === 'select' ? 'dropdown' as const : variable.type,
    defaultValue: variable.defaultValue,
    options: variable.type === 'select' ? variable.options ?? [] : undefined,
  }))
}

/**
 * Calculates a structured 12-column grid layout for generated dashboard widgets.
 * Arranges KPI summary cards across the top, followed by trends, breakdowns, and tables.
 */
export function composeDashboardGrid(
  connectionId: string,
  name: string,
  description: string | undefined,
  items: ValidatedWidgetItem[],
  variables: DashboardVariable[] = [],
): Dashboard {
  const now = Date.now()
  const widgets: Record<string, Widget> = {}
  const layout: WidgetLayout[] = []

  if (items.length === 0) {
    return {
      version: DASHBOARD_VERSION,
      id: crypto.randomUUID(),
      name,
      description: description || undefined,
      connectionId,
      cells: variableCells(variables),
      layout: [],
      widgets: {},
      variables,
      theme: 'inherit',
      refreshIntervalSec: null,
      pages: [{ id: 'page_overview', name: 'Overview', widgetIds: [] }],
      createdAt: now,
      updatedAt: now,
    }
  }

  // Split into tiers
  const kpis: ValidatedWidgetItem[] = []
  const nonKpis: ValidatedWidgetItem[] = []

  for (const item of items) {
    const isKpi = item.kind === 'kpi' || item.viz?.chartType === 'kpi'
    if (isKpi) {
      kpis.push(item)
    } else {
      nonKpis.push(item)
    }
  }

  let currentY = 0

  // 1. Arrange KPIs in top row(s)
  if (kpis.length > 0) {
    let kpiWidth = 4 // Default for 3 KPIs
    if (kpis.length === 1) kpiWidth = 6
    else if (kpis.length === 2) kpiWidth = 6
    else if (kpis.length === 3) kpiWidth = 4
    else if (kpis.length >= 4) kpiWidth = 3

    let currentX = 0
    for (const kpi of kpis) {
      if (currentX + kpiWidth > GRID_COLUMNS) {
        currentX = 0
        currentY += 2
      }

      const sqlCellId = `${kpi.id}_sql`
      widgets[kpi.id] = {
        id: kpi.id,
        kind: 'kpi',
        title: kpi.title,
        query: {
          providerId: 'sql-query',
          connectionId,
          sql: kpi.sql,
          savedQueryId: null,
          sourceCellId: sqlCellId,
        },
        viz: kpi.viz,
        locked: false,
      }

      layout.push({
        i: kpi.id,
        x: currentX,
        y: currentY,
        w: kpiWidth,
        h: 2,
        isStatic: false,
      })

      currentX += kpiWidth
    }

    currentY += 2
  }

  // 2. Arrange main charts and tables (2 columns of width 6 each, or full width if alone)
  let currentX = 0
  for (let idx = 0; idx < nonKpis.length; idx++) {
    const item = nonKpis[idx]
    if (!item) continue

    const isSingleRemaining = idx === nonKpis.length - 1 && currentX === 0
    const isTable = item.kind === 'table'
    const itemWidth = isSingleRemaining && isTable ? 12 : 6
    const itemHeight = isTable && isSingleRemaining ? 5 : 4
    const sqlCellId = `${item.id}_sql`

    widgets[item.id] = {
      id: item.id,
      kind: item.kind,
      title: item.title,
      query: {
        providerId: 'sql-query',
        connectionId,
        sql: item.sql,
        savedQueryId: null,
        sourceCellId: sqlCellId,
      },
      viz: item.viz,
      locked: false,
    }

    layout.push({
      i: item.id,
      x: currentX,
      y: currentY,
      w: itemWidth,
      h: itemHeight,
      isStatic: false,
    })

    if (itemWidth === 12) {
      currentX = 0
      currentY += itemHeight
    } else {
      currentX += itemWidth
      if (currentX >= GRID_COLUMNS) {
        currentX = 0
        currentY += itemHeight
      }
    }
  }

  // 3. Generate canonical v2 cells (input filters, then sql + visual pairs)
  const cells: Dashboard['cells'] = variableCells(variables)
  for (const item of items) {
    const sqlCellId = `${item.id}_sql`
    const outputSlug = item.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'metric'

    cells.push({
      id: sqlCellId,
      type: 'sql',
      title: `${item.title} Query`,
      sql: item.sql,
      outputName: outputSlug,
      showInApp: false,
    })

    cells.push({
      id: item.id,
      type: 'visual',
      kind: item.kind === 'kpi' ? 'kpi' : item.kind === 'table' ? 'table' : 'chart',
      title: item.title,
      sourceCellId: sqlCellId,
      viz: item.viz,
      showInApp: true,
    })
  }

  return {
    version: DASHBOARD_VERSION,
    id: crypto.randomUUID(),
    name: name.trim() || 'Generated Dashboard',
    description: description?.trim() || undefined,
    connectionId,
    cells,
    layout,
    widgets,
    variables,
    theme: 'inherit',
    refreshIntervalSec: null,
    pages: [{ id: 'page_overview', name: 'Overview', widgetIds: layout.map((slot) => slot.i) }],
    createdAt: now,
    updatedAt: now,
  }
}
