/** Escape a PostgreSQL identifier for double-quoted DDL. */
export function quoteIdent(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`
}
