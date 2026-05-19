import { describe, expect, it } from 'vitest'

import { buildExplainSql, buildTransactionalSql } from '@/features/queries/queries'
import { useSettings } from '@/lib/settings'

describe('maxQueryRows wiring', () => {
  it('settings default matches the backend MAX_QUERY_ROWS fallback', () => {
    // When maxRows is omitted from QueryRequest, the Rust backend
    // falls back to MAX_QUERY_ROWS = 1000. The Zustand settings default
    // must stay in sync so the UI-preferred value is honoured.
    expect(useSettings.getState().maxQueryRows).toBe(1000)
  })

  it('settings store allows custom maxQueryRows values', () => {
    const prev = useSettings.getState().maxQueryRows
    useSettings.setState({ maxQueryRows: 5000 })
    expect(useSettings.getState().maxQueryRows).toBe(5000)
    // Restore
    useSettings.setState({ maxQueryRows: prev })
  })
})

describe('engine-aware explain sql', () => {
  it('builds postgres explain wrapper', () => {
    expect(buildExplainSql('postgres', 'select 1')).toContain('EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)')
  })

  it('builds mysql explain wrapper', () => {
    expect(buildExplainSql('mysql', 'select 1')).toContain('EXPLAIN FORMAT=TRADITIONAL')
  })

  it('builds sqlite explain wrapper', () => {
    expect(buildExplainSql('sqlite', 'select 1')).toContain('EXPLAIN QUERY PLAN')
  })
})

describe('transactional result mutations', () => {
  it('wraps postgres edits in an explicit transaction', () => {
    expect(buildTransactionalSql('postgres', ['UPDATE "t" SET "a" = 1;'])).toBe(
      'BEGIN;\nUPDATE "t" SET "a" = 1;\nCOMMIT;',
    )
  })

  it('runs mysql edits without begin or commit', () => {
    expect(buildTransactionalSql('mysql', ['UPDATE `t` SET `a` = 1;'])).toBe(
      'UPDATE `t` SET `a` = 1;',
    )
  })
})
