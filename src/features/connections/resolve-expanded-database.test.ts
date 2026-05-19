import { describe, expect, it } from 'vitest'

import type { ConnectionSummary } from '@/data/types'
import { resolveExpandedDatabaseName } from '@/features/connections/components/ConnectionsSidebarTree'

function connection(overrides: Partial<ConnectionSummary> = {}): ConnectionSummary {
  return {
    id: 'c1',
    name: 'Test',
    engine: 'mysql',
    host: '127.0.0.1',
    port: 3306,
    database: 'my_app',
    user: 'root',
    connectedAt: '2026-01-01T00:00:00Z',
    sslMode: 'disable',
    tablePropertyEditingSupported: false,
    ...overrides,
  }
}

describe('resolveExpandedDatabaseName', () => {
  const dbList = [{ name: 'my_app' }, { name: 'other_db' }]

  it('returns saved name on exact match', () => {
    expect(resolveExpandedDatabaseName(connection(), dbList)).toBe('my_app')
  })

  it('uses case-insensitive match for mysql', () => {
    expect(
      resolveExpandedDatabaseName(connection({ database: 'MY_APP' }), dbList),
    ).toBe('my_app')
  })

  it('falls back to first database when saved name is missing', () => {
    expect(
      resolveExpandedDatabaseName(connection({ database: 'postgres' }), dbList),
    ).toBe('my_app')
  })

  it('keeps postgres behavior when saved name is missing', () => {
    expect(
      resolveExpandedDatabaseName(
        connection({ engine: 'postgres', database: 'missing' }),
        [{ name: 'postgres' }, { name: 'template1' }],
      ),
    ).toBe('missing')
  })
})
