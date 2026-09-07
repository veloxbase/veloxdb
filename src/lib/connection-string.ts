import type { ConnectionSslMode, DatabaseEngine } from '@/data/types'

export type ParsedConnectionString = {
  engine: DatabaseEngine
  host: string
  port: number
  database: string
  filePath?: string
  user: string
  password: string
  sslMode: ConnectionSslMode
  extraParams: Record<string, string>
}

const DEFAULT_PG_PORT = 5432
const SSL_MODE_KEY = 'sslmode'
const MYSQL_SSL_MODE_KEY = 'ssl-mode'

const VALID_SSL_MODES: Set<string> = new Set(['disable', 'prefer', 'require'])

const MYSQL_SSL_MODE_FROM_PARAM: Record<string, ConnectionSslMode> = {
  disabled: 'disable',
  preferred: 'prefer',
  required: 'require',
}

const MYSQL_SSL_MODE_TO_PARAM: Record<ConnectionSslMode, string> = {
  disable: 'DISABLED',
  prefer: 'PREFERRED',
  require: 'REQUIRED',
}

function normalizeUrl(raw: string): string {
  return raw.trim()
}

/**
 * Parses supported connection URIs like:
 *   postgresql://user:password@host:5432/dbname?sslmode=require
 *   mysql://user:password@host:3306/dbname
 *   sqlite:///absolute/path/to/file.db
 *
 * Falls back gracefully — unknown/unsupported params go into extraParams.
 */
