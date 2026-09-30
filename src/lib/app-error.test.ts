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

  it('classifies deadpool/postgres connect errors as connection errors', () => {
    expect(
      classifyMessage(
        'Error occurred while creating a new object: error connecting to server: Connection refused (os error 10061)',
      ),
    ).toBe('connection')
    expect(
      classifyMessage(
        'Error occurred while creating a new object: error connecting to server: db error: FATAL: unsupported startup parameter: channel_binding',
      ),
    ).toBe('connection')
    expect(
      classifyMessage(
        'Timed out while establishing the connection. The server may be starting up',
      ),
    ).toBe('connection')
    expect(
      classifyMessage(
        'error connecting to server: timed out waiting for connection',
      ),
    ).toBe('connection')
  })

  it('appends the connection hint for terse connect errors', () => {
    const userMessage = toUserMessage(
      normalizeError(
        'Error occurred while creating a new object: error connecting to server',
      ),
    )
    expect(userMessage).toContain('error connecting to server')
    expect(userMessage).toContain('Check host, port, database name')
  })
})
