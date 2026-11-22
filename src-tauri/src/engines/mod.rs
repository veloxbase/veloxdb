mod cassandra;
mod clickhouse;
mod duckdb;
mod libsql;
mod mongo;
mod mssql;
mod mysql;
mod postgres;
mod readonly;
mod redis;
mod sqlite;

pub(crate) use readonly::AgentStatement;
#[cfg(test)]
pub(crate) use readonly::sqlite_readonly as readonly_sqlite_for_tests;

use tauri::AppHandle;

use crate::db::{
    describe_pool_error, drop_pool, get_or_create_mysql_pool, get_or_create_pool,
    get_or_create_sqlite_pool, is_retryable_connection_error, AppState,
};
use crate::error::VeloxError;
use crate::models::{
    ColumnInfo, ConnectionInput, DatabaseEngine, DatabaseInfo, QueryResult, TableInfo,
};

use cassandra::CassandraEngine;
use clickhouse::ClickhouseEngine;
use duckdb::DuckdbEngine;
use libsql::LibsqlEngine;
use mongo::MongoEngine;
use mssql::MssqlEngine;
use mysql::MySqlEngine;
use postgres::PostgresEngine;
use redis::RedisEngine;
use sqlite::SqliteEngine;

/// Per-engine operations implemented by each engine unit struct.
/// Dispatch goes through [`EngineDispatcher`] (static enum, no boxing).
#[allow(async_fn_in_trait)]
pub trait DatabaseEngineOps: Send + Sync {
    async fn connect(
        &self,
        app: &AppHandle,
        state: &AppState,
        input: &ConnectionInput,
        connection_id: &str,
    ) -> Result<(), VeloxError>;

    async fn ping(
        &self,
        app: &AppHandle,
        state: &AppState,
        connection_id: &str,
    ) -> Result<(), VeloxError>;

    async fn run_query(
        &self,
        app: &AppHandle,
        state: &AppState,
        connection_id: &str,
        sql: &str,
        max_rows: usize,
    ) -> Result<QueryResult, VeloxError>;

    async fn get_tables(
        &self,
        app: &AppHandle,
        state: &AppState,
        connection_id: &str,
    ) -> Result<Vec<TableInfo>, VeloxError>;

    async fn get_schema(
        &self,
        app: &AppHandle,
        state: &AppState,
        connection_id: &str,
        table_schema: &str,
        table_name: &str,
    ) -> Result<Vec<ColumnInfo>, VeloxError>;

    async fn list_databases(
        &self,
        app: &AppHandle,
        state: &AppState,
        connection_id: &str,
    ) -> Result<Vec<DatabaseInfo>, VeloxError>;
}

/// Static-dispatch enum over all engine implementations.
/// Use [`get_engine`] to construct the right variant.
pub enum EngineDispatcher {
    Postgres(PostgresEngine),
    Mysql(MySqlEngine),
    Sqlite(SqliteEngine),
    Mongo(MongoEngine),
    Duckdb(DuckdbEngine),
    Redis(RedisEngine),
    Clickhouse(ClickhouseEngine),
    Libsql(LibsqlEngine),
    Cassandra(CassandraEngine),
    Mssql(MssqlEngine),
}

macro_rules! delegate {
    ($self:ident, $method:ident, $($arg:expr),* $(,)?) => {
        match $self {
            EngineDispatcher::Postgres(e) => e.$method($($arg),*).await,
            EngineDispatcher::Mysql(e) => e.$method($($arg),*).await,
            EngineDispatcher::Sqlite(e) => e.$method($($arg),*).await,
            EngineDispatcher::Mongo(e) => e.$method($($arg),*).await,
            EngineDispatcher::Duckdb(e) => e.$method($($arg),*).await,
            EngineDispatcher::Redis(e) => e.$method($($arg),*).await,
            EngineDispatcher::Clickhouse(e) => e.$method($($arg),*).await,
            EngineDispatcher::Libsql(e) => e.$method($($arg),*).await,
            EngineDispatcher::Cassandra(e) => e.$method($($arg),*).await,
            EngineDispatcher::Mssql(e) => e.$method($($arg),*).await,
        }
    };
}

impl DatabaseEngineOps for EngineDispatcher {
    async fn connect(&self, app: &AppHandle, state: &AppState, input: &ConnectionInput, connection_id: &str) -> Result<(), VeloxError> {
        delegate!(self, connect, app, state, input, connection_id)
    }
    async fn ping(&self, app: &AppHandle, state: &AppState, connection_id: &str) -> Result<(), VeloxError> {
        delegate!(self, ping, app, state, connection_id)
    }
    async fn run_query(&self, app: &AppHandle, state: &AppState, connection_id: &str, sql: &str, max_rows: usize) -> Result<QueryResult, VeloxError> {
        delegate!(self, run_query, app, state, connection_id, sql, max_rows)
    }
    async fn get_tables(&self, app: &AppHandle, state: &AppState, connection_id: &str) -> Result<Vec<TableInfo>, VeloxError> {
        delegate!(self, get_tables, app, state, connection_id)
    }
    async fn get_schema(&self, app: &AppHandle, state: &AppState, connection_id: &str, table_schema: &str, table_name: &str) -> Result<Vec<ColumnInfo>, VeloxError> {
        delegate!(self, get_schema, app, state, connection_id, table_schema, table_name)
    }
    async fn list_databases(&self, app: &AppHandle, state: &AppState, connection_id: &str) -> Result<Vec<DatabaseInfo>, VeloxError> {
        delegate!(self, list_databases, app, state, connection_id)
    }
}

