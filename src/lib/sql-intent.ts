/**
 * Mirrors the Rust `classify_sql_intent` / `is_read_only_sql` in
 * `src-tauri/src/commands/mod.rs`. Keep the two in sync: the backend enforces the
 * guard, this module powers the confirmation prompt before we send the query.
 */

export type SqlIntent =
  | 'select'
  | 'insert'
  | 'update'
  | 'delete'
  | 'explain'
  | 'show'
  | 'describe'
  | 'values'
  | 'table'
  | 'unknown'

export function classifySqlIntent(sql: string): SqlIntent {
  const normalized = sql.trimStart().toLowerCase()
  if (normalized.startsWith('select') || normalized.startsWith('with')) return 'select'
  if (normalized.startsWith('insert')) return 'insert'
  if (normalized.startsWith('update')) return 'update'
  if (normalized.startsWith('delete')) return 'delete'
  if (normalized.startsWith('explain')) return 'explain'
  if (normalized.startsWith('show')) return 'show'
  if (normalized.startsWith('describe') || normalized.startsWith('desc')) return 'describe'
  if (normalized.startsWith('values')) return 'values'
  if (normalized.startsWith('table ')) return 'table'
  return 'unknown'
}

/**
 * Words that make a statement a write wherever they appear, not only at its
 * start. Checking the whole statement catches data-modifying CTEs
 * (`WITH x AS (DELETE ...) SELECT ...`), `SELECT ... INTO`, and T-SQL batches,
 * which run several statements without semicolons
 * (`SELECT 1 DELETE FROM users`). A table, column or string literal that uses
 * one of these words only costs an extra confirmation.
 * Keep in sync with `WRITE_KEYWORDS` in `src-tauri/src/commands/mod.rs`.
 */
const WRITE_KEYWORDS = new Set([
  'insert', 'update', 'delete', 'merge',
  'create', 'alter', 'drop', 'truncate',
  'grant', 'revoke', 'deny', 'copy', 'call', 'do', 'vacuum',
  // SELECT ... INTO creates a table (Postgres, T-SQL) or a file (MySQL INTO OUTFILE).
  'into',
  // T-SQL statements and rowset functions that can follow a SELECT in one batch.
  'exec', 'execute', 'kill', 'shutdown', 'backup', 'restore', 'dbcc', 'bulk',
  'reconfigure', 'openquery', 'openrowset', 'opendatasource',
  // Functions that change data or server state when called from a SELECT.
  'nextval', 'setval', 'set_config', 'pg_notify', 'pg_logical_emit_message',
  'pg_terminate_backend', 'pg_cancel_backend', 'pg_reload_conf', 'pg_rotate_logfile',
  'pg_switch_wal', 'pg_promote', 'pg_create_restore_point',
  'lo_import', 'lo_export', 'lo_unlink', 'lo_create', 'lo_creat', 'lo_from_bytea',
  'lo_put', 'lo_truncate',
  'dblink', 'dblink_exec', 'dblink_connect',
  'pg_file_write', 'pg_file_rename', 'pg_file_unlink',
])

function containsWriteKeyword(sql: string): boolean {
  return sql.toLowerCase().split(/[^a-z0-9_]+/).some((token) => WRITE_KEYWORDS.has(token))
}

const READ_ONLY_INTENTS: ReadonlySet<SqlIntent> = new Set([
  'select', 'explain', 'show', 'describe', 'values', 'table',
])

/**
 * Redis commands that never modify the keyspace. Anything not listed here is
 * treated as a write so the editor asks for confirmation before running it.
 * Keep in sync with `REDIS_READ_ONLY_COMMANDS` in
 * `src-tauri/src/commands/mod.rs`.
 */
const REDIS_READ_ONLY_COMMANDS = new Set([
  'PING', 'ECHO', 'TYPE', 'EXISTS', 'TTL', 'PTTL', 'EXPIRETIME', 'PEXPIRETIME',
  'KEYS', 'SCAN', 'RANDOMKEY', 'DBSIZE',
  'GET', 'MGET', 'GETRANGE', 'STRLEN', 'SUBSTR', 'BITCOUNT', 'BITPOS', 'BITFIELD_RO',
  'HGET', 'HMGET', 'HGETALL', 'HKEYS', 'HVALS', 'HLEN', 'HEXISTS', 'HRANDFIELD', 'HSCAN',
  'LINDEX', 'LRANGE', 'LLEN', 'LPOS',
  'SMEMBERS', 'SCARD', 'SISMEMBER', 'SMISMEMBER', 'SRANDMEMBER', 'SSCAN',
  'ZCARD', 'ZCOUNT', 'ZDIFF', 'ZINTER', 'ZUNION', 'ZINTERCARD', 'ZLEXCOUNT',
  'ZMSCORE', 'ZRANDMEMBER', 'ZRANGE', 'ZRANGEBYLEX', 'ZRANGEBYSCORE', 'ZRANK',
  'ZREVRANGE', 'ZREVRANGEBYLEX', 'ZREVRANGEBYSCORE', 'ZREVRANK', 'ZSCAN', 'ZSCORE',
  'XINFO', 'XLEN', 'XRANGE', 'XREVRANGE', 'XPENDING', 'XREAD',
  'GEODIST', 'GEOHASH', 'GEOPOS', 'GEORADIUS_RO', 'GEORADIUSBYMEMBER_RO', 'GEOSEARCH',
  'PFCOUNT', 'INFO', 'TIME', 'LASTSAVE', 'COMMAND', 'MEMORY', 'OBJECT', 'SORT_RO',
])

/** True when every non-empty line is a read-only Redis command. */
export function isReadOnlyRedisCommand(sql: string): boolean {
  const commands = sql
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
  if (commands.length === 0) return false
  return commands.every((line) => {
    const command = line.split(/\s+/)[0]?.toUpperCase() ?? ''
    return REDIS_READ_ONLY_COMMANDS.has(command)
  })
}

/**
 * True when every statement in `sql` only reads. Queries that pass run without
 * a confirmation, so anything uncertain counts as a write.
 *
 * Statements are split on every `;`, even inside strings: that can only add
 * pieces to check. Transaction control counts as a write, because on Postgres an
 * unconfirmed query runs in a read-only transaction that a `COMMIT` would end.
 */
export function isReadOnlySql(sql: string, engine?: string): boolean {
  // MongoDB queries are read-only in practice: the engine only executes find().
  if (engine === 'mongo') return true
  if (engine === 'redis') return isReadOnlyRedisCommand(sql)
  const statements = sql.split(';').map((raw) => raw.trim()).filter(Boolean)
  if (statements.length === 0) return false
  return statements.every(
    (statement) =>
      !containsWriteKeyword(statement) && READ_ONLY_INTENTS.has(classifySqlIntent(statement)),
  )
}
