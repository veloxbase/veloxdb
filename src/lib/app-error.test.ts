import {
  classifyMessage,
  normalizeError,
  toUserMessage,
} from '@/lib/app-error'
import { describe, expect, it } from 'vitest'

describe('adapter decode error normalization', () => {
  it('classifies MySQL decode mismatch as query error', () => {
    const message =
      "MySQL decode error in get_tables at column 'table_schema' (index 0): mismatched types"
    expect(classifyMessage(message)).toBe('query')
    expect(normalizeError(message).category).toBe('query')
  })

  it('classifies SQLite decode mismatch as query error', () => {
    const message =
      "SQLite decode error in get_schema at column 'name' (index 0): unsupported value type"
    expect(classifyMessage(message)).toBe('query')
    expect(normalizeError(message).category).toBe('query')
  })

  it('classifies MySQL unknown column as query error', () => {
    const message = "Unknown column 'full_name' in 'field list'"
    expect(classifyMessage(message)).toBe('query')
    expect(normalizeError(message).category).toBe('query')
  })

  it('classifies SQLite no such table as query error', () => {
    const message = 'no such table: users'
    expect(classifyMessage(message)).toBe('query')
    expect(normalizeError(message).category).toBe('query')
  })

  it('parses SQLSTATE from VeloxDB postgres formatter', () => {
    const message = 'ERROR: relation "users" does not exist\nSQLSTATE: 42P01'
    expect(normalizeError(message).code).toBe('42P01')
  })

  it('skips generic query hint for server-formatted postgres errors', () => {
    const message =
      'ERROR: syntax error at or near "SELCT"\nSQLSTATE: 42601\nLINE 1: SELECT SELCT'
    const userMessage = toUserMessage({
      category: 'query',
      message,
    })
    expect(userMessage).toBe(message)
    expect(userMessage).not.toContain('Review the SQL')
  })
})
