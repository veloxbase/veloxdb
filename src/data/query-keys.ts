import type { TableInfo } from '@/data/types'

export const queryKeys = {
  connections: () => ['connections'] as const,
  mcpStatus: () => ['mcpStatus'] as const,

  tables: (connectionId?: string | null) =>
    ['tables', connectionId ?? null] as const,

  queryEditorMetadata: (connectionId?: string | null) =>
    ['queryEditorMetadata', connectionId ?? null] as const,

  schema: (connectionId: string | undefined, table?: TableInfo | null) =>
    ['schema', connectionId ?? null, table?.schema ?? null, table?.name ?? null] as const,

  tableProperties: (connectionId: string | undefined, table?: TableInfo | null) =>
    ['tableProperties', connectionId ?? null, table?.schema ?? null, table?.name ?? null] as const,

  foreignKeys: (connectionId?: string | null) =>
    ['foreignKeys', connectionId ?? null] as const,

  tableIndexes: (connectionId: string | undefined, table?: TableInfo | null) =>
    ['tableIndexes', connectionId ?? null, table?.schema ?? null, table?.name ?? null] as const,
  databases: (connectionId?: string | null) =>
    ['databases', connectionId ?? null] as const,

  savedQueries: (connectionId?: string | null) =>
    ['savedQueries', connectionId ?? null] as const,
  savedQuery: (id: string) =>
    ['savedQuery', id] as const,

  dashboards: (connectionId?: string | null) =>
    ['dashboards', connectionId ?? null] as const,
  dashboard: (id: string) =>
    ['dashboard', id] as const,
  veloxyThreads: (connectionId?: string | null) =>
    ['veloxyThreads', connectionId ?? null] as const,
  veloxyThread: (id: string) =>
    ['veloxyThread', id] as const,
  // Phase 2: per-widget query results, keyed so param/SQL changes refetch.
  widgetData: (dashboardId: string, widgetId: string, sqlHash: string, varsHash: string) =>
    ['widgetData', dashboardId, widgetId, sqlHash, varsHash] as const,
  // Phase 3: per-cell query results (shared across widgets referencing sourceCellId).
  cellData: (dashboardId: string, cellId: string, sqlHash: string, varsHash: string) =>
    ['cellData', dashboardId, cellId, sqlHash, varsHash] as const,
  // Phase 2: Chart Builder preview fetch, keyed by connection + SQL hash.
  chartPreview: (connectionId: string, sqlHash: string) =>
    ['chartPreview', connectionId, sqlHash] as const,

  session: () => ['session'] as const,
} as const

export type QueryKeys = typeof queryKeys

