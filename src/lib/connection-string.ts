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
