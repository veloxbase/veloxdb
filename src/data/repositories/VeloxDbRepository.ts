import type {
  AskVeloxyChatRequest,
  AskVeloxyChatResponse,
  AskVeloxyConversationResponse,
  AskVeloxyRequest,
  AskVeloxyResponse,
  ColumnInfo,
  ColumnProperties,
  ConnectionInput,
  ConnectionSummary,
  DatabaseInfo,
  DdlBatchRequest,
  DdlStatementRequest,
  DiagramExportRequest,
  ExportQueryRequest,
  ForeignKeyEdge,
  LintSqlRequest,
  LintSqlResult,
  QueryEditorMetadata,
  QueryRequest,
  QueryResult,
  SwitchDatabaseRequest,
  TableInfo,
  TableIndexesResult,
  TablePropertiesApplyRequest,
} from '@/data/types'

/**
 * Repository boundary for all VeloxDB server/local data access.
 * UI and feature hooks should depend on this interface, not on transport details.
 */
export interface VeloxDbRepository {
  connectDb(input: ConnectionInput): Promise<ConnectionSummary>
  disconnectDb(connectionId: string): Promise<void>
  deleteConnection(connectionId: string): Promise<void>
  renameConnection(connectionId: string, newName: string): Promise<ConnectionSummary>
  pingConnection(connectionId: string): Promise<void>
  refreshConnection(connectionId: string): Promise<void>
  listConnections(): Promise<ConnectionSummary[]>
  setActiveConnection(connectionId: string): Promise<ConnectionSummary>
  runQuery(request: QueryRequest): Promise<QueryResult>
  chatWithDb(request: AskVeloxyChatRequest): Promise<AskVeloxyChatResponse>
  cancelVeloxyRequest(): Promise<void>
  loadVeloxyConversation(connectionId?: string): Promise<AskVeloxyConversationResponse>
  clearVeloxyConversation(connectionId?: string): Promise<void>
  generateSqlFromNl(request: AskVeloxyRequest): Promise<AskVeloxyResponse>
  getQueryEditorMetadata(connectionId?: string): Promise<QueryEditorMetadata>
  lintSql(request: LintSqlRequest): Promise<LintSqlResult>
  getTables(connectionId?: string): Promise<TableInfo[]>
  getSchema(connectionId: string | undefined, table: TableInfo): Promise<ColumnInfo[]>
  getTableProperties(connectionId: string | undefined, table: TableInfo): Promise<ColumnProperties[]>
  applyTableProperties(request: TablePropertiesApplyRequest): Promise<void>
  getForeignKeys(connectionId?: string): Promise<ForeignKeyEdge[]>
  getTableIndexes(
    connectionId: string | undefined,
    table: TableInfo,
  ): Promise<TableIndexesResult>
  executeDdlTransaction(request: DdlBatchRequest): Promise<void>
  executeDdlStatement(request: DdlStatementRequest): Promise<void>
  listDatabases(connectionId?: string): Promise<DatabaseInfo[]>
  switchDatabase(request: SwitchDatabaseRequest): Promise<ConnectionSummary>
  exportDiagramPng(input: DiagramExportRequest, outputPath: string): Promise<void>
  exportResultsCsv(input: ExportQueryRequest): Promise<void>
  exportResultsJson(input: ExportQueryRequest): Promise<void>
  saveBase64Png(data: string, outputPath: string): Promise<void>
  saveTextFile(content: string, outputPath: string): Promise<void>
}

