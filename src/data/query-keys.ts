import type { TableInfo } from '@/data/types'

export const queryKeys = {
  connections: () => ['connections'] as const,

  tables: (connectionId?: string | null) =>
    ['tables', connectionId ?? null] as const,

  schema: (connectionId: string | undefined, table?: TableInfo | null) =>
    ['schema', connectionId ?? null, table?.schema ?? null, table?.name ?? null] as const,

  tableProperties: (connectionId: string | undefined, table?: TableInfo | null) =>
    ['tableProperties', connectionId ?? null, table?.schema ?? null, table?.name ?? null] as const,

  foreignKeys: (connectionId?: string | null) =>
    ['foreignKeys', connectionId ?? null] as const,
} as const

export type QueryKeys = typeof queryKeys

