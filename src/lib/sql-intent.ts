/**
 * Mirrors the Rust `classify_sql_intent` / `is_read_only_sql` in
 * `src-tauri/src/commands.rs`. Keep the two in sync: the backend enforces the
 * guard, this module powers the confirmation prompt before we send the query.
 */

export type SqlIntent =
  | 'select'
  | 'insert'
  | 'update'
  | 'delete'
  | 'explain'
  | 'unknown'

export function classifySqlIntent(sql: string): SqlIntent {
  const normalized = sql.trimStart().toLowerCase()
  if (normalized.startsWith('select') || normalized.startsWith('with')) return 'select'
  if (normalized.startsWith('insert')) return 'insert'
  if (normalized.startsWith('update')) return 'update'
  if (normalized.startsWith('delete')) return 'delete'
  if (normalized.startsWith('explain')) return 'explain'
  return 'unknown'
}

const TRANSACTION_CONTROL = ['begin', 'commit', 'rollback', 'start', 'savepoint', 'release']

/** True when every statement in `sql` is read-only (select/explain). */
export function isReadOnlySql(sql: string, engine?: string): boolean {
  if (engine === "mongo") return true; // MongoDB find() queries are always read-only
  if (engine === "redis") return true; // Redis commands treated as read-only for now
  let sawStatement = false
  for (const raw of sql.split(';')) {
    const statement = raw.trim()
    if (!statement) continue
    const normalized = statement.toLowerCase()
    if (TRANSACTION_CONTROL.some((kw) => normalized.startsWith(kw))) continue
    sawStatement = true
    const intent = classifySqlIntent(statement)
    if (intent !== 'select' && intent !== 'explain') return false
  }
  return sawStatement
}
