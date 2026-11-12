import type { DashboardVariable } from '@/data/types'
import type { SchemaProfile } from './schema-profile'

export const DATE_FROM_VAR = 'date_from'
export const DATE_TO_VAR = 'date_to'
export const DEFAULT_RANGE_DAYS = 365
export const MAX_SELECT_OPTIONS = 50
const MAX_DIMENSION_PLACEHOLDERS = 6

export type DimensionPlaceholder = {
  name: string
  table: string
  column: string
  values?: string[]
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** Placeholder dimensions the model may filter on: low-cardinality, non-FK columns of the top fact tables. */
export function dimensionPlaceholders(profile: SchemaProfile | null): DimensionPlaceholder[] {
  if (!profile) return []
  const seen = new Set<string>()
  const out: DimensionPlaceholder[] = []
  for (const table of profile.tables) {
    if (table.role !== 'fact') continue
    for (const dim of table.dimensions) {
      if (dim.refersTo) continue
      const name = dim.name.replace(/\W+/g, '_').toLowerCase()
      if (name === DATE_FROM_VAR || name === DATE_TO_VAR || seen.has(name)) continue
      seen.add(name)
      out.push({ name, table: table.qualifiedName, column: dim.name, values: dim.values })
      if (out.length >= MAX_DIMENSION_PLACEHOLDERS) return out
    }
  }
  return out
}

/** Default values substituted into `{{...}}` while validating generated SQL. */
export function defaultVariableValues(
  placeholders: DimensionPlaceholder[],
  now: Date = new Date(),
): Record<string, string> {
  const to = new Date(now)
  to.setUTCDate(to.getUTCDate() + 1)
  const from = new Date(now)
  from.setUTCDate(from.getUTCDate() - DEFAULT_RANGE_DAYS)
  const values: Record<string, string> = {
    [DATE_FROM_VAR]: isoDate(from),
    [DATE_TO_VAR]: isoDate(to),
  }
  for (const placeholder of placeholders) values[placeholder.name] = ''
  return values
}

/** Prompt block explaining which placeholders the model may use and how. */
export function renderVariableInstructions(profile: SchemaProfile | null, placeholders: DimensionPlaceholder[]): string {
  const lines: string[] = []
  if (profile?.primaryTimeColumn) {
    lines.push(
      `Time filter: when a query touches a table with a time column, add WHERE <time_col> >= '{{${DATE_FROM_VAR}}}' AND <time_col> < '{{${DATE_TO_VAR}}}' (dates are ISO yyyy-mm-dd strings). KPIs and trends must share the same time window.`,
    )
  }
  if (placeholders.length > 0) {
    lines.push(
      `Dimension filters (optional, use at most 2 across the dashboard): ${placeholders.map((p) => `{{${p.name}}} for ${p.table}.${p.column}`).join(', ')}. Pattern: AND ('{{${placeholders[0]!.name}}}' = '' OR ${placeholders[0]!.column} = '{{${placeholders[0]!.name}}}') so an empty value means no filter.`,
    )
  }
  if (lines.length === 0) return ''
  return `Filters:\n${lines.map((line) => `- ${line}`).join('\n')}`
}

/** Emits dashboard variables for the placeholders that survived validation. */
export function buildDashboardVariables(
  usedVariables: string[],
  placeholders: DimensionPlaceholder[],
  sampledOptions: Record<string, string[]>,
  defaults: Record<string, string>,
): DashboardVariable[] {
  const used = new Set(usedVariables)
  const variables: DashboardVariable[] = []
  if (used.has(DATE_FROM_VAR) || used.has(DATE_TO_VAR)) {
    variables.push({ name: DATE_FROM_VAR, type: 'date', defaultValue: defaults[DATE_FROM_VAR] ?? '', label: 'From' })
    variables.push({ name: DATE_TO_VAR, type: 'date', defaultValue: defaults[DATE_TO_VAR] ?? '', label: 'To' })
  }
  for (const placeholder of placeholders) {
    if (!used.has(placeholder.name)) continue
    const options = (sampledOptions[placeholder.name] ?? placeholder.values ?? []).slice(0, MAX_SELECT_OPTIONS)
    variables.push({
      name: placeholder.name,
      type: options.length > 0 ? 'select' : 'text',
      defaultValue: '',
      options: options.length > 0 ? options : undefined,
      label: placeholder.column.replace(/_/g, ' '),
    })
  }
  for (const name of used) {
    if (variables.some((v) => v.name === name)) continue
    variables.push({ name, type: 'text', defaultValue: defaults[name] ?? '' })
  }
  return variables
}

/** Dialect-aware DISTINCT sampler used to fill `select` variable options. */
export function distinctValuesSql(table: string, column: string, dialect: string, limit = MAX_SELECT_OPTIONS): string {
  if (/T-SQL|SQL Server/i.test(dialect)) {
    return `SELECT DISTINCT TOP ${limit} ${column} FROM ${table} WHERE ${column} IS NOT NULL ORDER BY ${column}`
  }
  return `SELECT DISTINCT ${column} FROM ${table} WHERE ${column} IS NOT NULL ORDER BY ${column} LIMIT ${limit}`
}
