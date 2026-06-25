mod duckdb;
mod mongo;
mod mysql;
mod postgres;
mod redis;
mod sqlite;

use tauri::AppHandle;

use crate::db::AppState;
use crate::error::VeloxError;
use crate::models::{
    ColumnInfo, ConnectionInput, DatabaseEngine, DatabaseInfo, QueryResult, TableInfo,
};

use duckdb::DuckdbEngine;
use mongo::MongoEngine;
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
    }
}
