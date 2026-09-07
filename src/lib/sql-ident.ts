import type { DatabaseEngine } from '@/data/types'

/** Escape an identifier based on SQL engine conventions. */
export function quoteIdent(ident: string, engine: DatabaseEngine = 'postgres'): string {
  if (engine === 'mysql' || engine === 'clickhouse') {
    return `\`${ident.replace(/`/g, '``')}\``
  }
  if (engine === 'mssql' || engine === 'azuresql') {
    return `[${ident.replace(/]/g, ']]')}]`
  }
  return `"${ident.replace(/"/g, '""')}"`
}
