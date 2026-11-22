import { invoke } from '@tauri-apps/api/core'

import { normalizeError, AppErrorLike } from '@/lib/app-error'
import type {
  AskVeloxyChatRequest,
  AskVeloxyChatResponse,
  AskVeloxyConversationResponse,
  AskVeloxyRequest,
  AskVeloxyResponse,
  ConnectionInput,
  ConnectionSummary,
  ColumnInfo,
  ColumnProperties,
  Dashboard,
  DatabaseInfo,
  DdlBatchRequest,
  DdlStatementRequest,
  DiagramExportRequest,
  ExportQueryRequest,
  ForeignKeyEdge,
  LintSqlRequest,
  LintSqlResult,
  McpStatus,
  QueryEditorMetadata,
  QueryRequest,
  QueryResult,
  SavedQuery,
  SavedQueryInput,
  SwitchDatabaseRequest,
  TableInfo,
  TableIndexesResult,
  TablePropertiesApplyRequest,
  VeloxyThread,
  VeloxyThreadInput,
  VeloxyThreadSummary,
} from '@/data/types'
import type { VeloxDbRepository } from '@/data/repositories/VeloxDbRepository'

async function invokeCommand<T>(_context: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    const normalized = normalizeError(error)
    throw new AppErrorLike(normalized.message, normalized.category, {
      code: normalized.code,
      cause: error,
    })
  }
}

/**
 * Tauri implementation of the VeloxDbRepository interface.
 */
export class TauriVeloxDbRepository implements VeloxDbRepository {
  async connectDb(input: ConnectionInput): Promise<ConnectionSummary> {
    return invokeCommand('connect_db', () =>
      invoke<ConnectionSummary>('connect_db', { input }),
    )
  }

  async testConnection(input: ConnectionInput): Promise<{ elapsedMs: number }> {
    return invokeCommand('test_connection', () =>
      invoke<{ elapsedMs: number }>('test_connection', { input }),
    )
  }

  async disconnectDb(connectionId: string): Promise<void> {
    return invokeCommand('disconnect_db', () =>
      invoke<void>('disconnect_db', { connectionId }),
    )
  }

  async deleteConnection(connectionId: string): Promise<void> {
    return invokeCommand('delete_connection', () =>
      invoke<void>('delete_connection', { connectionId }),
    )
  }

  async renameConnection(connectionId: string, newName: string): Promise<ConnectionSummary> {
    return invokeCommand('rename_connection', () =>
      invoke<ConnectionSummary>('rename_connection', { connectionId, newName }),
    )
  }

  async pingConnection(connectionId: string): Promise<void> {
    return invokeCommand('ping_connection', () =>
      invoke<void>('ping_connection', { connectionId }),
    )
  }

  async refreshConnection(connectionId: string): Promise<void> {
    return invokeCommand('refresh_connection', () =>
      invoke<void>('refresh_connection', { connectionId }),
    )
  }

  async listConnections(): Promise<ConnectionSummary[]> {
    return invokeCommand('list_connections', () =>
      invoke<ConnectionSummary[]>('list_connections_command'),
    )
  }

  async setConnectionAiTools(connectionId: string, allowed: boolean): Promise<ConnectionSummary> {
    return invokeCommand('set_connection_ai_tools', () =>
      invoke<ConnectionSummary>('set_connection_ai_tools', { connectionId, allowed }),
    )
  }

  async getMcpStatus(): Promise<McpStatus> {
    return invokeCommand('mcp_get_status', () => invoke<McpStatus>('mcp_get_status'))
  }

  async setMcpEnabled(enabled: boolean): Promise<McpStatus> {
    return invokeCommand('mcp_set_enabled', () => invoke<McpStatus>('mcp_set_enabled', { enabled }))
  }

  async clearMcpActivity(): Promise<void> {
    return invokeCommand('mcp_clear_activity', () => invoke<void>('mcp_clear_activity'))
  }

  async setActiveConnection(connectionId: string): Promise<ConnectionSummary> {
    return invokeCommand('set_active_connection', () =>
      invoke<ConnectionSummary>('set_active_connection', { connectionId }),
    )
  }

  async runQuery(request: QueryRequest): Promise<QueryResult> {
    return invokeCommand('run_query', () =>
      invoke<QueryResult>('run_query', { input: request }),
    )
  }

  async veloxyRunReadonly(request: QueryRequest): Promise<QueryResult> {
    return invokeCommand('veloxy_run_readonly', () =>
      invoke<QueryResult>('veloxy_run_readonly', { input: request }),
    )
  }

