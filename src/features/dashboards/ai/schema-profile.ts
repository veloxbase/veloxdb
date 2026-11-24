import type {
  ForeignKeyEdge,
  QueryEditorColumn,
  QueryEditorMetadata,
  QueryEditorTable,
  TableInfo,
} from '@/data/types'

export type TableRole = 'fact' | 'dimension' | 'lookup' | 'junk'
export type MeasureKind = 'money' | 'count' | 'rate' | 'duration' | 'quantity'

export type ProfiledMeasure = {
  name: string
  dataType: string
  kind: MeasureKind
}

export type ProfiledDimension = {
  name: string
  dataType: string
  /** Set when the column is a foreign key to another table. */
  refersTo?: string
  /** Enum labels when the column type is a known enum. */
  values?: string[]
}

export type JoinPath = {
  fromColumn: string
  toTable: string
  toColumn: string
}

export type ProfiledTable = {
  schema: string
  name: string
  qualifiedName: string
  role: TableRole
  estimatedRows: number | null
  comment: string | null
  timeColumn: string | null
  primaryKey: string | null
  measures: ProfiledMeasure[]
  dimensions: ProfiledDimension[]
  joins: JoinPath[]
  /** Higher ranks first in the prompt. */
  score: number
  /** All column names, used for compact rendering of dimension tables. */
  columnNames: string[]
}

export type SchemaProfile = {
  tables: ProfiledTable[]
  enums: Array<{ name: string; values: string[] }>
  /** The best global time column candidate, e.g. `orders.created_at`. */
  primaryTimeColumn: { table: string; column: string } | null
  truncated: boolean
}

export type SchemaProfileOptions = {
  maxTables?: number
  maxFactColumns?: number
  maxDimensionColumns?: number
}

const DEFAULT_OPTIONS: Required<SchemaProfileOptions> = {
  maxTables: 40,
  maxFactColumns: 24,
  maxDimensionColumns: 12,
}

const JUNK_TABLE_RE = /(^|_)(migrations?|schema_version|flyway|knex|prisma|__|ar_internal_metadata|sessions?|cache|jobs?|queue|log|logs|audit|history|revisions?|temp|tmp|backup|bak)($|_)/i
const TIME_TYPE_RE = /timestamp|datetime|date|time\b/i
const TIME_NAME_RE = /^(created|updated|inserted|occurred|event|order|paid|shipped|completed|started|ended|logged|signup|signed_up|registered|at|ts|time|date|day|month|period)(_at|_on|_date|_time|_ts)?$|_(at|on|date|time|ts)$/i
const NUMERIC_TYPE_RE = /int|serial|numeric|decimal|float|double|real|money|number|bigint|smallint|tinyint|dec\b|fixed|long/i
const TEXT_TYPE_RE = /char|text|string|enum|uuid|bool|varchar|nvarchar|citext/i
const ID_NAME_RE = /(^|_)(id|uuid|guid|key)$/i
const MONEY_NAME_RE = /amount|revenue|price|cost|total|fee|charge|payment|mrr|arr|gmv|spend|balance|salary|tax|discount|subtotal|value|sales/i
const COUNT_NAME_RE = /count|num_|_num|quantity|qty|units|clicks|views|visits|sessions|orders|items|seats|users|installs/i
const RATE_NAME_RE = /rate|pct|percent|ratio|score|share|margin|conversion|churn|probability/i
const DURATION_NAME_RE = /duration|latency|elapsed|_ms$|_seconds?$|_minutes?$|_hours?$|_days?$|ttl|age/i
const DIMENSION_NAME_RE = /status|state|type|kind|category|tier|plan|region|country|city|channel|source|segment|role|level|gender|currency|method|provider|platform|device|priority|stage|group|class|code|name|slug|title/i

function qualified(schema: string, name: string): string {
  return schema && schema !== 'public' && schema !== 'main' && schema !== 'dbo' ? `${schema}.${name}` : name
}

function isJunkTable(table: QueryEditorTable): boolean {
  return JUNK_TABLE_RE.test(table.name)
}

function measureKind(name: string): MeasureKind {
  if (RATE_NAME_RE.test(name)) return 'rate'
  if (MONEY_NAME_RE.test(name)) return 'money'
  if (DURATION_NAME_RE.test(name)) return 'duration'
  if (COUNT_NAME_RE.test(name)) return 'count'
  return 'quantity'
}

