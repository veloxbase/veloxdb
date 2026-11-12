import { describe, expect, it } from 'vitest'

import type { QueryEditorMetadata } from '@/data/types'
import {
  buildDashboardVariables,
  defaultVariableValues,
  dimensionPlaceholders,
  distinctValuesSql,
  renderVariableInstructions,
} from './auto-variables'
import { buildSchemaProfile } from './schema-profile'

const metadata: QueryEditorMetadata = {
  tables: [
    {
      schema: 'public',
      name: 'orders',
      estimatedRows: 5000,
      columns: [
        { name: 'id', dataType: 'bigint', isPrimaryKey: true },
        { name: 'customer_id', dataType: 'bigint' },
        { name: 'status', dataType: 'order_status' },
        { name: 'region', dataType: 'text' },
        { name: 'total_amount', dataType: 'numeric' },
        { name: 'created_at', dataType: 'timestamp' },
      ],
    },
  ],
  functions: [],
  enums: [{ name: 'order_status', values: ['paid', 'refunded'] }],
  truncatedTables: false,
  truncatedColumns: false,
  truncatedFunctions: false,
}

const profile = buildSchemaProfile(metadata, [
  { fromSchema: 'public', fromTable: 'orders', fromColumn: 'customer_id', toSchema: 'public', toTable: 'customers', toColumn: 'id' },
])

describe('auto variables', () => {
  it('derives dimension placeholders from non-FK fact dimensions', () => {
    const placeholders = dimensionPlaceholders(profile)
    expect(placeholders.map((p) => p.name)).toEqual(['status', 'region'])
    expect(placeholders[0]?.values).toEqual(['paid', 'refunded'])
  })

  it('builds default values with a date window and empty dimension filters', () => {
    const defaults = defaultVariableValues(dimensionPlaceholders(profile), new Date('2024-06-15T12:00:00Z'))
    expect(defaults.date_to).toBe('2024-06-16')
    expect(defaults.date_from).toBe('2023-06-16')
    expect(defaults.status).toBe('')
  })

  it('renders prompt instructions mentioning the time window and dimension pattern', () => {
    const text = renderVariableInstructions(profile, dimensionPlaceholders(profile))
    expect(text).toContain('{{date_from}}')
    expect(text).toContain("'{{status}}' = ''")
  })

  it('emits only the variables the queries actually use', () => {
    const placeholders = dimensionPlaceholders(profile)
    const defaults = defaultVariableValues(placeholders, new Date('2024-06-15T12:00:00Z'))
    const variables = buildDashboardVariables(['date_from', 'date_to', 'region'], placeholders, { region: ['EU', 'US'] }, defaults)
    expect(variables.map((v) => [v.name, v.type])).toEqual([
      ['date_from', 'date'],
      ['date_to', 'date'],
      ['region', 'select'],
    ])
    expect(variables[2]?.options).toEqual(['EU', 'US'])
    expect(variables[2]?.defaultValue).toBe('')
  })

  it('uses TOP for T-SQL samplers', () => {
    expect(distinctValuesSql('orders', 'region', 'Microsoft SQL Server (T-SQL)', 5)).toContain('TOP 5')
    expect(distinctValuesSql('orders', 'region', 'PostgreSQL', 5)).toContain('LIMIT 5')
  })
})