  async chatWithDb(request: AskVeloxyChatRequest): Promise<AskVeloxyChatResponse> {
    return invokeCommand('chat_with_db', () =>
      invoke<AskVeloxyChatResponse>('chat_with_db', { input: request }),
    )
  }

  async cancelVeloxyRequest(): Promise<void> {
    return invokeCommand('cancel_veloxy_request', () =>
      invoke<void>('cancel_veloxy_request'),
    )
  }

  async loadVeloxyConversation(connectionId?: string): Promise<AskVeloxyConversationResponse> {
    return invokeCommand('load_veloxy_conversation', () =>
      invoke<AskVeloxyConversationResponse>('load_veloxy_conversation', { connectionId }),
    )
  }

  async clearVeloxyConversation(connectionId?: string): Promise<void> {
    return invokeCommand('clear_veloxy_conversation', () =>
      invoke<void>('clear_veloxy_conversation', { connectionId }),
    )
  }

  async generateSqlFromNl(request: AskVeloxyRequest): Promise<AskVeloxyResponse> {
    return invokeCommand('generate_sql_from_nl', () =>
      invoke<AskVeloxyResponse>('generate_sql_from_nl', { input: request }),
    )
  }

  async getQueryEditorMetadata(connectionId?: string): Promise<QueryEditorMetadata> {
    return invokeCommand('get_query_editor_metadata', () =>
      invoke<QueryEditorMetadata>('get_query_editor_metadata', { connectionId }),
    )
  }

  async lintSql(request: LintSqlRequest): Promise<LintSqlResult> {
    return invokeCommand('lint_sql', () =>
      invoke<LintSqlResult>('lint_sql', { input: request }),
    )
  }

  async getTables(connectionId?: string): Promise<TableInfo[]> {
    return invokeCommand('get_tables', () => invoke<TableInfo[]>('get_tables', { connectionId }))
  }

  async getSchema(connectionId: string | undefined, table: TableInfo): Promise<ColumnInfo[]> {
    return invokeCommand('get_schema', () =>
      invoke<ColumnInfo[]>('get_schema', {
        input: {
          connectionId,
          tableSchema: table.schema,
          tableName: table.name,
        },
      }),
    )
  }

  async getTableProperties(
    connectionId: string | undefined,
    table: TableInfo,
  ): Promise<ColumnProperties[]> {
    return invokeCommand('get_table_properties', () =>
      invoke<ColumnProperties[]>('get_table_properties', {
        input: {
          connectionId,
          tableSchema: table.schema,
          tableName: table.name,
        },
      }),
    )
  }

  async applyTableProperties(request: TablePropertiesApplyRequest): Promise<void> {
    await invokeCommand('apply_table_properties', () =>
      invoke('apply_table_properties', { input: request }),
    )
  }

  async getForeignKeys(connectionId?: string): Promise<ForeignKeyEdge[]> {
    return invokeCommand('get_foreign_keys', () =>
      invoke<ForeignKeyEdge[]>('get_foreign_keys', { connectionId }),
    )
  }

  async getTableIndexes(
    connectionId: string | undefined,
    table: TableInfo,
  ): Promise<TableIndexesResult> {
    return invokeCommand('get_table_indexes', () =>
      invoke<TableIndexesResult>('get_table_indexes', {
        input: {
          connectionId,
          tableSchema: table.schema,
          tableName: table.name,
        },
      }),
    )
  }

  async executeDdlTransaction(request: DdlBatchRequest): Promise<void> {
    await invokeCommand('execute_ddl_transaction', () =>
      invoke('execute_ddl_transaction', { input: request }),
    )
  }

  async executeDdlStatement(request: DdlStatementRequest): Promise<void> {
    await invokeCommand('execute_ddl_statement', () =>
      invoke('execute_ddl_statement', { input: request }),
    )
  }

  async listDatabases(connectionId?: string): Promise<DatabaseInfo[]> {
    return invokeCommand('list_databases', () =>
      invoke<DatabaseInfo[]>('list_databases', { connectionId }),
    )
  }

  async switchDatabase(request: SwitchDatabaseRequest): Promise<ConnectionSummary> {
    return invokeCommand('switch_database', () =>
      invoke<ConnectionSummary>('switch_database', { input: request }),
    )
  }

