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

  it('parses neon pooled uri and keeps client-side params as extraParams', () => {
    const parsed = parseConnectionString(
      'postgresql://neondb_owner:pw@ep-cool-name-123-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
    )
    expect(parsed).not.toBeNull()
    expect(parsed?.engine).toBe('postgres')
    expect(parsed?.host).toBe('ep-cool-name-123-pooler.us-east-1.aws.neon.tech')
    expect(parsed?.port).toBe(5432)
    expect(parsed?.database).toBe('neondb')
    expect(parsed?.user).toBe('neondb_owner')
    expect(parsed?.password).toBe('pw')
    expect(parsed?.sslMode).toBe('require')
    // channel_binding is a libpq client-side parameter; the backend maps it
    // instead of forwarding it as a server startup option (which Neon poolers reject).
    expect(parsed?.extraParams).toEqual({ channel_binding: 'require' })
  })

  it('parses neon direct uri (no channel_binding) as ssl require', () => {
    const parsed = parseConnectionString(
      'postgresql://neondb_owner:pw@ep-cool-name-123.us-east-1.aws.neon.tech/neondb?sslmode=require',
    )
    expect(parsed).not.toBeNull()
    expect(parsed?.host).toBe('ep-cool-name-123.us-east-1.aws.neon.tech')
    expect(parsed?.port).toBe(5432)
    expect(parsed?.sslMode).toBe('require')
    expect(parsed?.extraParams).toEqual({})
  })

  it('decodes neon pooled uri with connect_timeout and options=endpoint payload', () => {
    // URL-encoded `options=endpoint%3Dep-...` must be decoded to
    // `options=endpoint=ep-...` for the backend to pass through verbatim.
    const parsed = parseConnectionString(
      'postgresql://neondb_owner:pw@ep-cool-name-123-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require&connect_timeout=10&options=endpoint%3Dep-cool-name-123',
    )
    expect(parsed).not.toBeNull()
    expect(parsed?.extraParams).toEqual({
      channel_binding: 'require',
      connect_timeout: '10',
      options: 'endpoint=ep-cool-name-123',
    })
    expect(parsed?.sslMode).toBe('require')
    expect(parsed?.port).toBe(5432)
  })

  it('round-trips neon extra params through buildConnectionString', () => {
    const built = buildConnectionString({
      engine: 'postgres',
      user: 'neondb_owner',
      password: 'pw',
      host: 'ep-cool-name-123-pooler.us-east-1.aws.neon.tech',
      port: 5432,
      database: 'neondb',
      sslMode: 'require',
      extraParams: { channel_binding: 'require' },
    })
    const parsed = parseConnectionString(built)
    expect(parsed?.sslMode).toBe('require')
    expect(parsed?.extraParams).toEqual({ channel_binding: 'require' })
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

  it('parses and builds clickhouse uri', () => {
    const parsed = parseConnectionString('clickhouse://default:password@localhost:8123/analytics')
    expect(parsed?.engine).toBe('clickhouse')
    expect(parsed?.host).toBe('localhost')
    expect(parsed?.port).toBe(8123)
    expect(parsed?.database).toBe('analytics')
    expect(parsed?.user).toBe('default')
    expect(parsed?.password).toBe('password')

    const built = buildConnectionString({
      engine: 'clickhouse',
      host: 'localhost',
      port: 8123,
      database: 'analytics',
      user: 'default',
      password: 'password',
      sslMode: 'prefer',
    })
    expect(built).toBe('clickhouse://default:password@localhost:8123/analytics')
  })

  it('parses and builds turso / libsql uri', () => {
    const parsed = parseConnectionString('turso://my-db.turso.io?authToken=my-token')
    expect(parsed?.engine).toBe('turso')
    expect(parsed?.host).toBe('my-db.turso.io')
    expect(parsed?.password).toBe('my-token')

    const built = buildConnectionString({
      engine: 'turso',
      host: 'my-db.turso.io',
      port: 443,
      database: '',
      user: '',
      password: 'my-token',
      sslMode: 'require',
    })
    expect(built).toBe('turso://my-db.turso.io?authToken=my-token')
  })

  it('parses and builds cassandra / scylladb uri', () => {
    const parsed = parseConnectionString('cassandra://cassandra:pass@127.0.0.1:9042/my_keyspace')
    expect(parsed?.engine).toBe('cassandra')
    expect(parsed?.host).toBe('127.0.0.1')
    expect(parsed?.port).toBe(9042)
    expect(parsed?.database).toBe('my_keyspace')

    const built = buildConnectionString({
      engine: 'scylladb',
      host: '127.0.0.1',
      port: 9042,
      database: 'my_keyspace',
      user: 'scylla',
      password: 'pass',
      sslMode: 'prefer',
    })
    expect(built).toBe('scylladb://scylla:pass@127.0.0.1:9042/my_keyspace')
  })

  it('parses and builds mssql / azuresql uri', () => {
    const parsed = parseConnectionString('mssql://sa:StrongPassword123!@localhost:1433/TestDb')
    expect(parsed?.engine).toBe('mssql')
    expect(parsed?.host).toBe('localhost')
    expect(parsed?.port).toBe(1433)
    expect(parsed?.database).toBe('TestDb')
    expect(parsed?.user).toBe('sa')
    expect(parsed?.password).toBe('StrongPassword123!')

    const azureParsed = parseConnectionString('azuresql://myuser:pw@server.database.windows.net:1433/sqldb')
    expect(azureParsed?.engine).toBe('azuresql')
    expect(azureParsed?.sslMode).toBe('require')

    const built = buildConnectionString({
      engine: 'mssql',
      host: 'localhost',
      port: 1433,
      database: 'TestDb',
      user: 'sa',
      password: 'StrongPassword123!',
      sslMode: 'prefer',
    })
    expect(built).toBe('mssql://sa:StrongPassword123!@localhost:1433/TestDb')
  })

  it('parses and builds duckdb uri', () => {
    const parsed = parseConnectionString('duckdb:///tmp/data.duckdb')
    expect(parsed?.engine).toBe('duckdb')
    expect(parsed?.filePath).toBe('/tmp/data.duckdb')

    const built = buildConnectionString({
      engine: 'duckdb',
      host: '',
      port: 0,
      database: '',
      filePath: '/tmp/data.duckdb',
      user: '',
      password: '',
      sslMode: 'disable',
    })
    expect(built).toBe('duckdb:///tmp/data.duckdb')
  })
})
