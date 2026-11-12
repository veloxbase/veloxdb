import { z } from 'zod'

import type { Dashboard } from '@/data/types'
import { DASHBOARD_VERSION } from '@/features/dashboards/dashboard-types'

export class DashboardMigrationError extends Error {
  readonly cause?: unknown

  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'DashboardMigrationError'
    this.cause = cause
  }
}

const columnRoleSchema = z.enum(['temporal', 'categorical', 'numeric'])

const columnRefSchema = z.object({
  column: z.string(),
  role: columnRoleSchema.optional(),
})

const chartTypeSchema = z.enum([
  'line', 'area', 'bar', 'horizontalBar', 'pie', 'donut',
  'scatter', 'heatmap', 'treemap', 'gauge', 'kpi',
  'combo', 'histogram', 'box', 'waterfall',
])

const vizConfigSchema = z.object({
  chartType: chartTypeSchema,
  encodings: z.object({
    x: columnRefSchema.optional(),
    y: z.array(columnRefSchema).optional(),
    series: columnRefSchema.optional(),
    size: columnRefSchema.optional(),
  }),
  options: z.record(z.string(), z.unknown()),
})

const widgetQuerySchema = z.object({
  providerId: z.literal('sql-query'),
  connectionId: z.string(),
  sql: z.string(),
  savedQueryId: z.string().nullish(),
  sourceCellId: z.string().nullish(),
})

const widgetKindSchema = z.enum([
  'chart', 'kpi', 'table', 'text', 'markdown', 'image', 'divider', 'filter',
])

const widgetSchema = z.object({
  id: z.string(),
  kind: widgetKindSchema,
  title: z.string(),
  query: widgetQuerySchema.nullable(),
  viz: vizConfigSchema.nullable(),
  locked: z.boolean(),
})

const widgetLayoutSchema = z.object({
  i: z.string(),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  isStatic: z.boolean().optional(),
})

const dashboardVariableSchema = z.object({
  name: z.string(),
  type: z.enum(['text', 'number', 'date', 'select']),
  defaultValue: z.string(),
  options: z.array(z.string()).optional(),
  label: z.string().optional(),
})

const sqlCellSchema = z.object({
  id: z.string(),
  type: z.literal('sql'),
  title: z.string(),
  sql: z.string(),
  outputName: z.string(),
  showInApp: z.boolean(),
})

const inputCellSchema = z.object({
  id: z.string(),
  type: z.literal('input'),
  varName: z.string(),
  inputType: z.enum(['text', 'number', 'date', 'dropdown']),
  defaultValue: z.string(),
  options: z.array(z.string()).optional(),
})

const visualCellSchema = z.object({
  id: z.string(),
  type: z.literal('visual'),
  kind: z.enum(['chart', 'kpi', 'table']),
  title: z.string(),
  sourceCellId: z.string(),
  viz: vizConfigSchema.nullable(),
  showInApp: z.boolean(),
})

const markdownCellSchema = z.object({
  id: z.string(),
  type: z.literal('markdown'),
  title: z.string(),
  content: z.string(),
  showInApp: z.boolean(),
})

const notebookCellSchema = z.discriminatedUnion('type', [
  sqlCellSchema,
  inputCellSchema,
  visualCellSchema,
  markdownCellSchema,
])

const dashboardSchema = z.object({
  version: z.number(),
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullish(),
  connectionId: z.string().min(1),
  cells: z.array(notebookCellSchema),
  layout: z.array(widgetLayoutSchema),
  widgets: z.record(z.string(), widgetSchema),
  variables: z.array(dashboardVariableSchema),
  theme: z.enum(['inherit', 'light', 'dark']),
  refreshIntervalSec: z.number().nullable(),
  pages: z.array(z.object({
    id: z.string(),
    name: z.string(),
    widgetIds: z.array(z.string()),
  })).optional(),
  story: z.object({
    id: z.string(),
    title: z.string(),
    beats: z.array(z.object({
      pageId: z.string(),
      caption: z.string(),
    })),
  }).nullish(),
  createdAt: z.number(),
  updatedAt: z.number(),
})