  async exportDiagramPng(input: DiagramExportRequest, outputPath: string): Promise<void> {
    return invokeCommand('export_diagram_png', () =>
      invoke<void>('export_diagram_png', { input, outputPath }),
    )
  }

  async exportResultsCsv(input: ExportQueryRequest): Promise<void> {
    return invokeCommand('export_results_csv', () =>
      invoke<void>('export_results_csv_command', { input }),
    )
  }

  async exportResultsJson(input: ExportQueryRequest): Promise<void> {
    return invokeCommand('export_results_json', () =>
      invoke<void>('export_results_json_command', { input }),
    )
  }

  async saveBase64Png(data: string, outputPath: string): Promise<void> {
    return invokeCommand('save_base64_png', () =>
      invoke<void>('save_base64_png', { data, outputPath }),
    )
  }

  async saveTextFile(content: string, outputPath: string): Promise<void> {
    return invokeCommand('save_text_file', () =>
      invoke<void>('save_text_file', { content, outputPath }),
    )
  }

  async readTextFile(inputPath: string): Promise<string> {
    return invokeCommand('read_text_file', () =>
      invoke<string>('read_text_file', { inputPath }),
    )
  }

  // BI: saved queries + dashboards

  async listSavedQueries(connectionId?: string | null): Promise<SavedQuery[]> {
    return invokeCommand('list_saved_queries', () =>
      invoke<SavedQuery[]>('list_saved_queries', { connectionId: connectionId ?? undefined }),
    )
  }

  async getSavedQuery(id: string): Promise<SavedQuery | null> {
    return invokeCommand('get_saved_query', () =>
      invoke<SavedQuery | null>('get_saved_query', { id }),
    )
  }

  async saveSavedQuery(input: SavedQueryInput): Promise<SavedQuery> {
    return invokeCommand('save_saved_query', () =>
      invoke<SavedQuery>('save_saved_query', { input }),
    )
  }

  async deleteSavedQuery(id: string): Promise<void> {
    return invokeCommand('delete_saved_query', () =>
      invoke<void>('delete_saved_query', { id }),
    )
  }

  async duplicateSavedQuery(id: string): Promise<SavedQuery> {
    return invokeCommand('duplicate_saved_query', () =>
      invoke<SavedQuery>('duplicate_saved_query', { id }),
    )
  }

  async listDashboards(connectionId?: string | null): Promise<Dashboard[]> {
    return invokeCommand('list_dashboards', () =>
      invoke<Dashboard[]>('list_dashboards', { connectionId: connectionId ?? undefined }),
    )
  }

  async getDashboard(id: string): Promise<Dashboard | null> {
    return invokeCommand('get_dashboard', () =>
      invoke<Dashboard | null>('get_dashboard', { id }),
    )
  }

  async saveDashboard(input: Dashboard): Promise<Dashboard> {
    return invokeCommand('save_dashboard', () =>
      invoke<Dashboard>('save_dashboard', { input }),
    )
  }

  async deleteDashboard(id: string): Promise<void> {
    return invokeCommand('delete_dashboard', () =>
      invoke<void>('delete_dashboard', { id }),
    )
  }

  async duplicateDashboard(id: string): Promise<Dashboard> {
    return invokeCommand('duplicate_dashboard', () =>
      invoke<Dashboard>('duplicate_dashboard', { id }),
    )
  }

  async listVeloxyThreads(connectionId: string): Promise<VeloxyThreadSummary[]> {
    return invokeCommand('list_veloxy_threads', () =>
      invoke<VeloxyThreadSummary[]>('list_veloxy_threads', { connectionId }),
    )
  }

  async loadVeloxyThread(id: string): Promise<VeloxyThread | null> {
    return invokeCommand('load_veloxy_thread', () =>
      invoke<VeloxyThread | null>('load_veloxy_thread', { id }),
    )
  }

  async saveVeloxyThread(input: VeloxyThreadInput): Promise<VeloxyThread> {
    return invokeCommand('save_veloxy_thread', () =>
      invoke<VeloxyThread>('save_veloxy_thread', { input }),
    )
  }

  async touchVeloxyThread(id: string): Promise<void> {
    return invokeCommand('touch_veloxy_thread', () =>
      invoke<void>('touch_veloxy_thread', { id }),
    )
  }

  async deleteVeloxyThread(id: string): Promise<void> {
    return invokeCommand('delete_veloxy_thread', () =>
      invoke<void>('delete_veloxy_thread', { id }),
    )
  }
}

