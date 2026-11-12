/** PostgreSQL `sslmode`-style TLS (lowercase in JSON for Tauri). */
export type ConnectionSslMode = 'disable' | 'prefer' | 'require'
export type DatabaseEngine =
  | 'postgres'
  | 'mysql'
  | 'sqlite'
  | 'mongo'
  | 'duckdb'
  | 'redis'
  | 'clickhouse'
  | 'libsql'
  | 'turso'
  | 'scylladb'
  | 'cassandra'
  | 'mssql'
  | 'azuresql'

export type SshAuthMethod = 'keyfile' | 'password'

export type SshConfig = {
  enabled: boolean
  host: string
  port: number
  user: string
  authMethod: SshAuthMethod
  password?: string | null
  privateKeyPath?: string | null
  passphrase?: string | null
}

export type ConnectionInput = {
  id?: string
  name: string
  engine: DatabaseEngine
  host: string
  port: number
  database: string
  filePath?: string | null
  user: string
  password: string
  sslMode: ConnectionSslMode
  srvEnabled?: boolean
  sshConfig?: SshConfig | null
  extraParams?: Record<string, string> | null
}

export type ConnectionSummary = {
  id: string
  name: string
  engine: DatabaseEngine
  host: string
  port: number
  database: string
  filePath?: string | null
  user: string
  connectedAt: string
  sslMode: ConnectionSslMode
  sshConfig?: SshConfig | null
  extraParams?: Record<string, string> | null
  tablePropertyEditingSupported: boolean
}

export type QueryRequest = {
  connectionId?: string
  sql: string
  /** Maximum rows to return. Matches the user's Settings > Results > Max rows preference. */
  maxRows?: number
  /** Allows non-read-only statements to run. The editor sets this after confirming a write. */
  allowWrite?: boolean
}

/** Hard cap for Veloxy agent `run_readonly` (independent of Settings max rows). */
export const VELOXY_MAX_READONLY_ROWS = 50
export const VELOXY_SAMPLE_ROWS = 20
/** Higher cap for chart-backing queries so charts bind to full aggregates, not samples. */
export const VELOXY_MAX_CHART_ROWS = 500

export type LintSqlRequest = {
  connectionId?: string
  sql: string
}

export type SqlDiagnostic = {
  message: string
  severity: 'error' | 'warning' | 'info'
  line?: number | null
  column?: number | null
  endLine?: number | null
  endColumn?: number | null
}

export type LintSqlResult = {
  diagnostics: SqlDiagnostic[]
}

export type QueryEditorColumn = {
  name: string
  dataType: string
  comment?: string | null
  isNullable?: boolean | null
  isPrimaryKey?: boolean | null
}

export type QueryEditorTable = {
  schema: string
  name: string
  columns: QueryEditorColumn[]
  /** Planner estimate (e.g. `pg_class.reltuples`); absent when the engine has no cheap estimate. */
  estimatedRows?: number | null
  comment?: string | null
}

export type QueryEditorFunction = {
  schema: string
  name: string
  argTypes: string[]
  returnType: string
}

/** Enum type with its allowed labels, e.g. `public.order_status`. */
export type QueryEditorEnum = {
  name: string
  values: string[]
}

export type QueryEditorMetadata = {
  tables: QueryEditorTable[]
  functions: QueryEditorFunction[]
  enums?: QueryEditorEnum[]
  truncatedTables: boolean
  truncatedColumns: boolean
  truncatedFunctions: boolean
}

export type AskVeloxyProviderConfig = {
  apiKey: string
  model: string
  baseUrl?: string
}

export type AskVeloxyTableRef = {
  schema: string
  name: string
}

export type AskVeloxyRequest = {
  connectionId?: string
  naturalPrompt: string
  targetTable?: AskVeloxyTableRef
  providerConfig: AskVeloxyProviderConfig
  maxRows?: number
}

export type AskVeloxyMode = 'chat' | 'action'
export type AskVeloxyConversationRole = 'user' | 'assistant'

