import { describe, expect, it } from 'vitest'

import { buildConnectionString, parseConnectionString } from '@/lib/connection-string'

describe('connection string parsing and building', () => {
  it('parses postgres uri with ssl mode', () => {
    const parsed = parseConnectionString(
      'postgresql://postgres:secret@localhost:5432/postgres?sslmode=require',
    )
    expect(parsed).not.toBeNull()
    expect(parsed?.engine).toBe('postgres')
    expect(parsed?.sslMode).toBe('require')
  })

  it('parses mysql uri', () => {
    const parsed = parseConnectionString('mysql://root:pw@127.0.0.1:3306/app_db')
    expect(parsed).not.toBeNull()
    expect(parsed?.engine).toBe('mysql')
    expect(parsed?.port).toBe(3306)
  })

  it('parses mysql ssl-mode and builds it back', () => {
    const parsed = parseConnectionString(
      'mysql://root:pw@127.0.0.1:3306/app_db?ssl-mode=REQUIRED',
    )
    expect(parsed?.sslMode).toBe('require')

    const value = buildConnectionString({
      engine: 'mysql',
      host: '127.0.0.1',
      port: 3306,
      database: 'app_db',
      user: 'root',
      password: 'pw',
      sslMode: 'require',
    })
    expect(value).toContain('ssl-mode=REQUIRED')
  })

  it('parses sqlite uri', () => {
    const parsed = parseConnectionString('sqlite:///tmp/velox.db')
    expect(parsed).not.toBeNull()
    expect(parsed?.engine).toBe('sqlite')
    expect(parsed?.filePath).toBe('/tmp/velox.db')
  })

  it('requires explicit URI scheme', () => {
    const parsed = parseConnectionString('postgres:secret@localhost:5432/postgres')
    expect(parsed).toBeNull()
  })

  it('builds sqlite uri from file path', () => {
    const value = buildConnectionString({
      engine: 'sqlite',
      host: '',
      port: 0,
      database: '',
      filePath: '/tmp/demo.db',
      user: '',
      password: '',
      sslMode: 'disable',
    })
    expect(value).toBe('sqlite:///tmp/demo.db')
  })
})
