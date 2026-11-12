import type { ConnectorPlugin } from '@/features/plugins/types'

/** SQL engines that can run a dashboard SELECT. Mongo, Redis, and CQL stay off. */
export const builtInConnectors: ConnectorPlugin[] = [
  { id: 'postgres', name: 'PostgreSQL', category: 'database', tier: 'community', supportedForDashboards: true },
  { id: 'mysql', name: 'MySQL', category: 'database', tier: 'community', supportedForDashboards: true },
  { id: 'sqlite', name: 'SQLite', category: 'database', tier: 'community', supportedForDashboards: true },
  { id: 'duckdb', name: 'DuckDB', category: 'database', tier: 'community', supportedForDashboards: true },
  { id: 'clickhouse', name: 'ClickHouse', category: 'database', tier: 'community', supportedForDashboards: true },
  { id: 'libsql', name: 'LibSQL', category: 'database', tier: 'community', supportedForDashboards: true },
  { id: 'turso', name: 'Turso', category: 'database', tier: 'community', supportedForDashboards: true },
  { id: 'mssql', name: 'SQL Server', category: 'database', tier: 'community', supportedForDashboards: true },
  { id: 'azuresql', name: 'Azure SQL', category: 'database', tier: 'community', supportedForDashboards: true },
  { id: 'mongo', name: 'MongoDB', category: 'database', tier: 'community', supportedForDashboards: false },
  { id: 'redis', name: 'Redis', category: 'database', tier: 'community', supportedForDashboards: false },
]