export type AskVeloxyConversationMessage = {
  id: string
  role: AskVeloxyConversationRole
  mode: AskVeloxyMode
  text: string
  createdAt: number
  sqlDraft?: string
}

export type AskVeloxyChatRequest = {
  connectionId?: string
  naturalPrompt: string
  targetTable?: AskVeloxyTableRef
  providerConfig: AskVeloxyProviderConfig
  maxRows?: number
  /** Correlates OpenRouter SSE chunks with the in-flight sidebar message. */
  requestId?: string
}

export type VeloxyStreamChunk = {
  requestId: string
  delta: string
  done: boolean
  message?: string
  suggestions?: string[]
  warnings?: string[]
  sqlDraft?: string
  needsSqlGeneration?: boolean
  needsClarification?: boolean
}

export type AskVeloxyChatResponse = {
  message: string
  suggestions: string[]
  warnings: string[]
  sqlDraft?: string
  needsSqlGeneration: boolean
  needsClarification: boolean
}

export type AskVeloxyConversationResponse = {
  messages: AskVeloxyConversationMessage[]
}

export type AskVeloxyTokenStats = {
  schemaChars: number
  schemaTokensEstimate: number
  promptChars: number
  promptTokensEstimate: number
}

export type AskVeloxyResponse = {
  sql: string
  intent: string
  confidence: number
  explanation?: string
  suggestions?: string[]
  warnings: string[]
  tokenStats: AskVeloxyTokenStats
}

export type TableKind = 'table' | 'view' | 'materialized_view'

export type TableInfo = {
  schema: string
  name: string
  previewQuery: string
  kind?: TableKind
}

export type ColumnInfo = {
  tableSchema: string
  tableName: string
  columnName: string
  dataType: string
  isNullable: boolean
}

export type ColumnProperties = {
  tableSchema: string
  tableName: string
  columnName: string
  dataType: string
  isNullable: boolean
  isPrimaryKey: boolean
  isUnique: boolean
  isPartOfCompositeUnique: boolean
  /** Raw `information_schema.columns.column_default` (may be null). */
  columnDefault?: string | null
  /** `is_identity = YES` */
  isIdentity?: boolean
  /** `ALWAYS` | `BY DEFAULT` or null */
  identityGeneration?: string | null
  /** `ALWAYS` | `NEVER` | `BY DEFAULT` for generated columns */
  isGenerated?: string | null
}

export type ColumnPropertiesUpdate = {
  columnName: string
  isNullable: boolean
  isUnique: boolean
}

export type TablePropertiesApplyRequest = {
  connectionId?: string
  tableSchema: string
  tableName: string
  columns: ColumnPropertiesUpdate[]
}

export type QueryResult = {
  columns: string[]
  rows: Array<Record<string, string | null>>
  rowCount: number
  executionMs: number
  truncated: boolean
  commandTag: number | null
}

/** One column-pair from a foreign key (composite keys yield multiple rows). */
export type ForeignKeyEdge = {
  fromSchema: string
  fromTable: string
  fromColumn: string
  toSchema: string
  toTable: string
  toColumn: string
}

export type DdlBatchRequest = {
  connectionId?: string
  statements: string[]
}

export type DdlStatementRequest = {
  connectionId?: string
  statement: string
}

export type IndexInfo = {
  indexSchema: string
  indexName: string
  tableSchema: string
  tableName: string
  isUnique: boolean
  isPrimary: boolean
  isValid: boolean
  isPartial: boolean
  definition: string
  indexBytes: number
  idxScan: number
  idxTupRead: number
  idxTupFetch: number
}

export type TableIndexesResult = {
  indexes: IndexInfo[]
  truncated: boolean
}


export type DatabaseInfo = {
  name: string
}

export type SwitchDatabaseRequest = {
  connectionId: string
  database: string
}

export type DiagramExportNode = {
  key: string
  name: string
  schema: string
  x: number
  y: number
  columns: { name: string; dataType: string }[]
  columnsTotal: number
  headerColor?: string | null
}

export type DiagramExportEdge = {
  fromKey: string
  toKey: string
  fromColumn?: string | null
  toColumn?: string | null
  kind: string
}

