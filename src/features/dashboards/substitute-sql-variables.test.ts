import { describe, expect, it } from 'vitest'

import { hashVariables, substituteSqlVariables } from '@/features/dashboards/substitute-sql-variables'

describe('substituteSqlVariables', () => {
  it('replaces known tokens', () => {
    const sql = 'select * from orders where region = {{region}}'
    expect(substituteSqlVariables(sql, { region: 'EMEA' })).toBe(
      "select * from orders where region = EMEA",
    )
  })

  it('leaves unknown tokens unchanged', () => {
    const sql = 'select {{missing}}'
    expect(substituteSqlVariables(sql, {})).toBe('select {{missing}}')
  })
})

describe('hashVariables', () => {
  it('is stable regardless of key order', () => {
    expect(hashVariables({ b: '2', a: '1' })).toBe(hashVariables({ a: '1', b: '2' }))
  })
})
