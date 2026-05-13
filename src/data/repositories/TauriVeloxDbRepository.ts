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

  async listConnections(): Promise<ConnectionSummary[]> {
    return invokeCommand('list_connections', () =>
      invoke<ConnectionSummary[]>('list_connections_command'),
    )
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

  async chatWithDb(request: AskVeloxyChatRequest): Promise<AskVeloxyChatResponse> {
    return invokeCommand('chat_with_db', () =>
      invoke<AskVeloxyChatResponse>('chat_with_db', { input: request }),
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
}