/** Step migrations keyed by the version they upgrade *from*. Add entries as `DASHBOARD_VERSION` bumps. */
const migrations: Record<number, (doc: Record<string, unknown>) => Record<string, unknown>> = {
  0: (rawDoc: Record<string, unknown>): Record<string, unknown> => ({
    ...rawDoc,
    version: 1,
  }),
  1: (rawDoc: Record<string, unknown>): Record<string, unknown> => {
    const doc = { ...rawDoc }
    const widgets = ((doc.widgets && typeof doc.widgets === 'object') ? doc.widgets : {}) as Record<string, Record<string, any>>
    const layout = (Array.isArray(doc.layout) ? doc.layout : []) as Array<{ i: string }>
    const variables = (Array.isArray(doc.variables) ? doc.variables : []) as Array<{
      name: string
      type: 'text' | 'number' | 'date' | 'select'
      defaultValue: string
      options?: string[]
    }>

    const cells: any[] = []

    // 1. Convert variables to input cells at top
    for (const v of variables) {
      const isSelect = v.type === 'select'
      cells.push({
        id: `input_${v.name}`,
        type: 'input',
        varName: v.name,
        inputType: isSelect ? 'dropdown' : (v.type ?? 'text'),
        defaultValue: v.defaultValue ?? '',
        ...(isSelect && Array.isArray(v.options) ? { options: v.options } : {}),
      })
    }

    // 2. Iterate widgets in layout order first, then leftover widgets
    const visitedWidgetIds = new Set<string>()
    const orderedWidgetIds: string[] = []

    for (const slot of layout) {
      if (slot && typeof slot.i === 'string' && widgets[slot.i]) {
        orderedWidgetIds.push(slot.i)
        visitedWidgetIds.add(slot.i)
      }
    }

    for (const wid of Object.keys(widgets)) {
      if (!visitedWidgetIds.has(wid)) {
        orderedWidgetIds.push(wid)
      }
    }

    const updatedWidgets: Record<string, any> = { ...widgets }

    for (const wid of orderedWidgetIds) {
      const w = widgets[wid]
      if (!w) continue

      const kind = w.kind
      const sql = typeof w.query?.sql === 'string' ? w.query.sql.trim() : ''

      if (sql && (kind === 'chart' || kind === 'kpi' || kind === 'table')) {
        const sqlCellId = `${w.id}_sql`
        const titleSlug = (w.title || 'query')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_+|_+$/g, '') || 'output'

        cells.push({
          id: sqlCellId,
          type: 'sql',
          title: `${w.title || 'Query'} SQL`,
          sql: w.query.sql,
          outputName: titleSlug,
          showInApp: false,
        })

        cells.push({
          id: w.id,
          type: 'visual',
          kind,
          title: w.title || 'Visual',
          sourceCellId: sqlCellId,
          viz: w.viz ?? null,
          showInApp: true,
        })

        updatedWidgets[wid] = {
          ...w,
          query: {
            ...w.query,
            sourceCellId: sqlCellId,
          },
        }
      } else if (kind === 'text' || kind === 'markdown') {
        const content = typeof w.viz?.options?.content === 'string'
          ? w.viz.options.content
          : ''

        cells.push({
          id: w.id,
          type: 'markdown',
          title: w.title || 'Note',
          content,
          showInApp: true,
        })
      } else {
        cells.push({
          id: w.id,
          type: 'markdown',
          title: w.title || 'Note',
          content: '',
          showInApp: true,
        })
      }
    }

    return {
      ...doc,
      version: 2,
      cells,
      widgets: updatedWidgets,
      updatedAt: Date.now(),
    }
  },
  2: (rawDoc: Record<string, unknown>): Record<string, unknown> => {
    const widgets = (rawDoc.widgets && typeof rawDoc.widgets === 'object'
      ? Object.keys(rawDoc.widgets as object)
      : []) as string[]
    const layout = (Array.isArray(rawDoc.layout) ? rawDoc.layout : []) as Array<{ i: string }>
    const widgetIds = layout.length > 0 ? layout.map((slot) => slot.i) : widgets
    return {
      ...rawDoc,
      version: 3,
      pages: Array.isArray(rawDoc.pages) && (rawDoc.pages as unknown[]).length > 0
        ? rawDoc.pages
        : [{ id: 'page_overview', name: 'Overview', widgetIds }],
      story: rawDoc.story ?? null,
    }
  },
}

function applyStepMigrations(raw: Record<string, unknown>): Record<string, unknown> {
  let doc = { ...raw }
  let version = typeof doc.version === 'number' ? doc.version : 0
  while (version < DASHBOARD_VERSION) {
    const step = migrations[version]
    if (!step) {
      throw new DashboardMigrationError(
        `No migration path from dashboard version ${version} to ${DASHBOARD_VERSION}.`,
      )
    }
    doc = step(doc)
    version = typeof doc.version === 'number' ? doc.version : version + 1
  }

  // Fallback: If document is version 2, but cells array is missing or empty while widgets/variables exist,
  // ensure we run the v1 -> v2 migration to rebuild the cells array.
  const hasNoCells = !Array.isArray(doc.cells) || doc.cells.length === 0
  const hasWidgetsOrVariables =
    (doc.widgets && typeof doc.widgets === 'object' && Object.keys(doc.widgets as object).length > 0) ||
    (Array.isArray(doc.variables) && doc.variables.length > 0)

  if (hasNoCells && hasWidgetsOrVariables) {
    doc = migrations[1](doc)
  }

  return doc
}

/**
 * Validates and upgrades a raw dashboard document (from IPC or an imported
 * JSON file) to the current `DASHBOARD_VERSION` shape. Call before rendering
 * or persisting any dashboard loaded from `get_dashboard` or file import.
 */
export function migrateDashboard(raw: unknown): Dashboard {
  if (typeof raw !== 'object' || raw === null) {
    throw new DashboardMigrationError('Dashboard document must be an object.')
  }

  const migrated = applyStepMigrations(raw as Record<string, unknown>)

  const result = dashboardSchema.safeParse(migrated)
  if (!result.success) {
    throw new DashboardMigrationError('Dashboard document failed validation.', result.error)
  }

  return result.data as Dashboard
}