export type DiagramExportRequest = {
  nodes: DiagramExportNode[]
  edges: DiagramExportEdge[]
  viewport: { x: number; y: number; zoom: number }
  theme?: string | null
}

export type ExportQueryRequest = {
  connectionId?: string
  sql: string
  outputPath: string
}

// ── BI: saved queries + dashboards ──────────────────────────

export type SavedQuery = {
  id: string
  name: string
  description?: string | null
  connectionId: string
  sql: string
  createdAt: number
  updatedAt: number
}

export type SavedQueryInput = {
  id?: string | null
  name: string
  description?: string | null
  connectionId: string
  sql: string
}

export type WidgetKind =
  | 'chart' | 'kpi' | 'table' | 'text' | 'markdown' | 'image' | 'divider' | 'filter'

export type ChartType =
  | 'line' | 'area' | 'bar' | 'horizontalBar' | 'pie' | 'donut'
  | 'scatter' | 'heatmap' | 'treemap' | 'gauge' | 'kpi'
  | 'combo' | 'histogram' | 'box' | 'waterfall'

export type ColumnRole = 'temporal' | 'categorical' | 'numeric'

export type ColumnRef = {
  column: string
  role?: ColumnRole
}

export type VizConfig = {
  chartType: ChartType
  encodings: { x?: ColumnRef; y?: ColumnRef[]; series?: ColumnRef; size?: ColumnRef }
  options: Record<string, unknown>
}

export type NotebookCell =
  | {
      id: string
      type: 'sql'
      title: string
      sql: string
      outputName: string
      showInApp: boolean
    }
  | {
      id: string
      type: 'input'
      varName: string
      inputType: 'text' | 'number' | 'date' | 'dropdown'
      defaultValue: string
      options?: string[]
    }
  | {
      id: string
      type: 'visual'
      kind: 'chart' | 'kpi' | 'table'
      title: string
      sourceCellId: string
      viz: VizConfig | null
      showInApp: boolean
    }
  | {
      id: string
      type: 'markdown'
      title: string
      content: string
      showInApp: boolean
    }

export type WidgetQuery = {
  providerId: 'sql-query'
  connectionId: string
  sql: string
  savedQueryId?: string | null
  sourceCellId?: string | null
}

export type WidgetLayout = {
  i: string
  x: number
  y: number
  w: number
  h: number
  isStatic?: boolean
}

export type Widget = {
  id: string
  kind: WidgetKind
  title: string
  query: WidgetQuery | null
  viz: VizConfig | null
  locked: boolean
}

export type DashboardVariableType = 'text' | 'number' | 'date' | 'select'

export type DashboardVariable = {
  name: string
  type: DashboardVariableType
  defaultValue: string
  /** Dropdown values for `select` variables (sampled from a dimension column). */
  options?: string[]
  /** Human label shown in the filter bar; falls back to `name`. */
  label?: string
}

export type DashboardTheme = 'inherit' | 'light' | 'dark'

export type DashboardPage = {
  id: string
  name: string
  widgetIds: string[]
}

export type DashboardStory = {
  id: string
  title: string
  beats: Array<{ pageId: string; caption: string }>
}

export type Dashboard = {
  version: number
  id: string
  name: string
  description?: string | null
  connectionId: string
  cells: NotebookCell[]
  layout: WidgetLayout[]
  widgets: Record<string, Widget>
  variables: DashboardVariable[]
  theme: DashboardTheme
  refreshIntervalSec: number | null
  pages?: DashboardPage[]
  story?: DashboardStory | null
  createdAt: number
  updatedAt: number
}

export type VeloxyChatState = {
  messages: unknown[]
  resume?: unknown
}

export type VeloxyThreadSummary = {
  id: string
  connectionId: string
  databaseName?: string | null
  title: string
  createdAt: number
  updatedAt: number
  openedAt: number
}

export type VeloxyThread = VeloxyThreadSummary & {
  state: VeloxyChatState
}

export type VeloxyThreadInput = {
  id: string
  connectionId: string
  databaseName?: string | null
  title?: string | null
  state: VeloxyChatState
}
