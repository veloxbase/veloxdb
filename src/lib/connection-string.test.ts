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

  it('parses mariadb uri as mysql engine', () => {
    const parsed = parseConnectionString('mysql://root:pw@localhost:3306/app')
    expect(parsed).not.toBeNull()
    expect(parsed?.engine).toBe('mysql')
    expect(parsed?.port).toBe(3306)
    expect(parsed?.database).toBe('app')
  })

  it('builds postgresql uri from fields', () => {
    const value = buildConnectionString({
      engine: 'postgres',
      host: 'db.example.com',
      port: 5432,
      database: 'mydb',
      user: 'admin',
      password: 's3cret',
      sslMode: 'require',
    })
    expect(value).toContain('postgresql://')
    expect(value).toContain('admin:s3cret@db.example.com:5432/mydb')
    expect(value).toContain('sslmode=require')
  })

  it('builds mysql uri from fields', () => {
    const value = buildConnectionString({
      engine: 'mysql',
      host: '127.0.0.1',
      port: 3306,
      database: 'production',
      user: 'deploy',
      password: 'pw',
      sslMode: 'require',
    })
    expect(value).toContain('mysql://')
    expect(value).toContain('deploy:pw@127.0.0.1:3306/production')
  })

  it('roundtrip postgres require ssl', () => {
    const input = {
      engine: 'postgres' as const,
      host: 'pg.example.com',
      port: 5432,
      database: 'analytics',
      user: 'reader',
      password: 'readonly',
      sslMode: 'require' as const,
    }
    const built = buildConnectionString(input)
    const parsed = parseConnectionString(built)
    expect(parsed).not.toBeNull()
    expect(parsed?.engine).toBe('postgres')
    expect(parsed?.sslMode).toBe('require')
    expect(parsed?.database).toBe('analytics')
    expect(parsed?.user).toBe('reader')
    expect(parsed?.password).toBe('readonly')
  })

  it('roundtrip mysql prefer ssl', () => {
    const input = {
      engine: 'mysql' as const,
      host: 'mysql.example.com',
      port: 3306,
      database: 'shop',
      user: 'app',
      password: 'apppw',
      sslMode: 'prefer' as const,
    }
    const built = buildConnectionString(input)
    const parsed = parseConnectionString(built)
    expect(parsed).not.toBeNull()
    expect(parsed?.engine).toBe('mysql')
    expect(parsed?.sslMode).toBe('prefer')
    expect(parsed?.database).toBe('shop')
  })

  it('roundtrip sqlite', () => {
    const input = {
      engine: 'sqlite' as const,
      host: '',
      port: 0,
      database: '',
      filePath: '/data/cache.db',
      user: '',
      password: '',
      sslMode: 'disable' as const,
    }
    const built = buildConnectionString(input)
    const parsed = parseConnectionString(built)
    expect(parsed).not.toBeNull()
    expect(parsed?.engine).toBe('sqlite')
    expect(parsed?.filePath).toBe('/data/cache.db')
  })

  it('parses mongodb uri', () => {
    const parsed = parseConnectionString('mongodb://localhost:27017/admin')
    expect(parsed).not.toBeNull()
    expect(parsed?.engine).toBe('mongo')
    expect(parsed?.port).toBe(27017)
    expect(parsed?.database).toBe('admin')
  })

  it('parses mongodb uri with auth', () => {
    const parsed = parseConnectionString('mongodb://admin:secret@db.example.com:27017/mydb')
    expect(parsed).not.toBeNull()
    expect(parsed?.engine).toBe('mongo')
    expect(parsed?.user).toBe('admin')
    expect(parsed?.password).toBe('secret')
    expect(parsed?.database).toBe('mydb')
  })

  it('builds mongodb uri from fields', () => {
    const value = buildConnectionString({
      engine: 'mongo',
      host: 'mongo.example.com',
      port: 27017,
      database: 'analytics',
      user: 'root',
      password: 'pw',
      sslMode: 'disable',
    })
    expect(value).toContain('mongodb://')
    expect(value).toContain('root:pw@mongo.example.com:27017/analytics')
  })

  it('builds mongodb uri without auth', () => {
    const value = buildConnectionString({
      engine: 'mongo',
      host: 'localhost',
      port: 27017,
      database: 'test',
      user: '',
      password: '',
      sslMode: 'disable',
    })
    expect(value).toBe('mongodb://localhost:27017/test')
  })
})