/// Return the right engine dispatcher for the given discriminant.
pub fn get_engine(engine: DatabaseEngine) -> EngineDispatcher {
    match engine {
        DatabaseEngine::Postgres => EngineDispatcher::Postgres(PostgresEngine),
        DatabaseEngine::Mysql => EngineDispatcher::Mysql(MySqlEngine),
        DatabaseEngine::Sqlite => EngineDispatcher::Sqlite(SqliteEngine),
        DatabaseEngine::Mongo => EngineDispatcher::Mongo(MongoEngine),
        DatabaseEngine::Duckdb => EngineDispatcher::Duckdb(DuckdbEngine),
        DatabaseEngine::Redis => EngineDispatcher::Redis(RedisEngine),
        DatabaseEngine::Clickhouse => EngineDispatcher::Clickhouse(ClickhouseEngine),
        DatabaseEngine::Libsql | DatabaseEngine::Turso => EngineDispatcher::Libsql(LibsqlEngine),
        DatabaseEngine::Scylladb | DatabaseEngine::Cassandra => EngineDispatcher::Cassandra(CassandraEngine),
        DatabaseEngine::Mssql | DatabaseEngine::Azuresql => EngineDispatcher::Mssql(MssqlEngine),
    }
}

/// True for engines whose database refuses writes from agent SQL on its own
/// (see [`readonly`]). Other SQL engines rely on the parser check alone, so
/// the MCP server does not expose them.
pub(crate) fn enforces_readonly_in_database(engine: DatabaseEngine) -> bool {
    matches!(
        engine,
        DatabaseEngine::Postgres | DatabaseEngine::Mysql | DatabaseEngine::Sqlite
    )
}

/// Runs agent (Veloxy, MCP) SQL that already passed
/// `check_agent_readonly_sql`. Postgres, MySQL and SQLite run it so that the
/// database itself refuses writes, with `timeout_ms` enforced by the server
/// and a row cap applied while reading (see [`readonly`]). Other engines rely
/// on the parser check alone.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn run_agent_readonly(
    app: &AppHandle,
    state: &AppState,
    connection_id: &str,
    engine: DatabaseEngine,
    sql: &str,
    kind: AgentStatement,
    max_rows: usize,
    timeout_ms: u64,
) -> Result<QueryResult, VeloxError> {
    match engine {
        DatabaseEngine::Postgres => {
            run_postgres_agent_readonly(app, state, connection_id, sql, kind, max_rows, timeout_ms)
                .await
        }
        DatabaseEngine::Mysql => {
            let pool = get_or_create_mysql_pool(app, state, connection_id).await?;
            readonly::mysql_readonly(&pool, sql, max_rows, timeout_ms)
                .await
                .map_err(VeloxError::Query)
        }
        DatabaseEngine::Sqlite => {
            let pool = get_or_create_sqlite_pool(app, state, connection_id).await?;
            readonly::sqlite_readonly(&pool, sql, max_rows, timeout_ms)
                .await
                .map_err(VeloxError::Query)
        }
        _ => {
            get_engine(engine)
                .run_query(app, state, connection_id, sql, max_rows)
                .await
        }
    }
}

/// Postgres agent reads, with one retry on a dropped connection like
/// `with_pool_client_retry`. The session is held by a guard that closes it
/// if the client-side timeout fires mid-transaction.
async fn run_postgres_agent_readonly(
    app: &AppHandle,
    state: &AppState,
    connection_id: &str,
    sql: &str,
    kind: AgentStatement,
    max_rows: usize,
    timeout_ms: u64,
) -> Result<QueryResult, VeloxError> {
    let client_timeout =
        std::time::Duration::from_millis(timeout_ms) + std::time::Duration::from_secs(5);
    let mut dropped_pool = false;
    loop {
        let pool = get_or_create_pool(app, state, connection_id).await?;
        let outcome = match pool.get().await {
            Ok(client) => {
                let session = readonly::PgSessionGuard::new(client);
                tokio::time::timeout(
                    client_timeout,
                    readonly::postgres_readonly(session, sql, kind, max_rows, timeout_ms),
                )
                .await
                .unwrap_or_else(|_| Err(readonly::timeout_message(timeout_ms)))
            }
            Err(error) => Err(describe_pool_error(&error)),
        };
        match outcome {
            Ok(result) => return Ok(result),
            Err(message) if !dropped_pool && is_retryable_connection_error(&message) => {
                drop_pool(state, connection_id).await;
                dropped_pool = true;
            }
            Err(message) => return Err(VeloxError::Query(message)),
        }
    }
}
