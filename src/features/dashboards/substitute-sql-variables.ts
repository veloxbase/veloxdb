/** Replaces `{{varName}}` tokens in SQL with dashboard variable values. */
export function substituteSqlVariables(
  sql: string,
  variables: Record<string, string>,
): string {
  return sql.replace(/\{\{(\w+)\}\}/g, (match, name: string) => {
    if (name in variables) return variables[name]
    return match
  })
}

export function hashVariables(variables: Record<string, string>): string {
  const entries = Object.entries(variables).sort(([a], [b]) => a.localeCompare(b))
  return JSON.stringify(entries)
}
