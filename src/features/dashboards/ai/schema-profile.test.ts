import { describe, expect, it } from 'vitest'

import type { ForeignKeyEdge, QueryEditorMetadata } from '@/data/types'
import { buildSchemaProfile, renderProfileForSql, renderSchemaProfile } from './schema-profile'

const metadata: QueryEditorMetadata = {
  tables: [
    {
      schema: 'public',
      name: 'orders',
      estimatedRows: 1_200_000,
      comment: 'Customer orders',
      columns: [
        { name: 'id', dataType: 'bigint', isPrimaryKey: true },
        { name: 'customer_id', dataType: 'bigint' },
        { name: 'status', dataType: 'order_status' },
        { name: 'total_amount', dataType: 'numeric' },
        { name: 'quantity', dataType: 'integer' },
        { name: 'created_at', dataType: 'timestamp with time zone' },
      ],
    },
    {
      schema: 'public',
      name: 'customers',
      estimatedRows: 40_000,
      columns: [
        { name: 'id', dataType: 'bigint', isPrimaryKey: true },
        { name: 'name', dataType: 'text' },
        { name: 'country', dataType: 'text' },
        { name: 'plan', dataType: 'text' },
      ],
    },
    {
      schema: 'public',
      name: 'schema_migrations',
      estimatedRows: 40,
      columns: [{ name: 'version', dataType: 'text' }],
    },
  ],
  functions: [],
  enums: [{ name: 'public.order_status', values: ['pending', 'paid', 'refunded'] }],
  truncatedTables: false,
  truncatedColumns: false,
  truncatedFunctions: false,
}

const foreignKeys: ForeignKeyEdge[] = [
  { fromSchema: 'public', fromTable: 'orders', fromColumn: 'customer_id', toSchema: 'public', toTable: 'customers', toColumn: 'id' },
]

describe('buildSchemaProfile', () => {
  it('ranks facts first, then reachable dimensions, and drops junk tables', () => {
    const profile = buildSchemaProfile(metadata, foreignKeys)
    expect(profile.tables.map((t) => t.name)).toEqual(['orders', 'customers'])
    expect(profile.tables[0]?.role).toBe('fact')
    expect(profile.tables[1]?.role).toBe('dimension')
  })

  it('detects the time column, measures with kinds, and enum dimensions', () => {
    const profile = buildSchemaProfile(metadata, foreignKeys)
    const orders = profile.tables[0]!
    expect(orders.timeColumn).toBe('created_at')
    expect(orders.measures).toEqual([
      { name: 'total_amount', dataType: 'numeric', kind: 'money' },
      { name: 'quantity', dataType: 'integer', kind: 'count' },
    ])
    expect(orders.dimensions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'customer_id', refersTo: 'customers' }),
        expect.objectContaining({ name: 'status', values: ['pending', 'paid', 'refunded'] }),
      ]),
    )
    expect(orders.joins).toEqual([{ fromColumn: 'customer_id', toTable: 'customers', toColumn: 'id' }])
    expect(profile.primaryTimeColumn).toEqual({ table: 'orders', column: 'created_at' })
  })

  it('caps the number of tables and flags truncation', () => {
    const many: QueryEditorMetadata = {
      ...metadata,
      tables: Array.from({ length: 60 }, (_, i) => ({
        schema: 'public',
        name: `fact_${i}`,
        estimatedRows: 1000 + i,
        columns: [
          { name: 'id', dataType: 'bigint' },
          { name: 'amount', dataType: 'numeric' },
          { name: 'created_at', dataType: 'timestamp' },
        ],
      })),
    }
    const profile = buildSchemaProfile(many, [], null, { maxTables: 10 })
    expect(profile.tables).toHaveLength(10)
    expect(profile.truncated).toBe(true)
    // Highest estimated rows first.
    expect(profile.tables[0]?.name).toBe('fact_59')
  })

  it('boosts the focus table to the top', () => {
    const profile = buildSchemaProfile(metadata, foreignKeys, { schema: 'public', name: 'customers', previewQuery: '' })
    expect(profile.tables[0]?.name).toBe('customers')
  })
})

describe('renderSchemaProfile', () => {
  it('produces a compact prompt block with roles, rows, joins, and enums', () => {
    const text = renderSchemaProfile(buildSchemaProfile(metadata, foreignKeys))
    expect(text).toContain('FACT orders ~1.2M rows — Customer orders')
    expect(text).toContain('time: created_at')
    expect(text).toContain('total_amount (money)')
    expect(text).toContain('orders.customer_id = customers.id')
    expect(text).toContain('public.order_status: pending, paid, refunded')
    expect(text).toContain('Primary time column: orders.created_at')
  })

  it('narrows to the tables referenced by a SQL statement', () => {
    const profile = buildSchemaProfile(metadata, foreignKeys)
    const text = renderProfileForSql(profile, 'SELECT country, count(*) FROM customers GROUP BY 1')
    expect(text).toContain('customers')
    expect(text).not.toContain('FACT orders')
  })
})
