import { invoke } from '@tauri-apps/api/core'

import { normalizeError } from '@/lib/app-error'
import type {
  ConnectionInput,
  ConnectionSummary,
  ColumnInfo,
  ColumnProperties,
  DdlBatchRequest,
  DdlStatementRequest,
  ForeignKeyEdge,
  LintSqlRequest,
  LintSqlResult,
  QueryEditorMetadata,
  QueryRequest,
  QueryResult,
  TableInfo,
  TableIndexesResult,
  TablePropertiesApplyRequest,
} from '@/data/types'
import type { VeloxDbRepository } from '@/data/repositories/VeloxDbRepository'

async function invokeCommand<T>(context: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    const normalized = normalizeError(error)
    throw new Error(`${context}: ${normalized.message}`)
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
}

