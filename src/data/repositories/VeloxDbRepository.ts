import type {
  ColumnInfo,
  ColumnProperties,
  ConnectionInput,
  ConnectionSummary,
  DdlBatchRequest,
  DdlStatementRequest,
  ForeignKeyEdge,
  QueryRequest,
  QueryResult,
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
  listConnections(): Promise<ConnectionSummary[]>
  setActiveConnection(connectionId: string): Promise<ConnectionSummary>
  runQuery(request: QueryRequest): Promise<QueryResult>
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
}