function pickTimeColumn(columns: QueryEditorColumn[]): string | null {
  const temporal = columns.filter((column) => TIME_TYPE_RE.test(column.dataType))
  if (temporal.length === 0) return null
  const preferred = ['created_at', 'occurred_at', 'event_time', 'order_date', 'paid_at', 'timestamp', 'date', 'day']
  for (const name of preferred) {
    const hit = temporal.find((column) => column.name.toLowerCase() === name)
    if (hit) return hit.name
  }
  const named = temporal.find((column) => TIME_NAME_RE.test(column.name))
  if (named) return named.name
  return temporal[0]?.name ?? null
}

function isPrimaryKey(column: QueryEditorColumn, table: QueryEditorTable): boolean {
  if (column.isPrimaryKey) return true
  if (column.name.toLowerCase() === 'id') return true
  return column.name.toLowerCase() === `${table.name.toLowerCase()}_id`
}

export function buildSchemaProfile(
  metadata: QueryEditorMetadata,
  foreignKeys: ForeignKeyEdge[],
  focusTable?: TableInfo | null,
  options?: SchemaProfileOptions,
): SchemaProfile {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  const enumMap = new Map<string, string[]>()
  for (const item of metadata.enums ?? []) {
    enumMap.set(item.name.toLowerCase(), item.values)
    const short = item.name.split('.').pop()
    if (short) enumMap.set(short.toLowerCase(), item.values)
  }

  const fkOut = new Map<string, ForeignKeyEdge[]>()
  const fkIn = new Map<string, number>()
  for (const fk of foreignKeys) {
    const from = `${fk.fromSchema}.${fk.fromTable}`
    const to = `${fk.toSchema}.${fk.toTable}`
    fkOut.set(from, [...(fkOut.get(from) ?? []), fk])
    fkIn.set(to, (fkIn.get(to) ?? 0) + 1)
  }

  const tables: ProfiledTable[] = metadata.tables.map((table) => {
    const key = `${table.schema}.${table.name}`
    const outEdges = fkOut.get(key) ?? []
    const inDegree = fkIn.get(key) ?? 0
    const fkColumns = new Set(outEdges.map((edge) => edge.fromColumn))
    const timeColumn = pickTimeColumn(table.columns)
    const primary = table.columns.find((column) => isPrimaryKey(column, table))?.name ?? null

    const measures: ProfiledMeasure[] = []
    const dimensions: ProfiledDimension[] = []
    for (const column of table.columns) {
      if (column.name === primary) continue
      const lower = column.name.toLowerCase()
      const enumValues = enumMap.get(column.dataType.toLowerCase())
      if (fkColumns.has(column.name)) {
        const edge = outEdges.find((e) => e.fromColumn === column.name)
        dimensions.push({
          name: column.name,
          dataType: column.dataType,
          refersTo: edge ? qualified(edge.toSchema, edge.toTable) : undefined,
        })
        continue
      }
      if (enumValues) {
        dimensions.push({ name: column.name, dataType: column.dataType, values: enumValues })
        continue
      }
      if (NUMERIC_TYPE_RE.test(column.dataType) && !ID_NAME_RE.test(lower)) {
        measures.push({ name: column.name, dataType: column.dataType, kind: measureKind(lower) })
        continue
      }
      if (TEXT_TYPE_RE.test(column.dataType) && (DIMENSION_NAME_RE.test(lower) || /bool/i.test(column.dataType))) {
        dimensions.push({ name: column.name, dataType: column.dataType })
      }
    }

    const rows = table.estimatedRows ?? null
    let role: TableRole
    if (isJunkTable(table)) role = 'junk'
    else if (measures.length > 0 && (timeColumn || outEdges.length > 0)) role = 'fact'
    else if (inDegree > 0 || (table.columns.length <= 6 && dimensions.length > 0)) role = inDegree > 0 && table.columns.length <= 3 ? 'lookup' : 'dimension'
    else if (measures.length > 0) role = 'fact'
    else role = 'dimension'

    const rowWeight = Math.log10(Math.max(1, rows ?? 100))
    let score = rowWeight * (1 + outEdges.length) + measures.length * 0.5 + (timeColumn ? 2 : 0)
    if (role === 'dimension') score = rowWeight * 0.5 + inDegree * 1.5
    if (role === 'lookup') score = inDegree
    if (role === 'junk') score = -1
    if (focusTable && focusTable.schema === table.schema && focusTable.name === table.name) score += 1000

    return {
      schema: table.schema,
      name: table.name,
      qualifiedName: qualified(table.schema, table.name),
      role,
      estimatedRows: rows,
      comment: table.comment ?? null,
      timeColumn,
      primaryKey: primary,
      measures,
      dimensions,
      joins: outEdges.map((edge) => ({
        fromColumn: edge.fromColumn,
        toTable: qualified(edge.toSchema, edge.toTable),
        toColumn: edge.toColumn,
      })),
      score,
      columnNames: table.columns.map((column) => column.name),
    }
  })

  const ranked = tables
    .filter((table) => table.role !== 'junk')
    .sort((a, b) => b.score - a.score)

  // Facts first, then dimensions reachable from kept facts, then the rest.
  const facts = ranked.filter((table) => table.role === 'fact')
  const reachable = new Set<string>()
  for (const fact of facts) for (const join of fact.joins) reachable.add(join.toTable)
  const dims = ranked.filter((table) => table.role !== 'fact')
  const focused = focusTable
    ? ranked.find((table) => table.schema === focusTable.schema && table.name === focusTable.name)
    : undefined
  const ordered = [
    ...(focused ? [focused] : []),
    ...facts,
    ...dims.filter((table) => reachable.has(table.qualifiedName)),
    ...dims.filter((table) => !reachable.has(table.qualifiedName)),
  ].filter((table, index, list) => list.indexOf(table) === index)
  const kept = ordered.slice(0, opts.maxTables).map((table) => ({
    ...table,
    measures: table.role === 'fact' ? table.measures.slice(0, opts.maxFactColumns) : table.measures.slice(0, opts.maxDimensionColumns),
    dimensions: table.role === 'fact' ? table.dimensions.slice(0, opts.maxFactColumns) : table.dimensions.slice(0, opts.maxDimensionColumns),
  }))

  const primaryFact = kept.find((table) => table.role === 'fact' && table.timeColumn)
  const primaryTimeColumn = primaryFact && primaryFact.timeColumn
    ? { table: primaryFact.qualifiedName, column: primaryFact.timeColumn }
    : null

  return {
    tables: kept,
    enums: (metadata.enums ?? []).map((item) => ({ name: item.name, values: item.values })),
    primaryTimeColumn,
    truncated: ordered.length > kept.length || metadata.truncatedTables || metadata.truncatedColumns,
  }
}

