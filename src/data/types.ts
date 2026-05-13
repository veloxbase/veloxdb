/** PostgreSQL `sslmode`-style TLS (lowercase in JSON for Tauri). */
export type ConnectionSslMode = 'disable' | 'prefer' | 'require'
export type DatabaseEngine = 'postgres' | 'mysql' | 'sqlite'

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
}

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
}

export type QueryEditorTable = {
  schema: string
  name: string
  columns: QueryEditorColumn[]
}

export type QueryEditorFunction = {
  schema: string
  name: string
  argTypes: string[]
  returnType: string
}

export type QueryEditorMetadata = {
  tables: QueryEditorTable[]
  functions: QueryEditorFunction[]
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

export type TableInfo = {
  schema: string
  name: string
  previewQuery: string
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