export function parseConnectionString(raw: string): ParsedConnectionString | null {
  const trimmed = raw.trim()

  // MongoDB URIs
  if (trimmed.startsWith('mongodb://') || trimmed.startsWith('mongodb+srv://')) {
    const url = new URL(trimmed)
    return {
      engine: 'mongo',
      host: decodeURIComponent(url.hostname || 'localhost'),
      port: url.port ? Number(url.port) : 27017,
      database: decodeURIComponent(url.pathname.replace(/^\//, '') || 'admin'),
      user: decodeURIComponent(url.username || ''),
      password: decodeURIComponent(url.password || ''),
      sslMode: trimmed.startsWith('mongodb+srv') ? 'require' : 'prefer',
      extraParams: Object.fromEntries(new URLSearchParams(url.search)),
    }
  }

  if (trimmed.startsWith('sqlite://')) {
    const path = trimmed.replace(/^sqlite:\/\//, '')
    return {
      engine: 'sqlite',
      host: '',
      port: 0,
      database: path || ':memory:',
      filePath: path || ':memory:',
      user: '',
      password: '',
      sslMode: 'disable',
      extraParams: {},
    }
  }

  if (trimmed.startsWith('duckdb://')) {
    const path = trimmed.replace(/^duckdb:\/\//, '')
    return {
      engine: 'duckdb',
      host: '',
      port: 0,
      database: path || ':memory:',
      filePath: path || ':memory:',
      user: '',
      password: '',
      sslMode: 'disable',
      extraParams: {},
    }
  }

  if (trimmed.startsWith('clickhouse://') || trimmed.startsWith('clickhouses://')) {
    const isSecure = trimmed.startsWith('clickhouses://')
    const url = new URL(trimmed)
    return {
      engine: 'clickhouse',
      host: decodeURIComponent(url.hostname || 'localhost'),
      port: url.port ? Number(url.port) : (isSecure ? 8443 : 8123),
      database: decodeURIComponent(url.pathname.replace(/^\//, '') || 'default'),
      user: decodeURIComponent(url.username || 'default'),
      password: decodeURIComponent(url.password || ''),
      sslMode: isSecure ? 'require' : 'prefer',
      extraParams: Object.fromEntries(new URLSearchParams(url.search)),
    }
  }

  if (trimmed.startsWith('libsql://') || trimmed.startsWith('turso://')) {
    const isTurso = trimmed.startsWith('turso://') || trimmed.includes('.turso.io')
    const url = new URL(trimmed)
    const searchParams = Object.fromEntries(new URLSearchParams(url.search))
    return {
      engine: isTurso ? 'turso' : 'libsql',
      host: decodeURIComponent(url.hostname || ''),
      port: url.port ? Number(url.port) : 443,
      database: decodeURIComponent(url.pathname.replace(/^\//, '') || ''),
      user: decodeURIComponent(url.username || ''),
      password: decodeURIComponent(url.password || searchParams.authToken || ''),
      sslMode: 'require',
      extraParams: searchParams,
    }
  }

  if (trimmed.startsWith('cassandra://') || trimmed.startsWith('scylladb://') || trimmed.startsWith('cql://')) {
    const isScylla = trimmed.startsWith('scylladb://')
    const url = new URL(trimmed)
    return {
      engine: isScylla ? 'scylladb' : 'cassandra',
      host: decodeURIComponent(url.hostname || '127.0.0.1'),
      port: url.port ? Number(url.port) : 9042,
      database: decodeURIComponent(url.pathname.replace(/^\//, '') || ''),
      user: decodeURIComponent(url.username || ''),
      password: decodeURIComponent(url.password || ''),
      sslMode: 'prefer',
      extraParams: Object.fromEntries(new URLSearchParams(url.search)),
    }
  }

  if (trimmed.startsWith('mssql://') || trimmed.startsWith('sqlserver://') || trimmed.startsWith('azuresql://')) {
    const isAzure = trimmed.startsWith('azuresql://') || trimmed.includes('.database.windows.net')
    const url = new URL(trimmed)
    return {
      engine: isAzure ? 'azuresql' : 'mssql',
      host: decodeURIComponent(url.hostname || '127.0.0.1'),
      port: url.port ? Number(url.port) : 1433,
      database: decodeURIComponent(url.pathname.replace(/^\//, '') || 'master'),
      user: decodeURIComponent(url.username || 'sa'),
      password: decodeURIComponent(url.password || ''),
      sslMode: isAzure ? 'require' : 'prefer',
      extraParams: Object.fromEntries(new URLSearchParams(url.search)),
    }
  }

  if (trimmed.startsWith('redis://') || trimmed.startsWith('rediss://')) {
    const url = new URL(trimmed)
    return {
      engine: 'redis',
      host: decodeURIComponent(url.hostname || '127.0.0.1'),
      port: url.port ? Number(url.port) : 6379,
      database: decodeURIComponent(url.pathname.replace(/^\//, '') || '0'),
      user: decodeURIComponent(url.username || ''),
      password: decodeURIComponent(url.password || ''),
      sslMode: trimmed.startsWith('rediss://') ? 'require' : 'disable',
      extraParams: Object.fromEntries(new URLSearchParams(url.search)),
    }
  }

  const normalized = normalizeUrl(raw)
  if (!normalized.includes('://')) {
    // Require explicit scheme to avoid silently coercing non-Postgres input.
    return null
  }

  let url: URL
  try {
    url = new URL(normalized)
  } catch {
    return null
  }

  const protocol = url.protocol.replace(':', '')
  const engine: DatabaseEngine = protocol.startsWith('mysql') ? 'mysql' : 'postgres'

  const host = decodeURIComponent(url.hostname || '127.0.0.1')
  const defaultPort = engine === 'mysql' ? 3306 : DEFAULT_PG_PORT
  const port = url.port ? Number(url.port) : defaultPort
  const database = decodeURIComponent(url.pathname.replace(/^\//, '') || (engine === 'mysql' ? '' : 'postgres'))
  const user = decodeURIComponent(url.username || (engine === 'mysql' ? '' : 'postgres'))
  const password = decodeURIComponent(url.password || '')

  const params = new URLSearchParams(url.search)
  let sslMode: ConnectionSslMode = 'prefer'

  if (params.has(SSL_MODE_KEY)) {
    const rawMode = (params.get(SSL_MODE_KEY) ?? '').toLowerCase()
    if (VALID_SSL_MODES.has(rawMode)) {
      sslMode = rawMode as ConnectionSslMode
    }
    params.delete(SSL_MODE_KEY)
  }

  if (engine === 'mysql' && params.has(MYSQL_SSL_MODE_KEY)) {
    const rawMode = (params.get(MYSQL_SSL_MODE_KEY) ?? '').toLowerCase()
    if (rawMode in MYSQL_SSL_MODE_FROM_PARAM) {
      sslMode = MYSQL_SSL_MODE_FROM_PARAM[rawMode]
    }
    params.delete(MYSQL_SSL_MODE_KEY)
  }

  const extraParams: Record<string, string> = {}
  params.forEach((value, key) => {
    extraParams[key] = value
  })

  return { engine, host, port, database, user, password, sslMode, extraParams }
}

/** Builds a connection URI from individual fields. */
export function buildConnectionString(fields: {
  engine: DatabaseEngine
  user: string
  password: string
  host: string
  port: number
  database: string
  filePath?: string
  sslMode: ConnectionSslMode
  srvEnabled?: boolean
  extraParams?: Record<string, string>
}): string {
  if (fields.engine === 'mongo') {
    const encodedUser = fields.user ? encodeURIComponent(fields.user) : ''
    const encodedPassword = fields.password ? `:${encodeURIComponent(fields.password)}` : ''
    const auth = encodedUser ? `${encodedUser}${encodedPassword}@` : ''
    const scheme = fields.srvEnabled ? 'mongodb+srv' : 'mongodb'
    let uri = fields.srvEnabled
      ? `${scheme}://${auth}${fields.host || 'localhost'}/${encodeURIComponent(fields.database || 'admin')}`
      : `${scheme}://${auth}${fields.host || 'localhost'}:${fields.port || 27017}/${encodeURIComponent(fields.database || 'admin')}`
    if (fields.extraParams && Object.keys(fields.extraParams).length > 0) {
      const params = new URLSearchParams(fields.extraParams).toString()
      uri += `?${params}`
    }
    return uri
  }

  if (fields.engine === 'redis') {
    const encodedUser = fields.user ? encodeURIComponent(fields.user) : ''
    const encodedPassword = fields.password ? `:${encodeURIComponent(fields.password)}` : ''
    const auth = encodedUser ? `${encodedUser}${encodedPassword}@` : ''
    return `redis://${auth}${fields.host || '127.0.0.1'}:${fields.port || 6379}/${encodeURIComponent(fields.database || '0')}`
  }

  if (fields.engine === 'duckdb') {
    const path = fields.filePath || fields.database || ':memory:'
    return `duckdb://${path}`
  }

  if (fields.engine === 'clickhouse') {
    const encodedUser = fields.user ? encodeURIComponent(fields.user) : 'default'
    const encodedPassword = fields.password ? `:${encodeURIComponent(fields.password)}` : ''
    const auth = `${encodedUser}${encodedPassword}@`
    const scheme = fields.sslMode === 'require' ? 'clickhouses' : 'clickhouse'
    const db = fields.database ? encodeURIComponent(fields.database) : 'default'
    let uri = `${scheme}://${auth}${fields.host || 'localhost'}:${fields.port || 8123}/${db}`
    if (fields.extraParams && Object.keys(fields.extraParams).length > 0) {
      uri += `?${new URLSearchParams(fields.extraParams).toString()}`
    }
    return uri
  }

  if (fields.engine === 'libsql' || fields.engine === 'turso') {
    const scheme = fields.engine === 'turso' ? 'turso' : 'libsql'
    const host = fields.host || ''
    const db = fields.database ? `/${encodeURIComponent(fields.database)}` : ''
    const params = new URLSearchParams(fields.extraParams ?? {})
    if (fields.password) {
      params.set('authToken', fields.password)
    }
    const qs = params.toString()
    return `${scheme}://${host}${db}${qs ? `?${qs}` : ''}`
  }

  if (fields.engine === 'cassandra' || fields.engine === 'scylladb') {
    const scheme = fields.engine === 'scylladb' ? 'scylladb' : 'cassandra'
    const encodedUser = fields.user ? encodeURIComponent(fields.user) : ''
    const encodedPassword = fields.password ? `:${encodeURIComponent(fields.password)}` : ''
    const auth = encodedUser ? `${encodedUser}${encodedPassword}@` : ''
    const db = fields.database ? `/${encodeURIComponent(fields.database)}` : ''
    return `${scheme}://${auth}${fields.host || '127.0.0.1'}:${fields.port || 9042}${db}`
  }

  if (fields.engine === 'mssql' || fields.engine === 'azuresql') {
    const scheme = fields.engine === 'azuresql' ? 'azuresql' : 'mssql'
    const encodedUser = fields.user ? encodeURIComponent(fields.user) : 'sa'
    const encodedPassword = fields.password ? `:${encodeURIComponent(fields.password)}` : ''
    const auth = `${encodedUser}${encodedPassword}@`
    const db = fields.database ? `/${encodeURIComponent(fields.database)}` : '/master'
    return `${scheme}://${auth}${fields.host || '127.0.0.1'}:${fields.port || 1433}${db}`
  }

  if (fields.engine === 'sqlite') {
    const path = fields.filePath || fields.database || ':memory:'
    return `sqlite://${path}`
  }

  const encodedUser = encodeURIComponent(fields.user)
  const encodedPassword = fields.password ? `:${encodeURIComponent(fields.password)}` : ''
  const encodedHost = fields.host.includes(':') ? `[${fields.host}]` : fields.host

  const scheme = fields.engine === 'mysql' ? 'mysql' : 'postgresql'
  let uri = `${scheme}://${encodedUser}${encodedPassword}@${encodedHost}:${fields.port}/${encodeURIComponent(fields.database)}`

  const params = new URLSearchParams()
  if (fields.engine === 'postgres' && fields.sslMode !== 'prefer') {
    params.set('sslmode', fields.sslMode)
  }
  if (fields.engine === 'mysql' && fields.sslMode !== 'prefer') {
    params.set(MYSQL_SSL_MODE_KEY, MYSQL_SSL_MODE_TO_PARAM[fields.sslMode])
  }
  if (fields.extraParams) {
    for (const [key, value] of Object.entries(fields.extraParams)) {
      params.set(key, value)
    }
  }

  const qs = params.toString()
  if (qs) uri += `?${qs}`

  return uri
}