function formatRows(rows: number | null): string {
  if (rows == null) return ''
  if (rows >= 1_000_000) return ` ~${(rows / 1_000_000).toFixed(1)}M rows`
  if (rows >= 1_000) return ` ~${Math.round(rows / 1_000)}K rows`
  return ` ~${Math.round(rows)} rows`
}

/** Renders a compact schema profile block for the generation prompt. */
export function renderSchemaProfile(profile: SchemaProfile): string {
  const lines: string[] = []
  for (const table of profile.tables) {
    const header = `${table.role.toUpperCase()} ${table.qualifiedName}${formatRows(table.estimatedRows)}${table.comment ? ` — ${table.comment}` : ''}`
    lines.push(header)
    if (table.timeColumn) lines.push(`  time: ${table.timeColumn}`)
    if (table.measures.length > 0) {
      lines.push(`  measures: ${table.measures.map((m) => `${m.name} (${m.kind})`).join(', ')}`)
    }
    if (table.dimensions.length > 0) {
      lines.push(`  dimensions: ${table.dimensions.map((d) => {
        if (d.values) return `${d.name} [${d.values.slice(0, 8).join('|')}]`
        if (d.refersTo) return `${d.name} -> ${d.refersTo}`
        return d.name
      }).join(', ')}`)
    }
    if (table.role !== 'fact' && table.measures.length === 0 && table.dimensions.length === 0) {
      lines.push(`  columns: ${table.columnNames.slice(0, 12).join(', ')}`)
    }
    if (table.joins.length > 0) {
      lines.push(`  joins: ${table.joins.map((j) => `${table.qualifiedName}.${j.fromColumn} = ${j.toTable}.${j.toColumn}`).join('; ')}`)
    }
  }
  if (profile.enums.length > 0) {
    lines.push('', 'Enums:')
    for (const item of profile.enums.slice(0, 20)) {
      lines.push(`  ${item.name}: ${item.values.slice(0, 12).join(', ')}`)
    }
  }
  if (profile.primaryTimeColumn) {
    lines.push('', `Primary time column: ${profile.primaryTimeColumn.table}.${profile.primaryTimeColumn.column}`)
  }
  if (profile.truncated) lines.push('', '(schema truncated — prefer the tables above)')
  return lines.join('\n')
}

/** Returns the profile block for only the tables referenced in `sql` (used by repair prompts). */
export function renderProfileForSql(profile: SchemaProfile, sql: string): string {
  const lower = sql.toLowerCase()
  const referenced = profile.tables.filter((table) =>
    lower.includes(table.name.toLowerCase()),
  )
  if (referenced.length === 0) return renderSchemaProfile(profile)
  return renderSchemaProfile({ ...profile, tables: referenced, enums: profile.enums, truncated: false })
}
