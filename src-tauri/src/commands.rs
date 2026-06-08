use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;

use futures_util::StreamExt;
use serde_json::Value;
use tauri::{AppHandle, Emitter, State};
use sqlx::{Column, Decode, Row, Type};
use sqlx::mysql::{MySql, MySqlRow};
use sqlx::sqlite::{Sqlite, SqliteRow};
use tokio_postgres::SimpleQueryMessage;
use uuid::Uuid;

use crate::db::{
    build_mysql_pool, build_mysql_pool_custom, build_pool, build_pool_custom, build_sqlite_pool,
    disconnect_connection, drop_pool, get_or_create_mysql_pool, get_or_create_sqlite_pool,
    list_connections, load_connection, persist_connection_with_password, quote_identifier,
    refresh_connection_pools, resolve_connection_engine, with_pool_client_retry, AppState,
    DEFAULT_MYSQL_PORT, MAX_QUERY_ROWS,
};
use crate::credentials;
use crate::pg_error::{error_line_column, map_pg_err};
use crate::sql_split::split_sql_statements;
use crate::models::{
    AskVeloxyChatRequest, AskVeloxyChatResponse, AskVeloxyConversationMessage,
    AskVeloxyConversationResponse, AskVeloxyDbContextCache, AskVeloxyRequest, AskVeloxyResponse,
    AskVeloxyTableRef, AskVeloxyTokenStats, ColumnInfo, ColumnProperties, ConnectionInput,
    ConnectionSummary, DatabaseInfo, DatabaseEngine, DdlBatchRequest, DdlStatementRequest,
    ForeignKeyEdge, IndexInfo, LintSqlRequest, LintSqlResult, QueryEditorColumn,
    QueryEditorFunction, QueryEditorMetadata, QueryEditorTable, QueryRequest, QueryResult,
    SchemaRequest, SqlDiagnostic, StoredConnection, SwitchDatabaseRequest, TableIndexesResult,
    TableInfo, TablePropertiesApplyRequest, VeloxyStreamChunk,
};
use crate::export::{
    DiagramExportRequest, ExportQueryRequest,
    export_diagram_to_png, export_results_csv, export_results_json,
};
use crate::ssh_tunnel::SshTunnel;

/// Cap FK rows returned to the UI to keep IPC payloads bounded.
const MAX_FOREIGN_KEY_ROWS: i64 = 5000;

/// Cap index rows per table (fetch limit + 1 to detect truncation).
const MAX_TABLE_INDEX_ROWS: i64 = 500;
const MAX_EDITOR_TABLES: i64 = 150;
const MAX_EDITOR_COLUMNS_PER_TABLE: i64 = 60;
const MAX_EDITOR_FUNCTIONS: i64 = 200;
const MAX_LINT_SQL_BYTES: usize = 65_536;
const ASK_VELOXY_MAX_CONTEXT_TABLES: usize = 8;
const ASK_VELOXY_MAX_CONTEXT_COLUMNS: usize = 18;
const ASK_VELOXY_MAX_CONTEXT_RELATIONSHIPS: usize = 36;
const ASK_VELOXY_SCHEMA_CHAR_BUDGET: usize = 6_000;
const ASK_VELOXY_PROMPT_CHAR_BUDGET: usize = 12_000;
const ASK_VELOXY_MAX_HISTORY_MESSAGES: usize = 30;
const ASK_VELOXY_MAX_CHAT_TOKENS: u32 = 10_000;

fn mysql_decode_error(context: &str, column_name: &str, index: Option<usize>, detail: &str) -> String {
    match index {
        Some(idx) => format!(
            "MySQL decode error in {} at column '{}' (index {}): {}",
            context, column_name, idx, detail
        ),
        None => format!(
            "MySQL decode error in {} at column '{}': {}",
            context, column_name, detail
        ),
    }
}

fn sqlite_decode_error(context: &str, column_name: &str, index: Option<usize>, detail: &str) -> String {
    match index {
        Some(idx) => format!(
            "SQLite decode error in {} at column '{}' (index {}): {}",
            context, column_name, idx, detail
        ),
        None => format!(
            "SQLite decode error in {} at column '{}': {}",
            context, column_name, detail
        ),
    }
}

fn mysql_get_idx<T>(row: &MySqlRow, index: usize, column_name: &str, context: &str) -> Result<T, String>
where
    for<'r> T: Decode<'r, MySql> + Type<MySql>,
{
    row.try_get::<T, _>(index)
        .map_err(|error| mysql_decode_error(context, column_name, Some(index), &error.to_string()))
}

fn sqlite_get_idx<T>(row: &SqliteRow, index: usize, column_name: &str, context: &str) -> Result<T, String>
where
    for<'r> T: Decode<'r, Sqlite> + Type<Sqlite>,
{
    row.try_get::<T, _>(index)
        .map_err(|error| sqlite_decode_error(context, column_name, Some(index), &error.to_string()))
}

fn sqlite_get_name<T>(row: &SqliteRow, column_name: &str, context: &str) -> Result<T, String>
where
    for<'r> T: Decode<'r, Sqlite> + Type<Sqlite>,
{
    row.try_get::<T, _>(column_name).map_err(|error| {
        format!(
            "SQLite decode error in {} at column '{}': {}",
            context, column_name, error
        )
    })
}

fn database_name_from_mysql_value(
    value: Option<String>,
    context: &str,
) -> Result<String, String> {
    let name = value
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("{context} returned an empty database name"))?;
    Ok(name)
}

fn mysql_database_name_from_row(row: &MySqlRow, context: &str) -> Result<String, String> {
    let value = mysql_value_to_string(row, 0, "Database", context)?;
    database_name_from_mysql_value(value, context)
}

fn mysql_value_to_string(row: &MySqlRow, index: usize, column_name: &str, context: &str) -> Result<Option<String>, String> {
    if let Ok(value) = row.try_get::<Option<String>, _>(index) {
        return Ok(value);
    }
    if let Ok(value) = row.try_get::<Option<i64>, _>(index) {
        return Ok(value.map(|v| v.to_string()));
    }
    if let Ok(value) = row.try_get::<Option<i32>, _>(index) {
        return Ok(value.map(|v| v.to_string()));
    }
    if let Ok(value) = row.try_get::<Option<u64>, _>(index) {
        return Ok(value.map(|v| v.to_string()));
    }
    if let Ok(value) = row.try_get::<Option<f64>, _>(index) {
        return Ok(value.map(|v| v.to_string()));
    }
    if let Ok(value) = row.try_get::<Option<f32>, _>(index) {
        return Ok(value.map(|v| v.to_string()));
    }
    if let Ok(value) = row.try_get::<Option<bool>, _>(index) {
        return Ok(value.map(|v| v.to_string()));
    }
    if let Ok(value) = row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>(index) {
        return Ok(value.map(|v| v.format("%Y-%m-%d %H:%M:%S").to_string()));
    }
    if let Ok(value) = row.try_get::<Option<chrono::NaiveDateTime>, _>(index) {
        return Ok(value.map(|v| v.format("%Y-%m-%d %H:%M:%S").to_string()));
    }
    if let Ok(value) = row.try_get::<Option<chrono::NaiveDate>, _>(index) {
        return Ok(value.map(|v| v.to_string()));
    }
    if let Ok(value) = row.try_get::<Option<chrono::NaiveTime>, _>(index) {
        return Ok(value.map(|v| v.to_string()));
    }
    if let Ok(value) = row.try_get::<Option<Vec<u8>>, _>(index) {
        return Ok(value.map(|v| decode_mysql_bytes_as_string(&v)));
    }
    Err(mysql_decode_error(
        context,
        column_name,
        Some(index),
        "unsupported value type",
    ))
}

fn decode_mysql_bytes_as_string(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

/// Like [`mysql_value_to_string`] but encodes raw bytes as hex (for ad-hoc query grids).
fn mysql_value_to_display_string(
    row: &MySqlRow,
    index: usize,
    column_name: &str,
    context: &str,
) -> Result<Option<String>, String> {
    if let Ok(value) = row.try_get::<Option<String>, _>(index) {
        return Ok(value);
    }
    if let Ok(value) = row.try_get::<Option<i64>, _>(index) {
        return Ok(value.map(|v| v.to_string()));
    }
    if let Ok(value) = row.try_get::<Option<i32>, _>(index) {
        return Ok(value.map(|v| v.to_string()));
    }
    if let Ok(value) = row.try_get::<Option<u64>, _>(index) {
        return Ok(value.map(|v| v.to_string()));
    }
    if let Ok(value) = row.try_get::<Option<f64>, _>(index) {
        return Ok(value.map(|v| v.to_string()));
    }
    if let Ok(value) = row.try_get::<Option<f32>, _>(index) {
        return Ok(value.map(|v| v.to_string()));
    }
    if let Ok(value) = row.try_get::<Option<bool>, _>(index) {
        return Ok(value.map(|v| v.to_string()));
    }
    if let Ok(value) = row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>(index) {
        return Ok(value.map(|v| v.format("%Y-%m-%d %H:%M:%S").to_string()));
    }
    if let Ok(value) = row.try_get::<Option<chrono::NaiveDateTime>, _>(index) {
        return Ok(value.map(|v| v.format("%Y-%m-%d %H:%M:%S").to_string()));
    }
    if let Ok(value) = row.try_get::<Option<chrono::NaiveDate>, _>(index) {
        return Ok(value.map(|v| v.to_string()));
    }
    if let Ok(value) = row.try_get::<Option<chrono::NaiveTime>, _>(index) {
        return Ok(value.map(|v| v.to_string()));
    }
    if let Ok(value) = row.try_get::<Option<Vec<u8>>, _>(index) {
        return Ok(value.map(|v| format!("0x{}", hex::encode(v))));
    }
    Err(mysql_decode_error(
        context,
        column_name,
        Some(index),
        "unsupported value type",
    ))
}

fn mysql_get_string(row: &MySqlRow, index: usize, column_name: &str, context: &str) -> Result<String, String> {
    let value = mysql_value_to_string(row, index, column_name, context)?;
    value.ok_or_else(|| {
        mysql_decode_error(context, column_name, Some(index), "unexpected null value")
    })
}

fn mysql_get_optional_string(
    row: &MySqlRow,
    index: usize,
    column_name: &str,
    context: &str,
) -> Result<Option<String>, String> {
    mysql_value_to_string(row, index, column_name, context)
}

fn sqlite_value_to_string(row: &SqliteRow, index: usize, column_name: &str, context: &str) -> Result<Option<String>, String> {
    if let Ok(value) = row.try_get::<Option<String>, _>(index) {
        return Ok(value);
    }
    if let Ok(value) = row.try_get::<Option<i64>, _>(index) {
        return Ok(value.map(|v| v.to_string()));
    }
    if let Ok(value) = row.try_get::<Option<f64>, _>(index) {
        return Ok(value.map(|v| v.to_string()));
    }
    if let Ok(value) = row.try_get::<Option<bool>, _>(index) {
        return Ok(value.map(|v| v.to_string()));
    }
    if let Ok(value) = row.try_get::<Option<Vec<u8>>, _>(index) {
        return Ok(value.map(|v| format!("0x{}", hex::encode(v))));
    }
    Err(sqlite_decode_error(
        context,
        column_name,
        Some(index),
        "unsupported value type",
    ))
}

fn is_row_returning_sql(sql: &str) -> bool {
    let trimmed = sql.trim_start();
    let upper = trimmed.to_uppercase();
    upper.starts_with("SELECT")
        || upper.starts_with("WITH")
        || upper.starts_with("SHOW")
        || upper.starts_with("EXPLAIN")
        || upper.starts_with("DESCRIBE")
        || upper.starts_with("DESC")
        || upper.starts_with("PRAGMA")
        || upper.starts_with("VALUES")
        || upper.starts_with("TABLE ")
}

fn map_mysql_rows(
    rows: Vec<MySqlRow>,
    max_query_rows: usize,
) -> Result<(Vec<String>, Vec<BTreeMap<String, Option<String>>>, usize, bool), String> {
    let mut columns: Vec<String> = Vec::new();
    if let Some(first) = rows.first() {
        columns = first
            .columns()
            .iter()
            .map(|column| column.name().to_string())
            .collect();
    }
    let total_rows = rows.len();
    let mut mapped_rows = Vec::new();
    for row in rows.into_iter().take(max_query_rows) {
        let mut mapped_row = BTreeMap::new();
        for (index, column_name) in columns.iter().enumerate() {
            let value = mysql_value_to_display_string(&row, index, column_name, "run_query")?;
            mapped_row.insert(column_name.clone(), value);
        }
        mapped_rows.push(mapped_row);
    }
    Ok((columns, mapped_rows, total_rows, total_rows > max_query_rows))
}

fn map_sqlite_rows(
    rows: Vec<SqliteRow>,
    max_query_rows: usize,
) -> Result<(Vec<String>, Vec<BTreeMap<String, Option<String>>>, usize, bool), String> {
    let mut columns: Vec<String> = Vec::new();
    if let Some(first) = rows.first() {
        columns = first
            .columns()
            .iter()
            .map(|column| column.name().to_string())
            .collect();
    }
    let total_rows = rows.len();
    let mut mapped_rows = Vec::new();
    for row in rows.into_iter().take(max_query_rows) {
        let mut mapped_row = BTreeMap::new();
        for (index, column_name) in columns.iter().enumerate() {
            let value = sqlite_value_to_string(&row, index, column_name, "run_query")?;
            mapped_row.insert(column_name.clone(), value);
        }
        mapped_rows.push(mapped_row);
    }
    Ok((columns, mapped_rows, total_rows, total_rows > max_query_rows))
}

async fn run_query_mysql_or_sqlite(
    app: &AppHandle,
    state: &AppState,
    connection_id: &str,
    sql: &str,
    max_query_rows: usize,
    engine: DatabaseEngine,
) -> Result<QueryResult, String> {
    let started_at = Instant::now();
    let statements = split_sql_statements(sql);
    if statements.is_empty() {
        return Err("Enter a SQL statement before running the query.".to_string());
    }

    let mut columns = Vec::new();
    let mut rows = Vec::new();
    let mut total_rows = 0usize;
    let mut truncated = false;
    let mut command_tag: Option<u64> = None;

    match engine {
        DatabaseEngine::Mysql => {
            let pool = get_or_create_mysql_pool(app, state, connection_id).await?;
            let mut conn = pool
                .acquire()
                .await
                .map_err(|error| error.to_string())?;
            for statement in statements {
                if is_row_returning_sql(&statement) {
                    let fetched = sqlx::query(&statement)
                        .fetch_all(&mut *conn)
                        .await
                        .map_err(|error| error.to_string())?;
                    let mapped = map_mysql_rows(fetched, max_query_rows)?;
                    columns = mapped.0;
                    rows = mapped.1;
                    total_rows = mapped.2;
                    truncated = mapped.3;
                    command_tag = None;
                } else {
                    let result = sqlx::query(&statement)
                        .execute(&mut *conn)
                        .await
                        .map_err(|error| error.to_string())?;
                    let affected = result.rows_affected();
                    command_tag = Some(affected);
                    if rows.is_empty() {
                        total_rows = affected as usize;
                    }
                }
            }
        }
        DatabaseEngine::Sqlite => {
            let pool = get_or_create_sqlite_pool(app, state, connection_id).await?;
            let mut conn = pool
                .acquire()
                .await
                .map_err(|error| error.to_string())?;
            for statement in statements {
                if is_row_returning_sql(&statement) {
                    let fetched = sqlx::query(&statement)
                        .fetch_all(&mut *conn)
                        .await
                        .map_err(|error| error.to_string())?;
                    let mapped = map_sqlite_rows(fetched, max_query_rows)?;
                    columns = mapped.0;
                    rows = mapped.1;
                    total_rows = mapped.2;
                    truncated = mapped.3;
                    command_tag = None;
                } else {
                    let result = sqlx::query(&statement)
                        .execute(&mut *conn)
                        .await
                        .map_err(|error| error.to_string())?;
                    let affected = result.rows_affected();
                    command_tag = Some(affected);
                    if rows.is_empty() {
                        total_rows = affected as usize;
                    }
                }
            }
        }
        DatabaseEngine::Postgres => {
            return Err("Internal engine routing error.".to_string());
        }
    }

    Ok(QueryResult {
        columns,
        row_count: if rows.is_empty() {
            total_rows
        } else {
            rows.len()
        },
        rows,
        execution_ms: started_at.elapsed().as_millis(),
        truncated,
        command_tag,
    })
}

#[tauri::command]
pub async fn connect_db(
    app: AppHandle,
    state: State<'_, AppState>,
    input: ConnectionInput,
) -> Result<ConnectionSummary, String> {
    let connection_id = input
        .id
        .clone()
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    match input.engine {
        DatabaseEngine::Postgres => {
            let pool = if let Some(ref ssh_config) = input.ssh_config {
                if ssh_config.is_active() {
                    let tunnel = match SshTunnel::connect(ssh_config, &input.host, input.port).await {
                        Ok(tunnel) => tunnel,
                        Err(e) => return Err(format!("SSH tunnel failed: {}", e)),
                    };
                    let local_port = tunnel.local_port;
                    state
                        .ssh_tunnels
                        .write()
                        .await
                        .insert(connection_id.clone(), tunnel);
                    build_pool_custom("127.0.0.1", local_port, &input)?
                } else {
                    build_pool(&input)?
                }
            } else {
                build_pool(&input)?
            };

            let client = match pool.get().await {
                Ok(client) => client,
                Err(e) => {
                    drop_pool(&state, &connection_id).await;
                    return Err(e.to_string());
                }
            };

            if let Err(e) = client.simple_query("select 1").await {
                drop_pool(&state, &connection_id).await;
                return Err(map_pg_err(e, None));
            }

            state
                .pools
                .write()
                .await
                .insert(connection_id.clone(), pool);
        }
        DatabaseEngine::Mysql => {
            let pool = if let Some(ref ssh_config) = input.ssh_config {
                if ssh_config.is_active() {
                    let remote_port = if input.port == 0 { DEFAULT_MYSQL_PORT } else { input.port };
                    let tunnel = match SshTunnel::connect(ssh_config, &input.host, remote_port).await {
                        Ok(tunnel) => tunnel,
                        Err(e) => return Err(format!("SSH tunnel failed: {}", e)),
                    };
                    let local_port = tunnel.local_port;
                    state
                        .ssh_tunnels
                        .write()
                        .await
                        .insert(connection_id.clone(), tunnel);
                    build_mysql_pool_custom("127.0.0.1", local_port, &input).await?
                } else {
                    build_mysql_pool(&input).await?
                }
            } else {
                build_mysql_pool(&input).await?
            };

            sqlx::query("select 1")
                .execute(&pool)
                .await
                .map_err(|e| e.to_string())?;

            state
                .mysql_pools
                .write()
                .await
                .insert(connection_id.clone(), pool);
        }
        DatabaseEngine::Sqlite => {
            let pool = build_sqlite_pool(&input).await?;
            sqlx::query("select 1")
                .execute(&pool)
                .await
                .map_err(|e| e.to_string())?;
            state
                .sqlite_pools
                .write()
                .await
                .insert(connection_id.clone(), pool);
        }
    }

    let stored_connection = StoredConnection::from_input(connection_id.clone(), input.clone());
    persist_connection_with_password(&app, &stored_connection, &input.password)?;

    *state.active_connection_id.write().await = Some(connection_id);

    Ok(stored_connection.summary())
}

#[tauri::command]
pub async fn list_connections_command(app: AppHandle) -> Result<Vec<ConnectionSummary>, String> {
    list_connections(&app)
}

#[tauri::command]
pub async fn set_active_connection(
    app: AppHandle,
    state: State<'_, AppState>,
    connection_id: String,
) -> Result<ConnectionSummary, String> {
    let stored_connection = load_connection(&app, &connection_id)?
        .ok_or_else(|| "Stored connection details were not found.".to_string())?;

    match stored_connection.engine {
        DatabaseEngine::Postgres => {
            with_pool_client_retry(&app, &state, &connection_id, (), |client, ()| async move {
                client
                    .simple_query("select 1")
                    .await
                    .map_err(|error| map_pg_err(error, None))?;
                Ok(())
            })
            .await?;
        }
        DatabaseEngine::Mysql => {
            let pool = get_or_create_mysql_pool(&app, &state, &connection_id).await?;
            sqlx::query("select 1")
                .execute(&pool)
                .await
                .map_err(|error| error.to_string())?;
        }
        DatabaseEngine::Sqlite => {
            let pool = get_or_create_sqlite_pool(&app, &state, &connection_id).await?;
            sqlx::query("select 1")
                .execute(&pool)
                .await
                .map_err(|error| error.to_string())?;
        }
    }

    *state.active_connection_id.write().await = Some(connection_id);

    Ok(stored_connection.summary())
}

#[tauri::command]
pub async fn ping_connection(
    app: AppHandle,
    state: State<'_, AppState>,
    connection_id: String,
) -> Result<(), String> {
    let stored_connection = load_connection(&app, &connection_id)?
        .ok_or_else(|| "Stored connection details were not found.".to_string())?;
    match stored_connection.engine {
        DatabaseEngine::Postgres => {
            with_pool_client_retry(&app, &state, &connection_id, (), |client, ()| async move {
                client
                    .simple_query("select 1")
                    .await
                    .map_err(|error| error.to_string())?;
                Ok(())
            })
            .await
        }
        DatabaseEngine::Mysql => {
            let pool = get_or_create_mysql_pool(&app, &state, &connection_id).await?;
            sqlx::query("select 1")
                .execute(&pool)
                .await
                .map_err(|error| error.to_string())?;
            Ok(())
        }
        DatabaseEngine::Sqlite => {
            let pool = get_or_create_sqlite_pool(&app, &state, &connection_id).await?;
            sqlx::query("select 1")
                .execute(&pool)
                .await
                .map_err(|error| error.to_string())?;
            Ok(())
        }
    }
}

#[tauri::command]
pub async fn refresh_connection(
    app: AppHandle,
    state: State<'_, AppState>,
    connection_id: String,
) -> Result<(), String> {
    refresh_connection_pools(&app, &state, &connection_id).await
}

#[tauri::command]
pub async fn disconnect_db(
    state: State<'_, AppState>,
    connection_id: String,
) -> Result<(), String> {
    disconnect_connection(&state, &connection_id).await;
    Ok(())
}

/// Renames a saved connection without affecting the active pool or SSH tunnel.
#[tauri::command]
pub async fn rename_connection(
    app: AppHandle,
    connection_id: String,
    new_name: String,
) -> Result<crate::models::ConnectionSummary, String> {
    crate::db::rename_connection_in_store(&app, &connection_id, &new_name)
}

#[tauri::command]
pub async fn delete_connection(
    app: AppHandle,
    state: State<'_, AppState>,
    connection_id: String,
) -> Result<(), String> {
    disconnect_connection(&state, &connection_id).await;
    if let Err(e) = credentials::delete_password(&connection_id) {
        log::warn!("Failed to delete keychain entry for {}: {}", connection_id, e);
    }
    crate::db::delete_connection_from_store(&app, &connection_id)?;
    Ok(())
}

#[tauri::command]
pub async fn list_databases(
    app: AppHandle,
    state: State<'_, AppState>,
    connection_id: Option<String>,
) -> Result<Vec<DatabaseInfo>, String> {
    let (connection_id, engine) = resolve_connection_engine(&app, &state, connection_id).await?;

    match engine {
        DatabaseEngine::Postgres => {
            with_pool_client_retry(&app, &state, &connection_id, (), |client, ()| async move {
                let rows = client
                    .query(
                        "select datname from pg_database where datistemplate = false and has_database_privilege(datname, 'CONNECT') order by datname",
                        &[],
                    )
                    .await
                    .map_err(|error| map_pg_err(error, None))?;

                Ok(rows
                    .into_iter()
                    .map(|row| {
                        let name: String = row.get(0);
                        DatabaseInfo { name }
                    })
                    .collect())
            })
            .await
        }
        DatabaseEngine::Mysql => {
            let pool = get_or_create_mysql_pool(&app, &state, &connection_id).await?;
            let rows = sqlx::query("show databases")
                .fetch_all(&pool)
                .await
                .map_err(|error| error.to_string())?;
            let mut databases = Vec::with_capacity(rows.len());
            for row in rows {
                let name = mysql_database_name_from_row(&row, "list_databases")?;
                databases.push(DatabaseInfo { name });
            }
            Ok(databases)
        }
        DatabaseEngine::Sqlite => Ok(vec![DatabaseInfo {
            name: "main".to_string(),
        }]),
    }
}

#[tauri::command]
pub async fn switch_database(
    app: AppHandle,
    state: State<'_, AppState>,
    input: SwitchDatabaseRequest,
) -> Result<ConnectionSummary, String> {
    let mut stored_connection = load_connection(&app, &input.connection_id)?
        .ok_or_else(|| "Stored connection details were not found.".to_string())?;

    if stored_connection.engine == DatabaseEngine::Sqlite {
        return Err("Switch database is not supported for SQLite connections.".to_string());
    }

    drop_pool(&state, &input.connection_id).await;

    stored_connection.database = input.database.clone();
    stored_connection.connected_at = crate::models::timestamp_string();
    persist_connection_with_password(&app, &stored_connection, &stored_connection.password.clone().unwrap_or_default())?;

    let connection_input = stored_connection.to_input();

    match connection_input.engine {
        DatabaseEngine::Postgres => {
            let pool = if let Some(ref ssh_config) = connection_input.ssh_config {
                if ssh_config.is_active() {
                    let tunnel = match SshTunnel::connect(ssh_config, &connection_input.host, connection_input.port).await {
                        Ok(tunnel) => tunnel,
                        Err(e) => return Err(format!("SSH tunnel failed: {}", e)),
                    };
                    let local_port = tunnel.local_port;
                    state
                        .ssh_tunnels
                        .write()
                        .await
                        .insert(input.connection_id.clone(), tunnel);
                    build_pool_custom("127.0.0.1", local_port, &connection_input)?
                } else {
                    build_pool(&connection_input)?
                }
            } else {
                build_pool(&connection_input)?
            };

            let client = match pool.get().await {
                Ok(client) => client,
                Err(e) => {
                    drop_pool(&state, &input.connection_id).await;
                    return Err(e.to_string());
                }
            };

            if let Err(e) = client.simple_query("select 1").await {
                drop_pool(&state, &input.connection_id).await;
                return Err(map_pg_err(e, None));
            }

            state
                .pools
                .write()
                .await
                .insert(input.connection_id.clone(), pool);
        }
        DatabaseEngine::Mysql => {
            let pool = if let Some(ref ssh_config) = connection_input.ssh_config {
                if ssh_config.is_active() {
                    let remote_port = if connection_input.port == 0 {
                        DEFAULT_MYSQL_PORT
                    } else {
                        connection_input.port
                    };
                    let tunnel = match SshTunnel::connect(ssh_config, &connection_input.host, remote_port).await {
                        Ok(tunnel) => tunnel,
                        Err(e) => return Err(format!("SSH tunnel failed: {}", e)),
                    };
                    let local_port = tunnel.local_port;
                    state
                        .ssh_tunnels
                        .write()
                        .await
                        .insert(input.connection_id.clone(), tunnel);
                    build_mysql_pool_custom("127.0.0.1", local_port, &connection_input).await?
                } else {
                    build_mysql_pool(&connection_input).await?
                }
            } else {
                build_mysql_pool(&connection_input).await?
            };

            sqlx::query("select 1")
                .execute(&pool)
                .await
                .map_err(|e| e.to_string())?;

            state
                .mysql_pools
                .write()
                .await
                .insert(input.connection_id.clone(), pool);
        }
        DatabaseEngine::Sqlite => {}
    }

    *state.active_connection_id.write().await = Some(input.connection_id);

    Ok(stored_connection.summary())
}

#[tauri::command]
pub async fn run_query(
    app: AppHandle,
    state: State<'_, AppState>,
    input: QueryRequest,
) -> Result<QueryResult, String> {
    let (connection_id, engine) = resolve_connection_engine(&app, &state, input.connection_id).await?;
    let sql = input.sql.trim().to_string();

    if sql.is_empty() {
        return Err("Enter a SQL statement before running the query.".to_string());
    }

    let max_query_rows = input.max_rows.unwrap_or(MAX_QUERY_ROWS);

    match engine {
        DatabaseEngine::Postgres => {
            with_pool_client_retry(&app, &state, &connection_id, sql, |client, sql| async move {
                let started_at = Instant::now();
                let messages = client
                    .simple_query(&sql)
                    .await
                    .map_err(|error| map_pg_err(error, Some(sql.as_str())))?;

                let mut columns = Vec::new();
                let mut rows = Vec::new();
                let mut total_rows = 0usize;
                let mut command_tag = None;

                for message in messages {
                    match message {
                        SimpleQueryMessage::RowDescription(description) => {
                            if columns.is_empty() {
                                columns = description
                                    .iter()
                                    .map(|column| column.name().to_string())
                                    .collect();
                            }
                        }
                        SimpleQueryMessage::Row(row) => {
                            total_rows += 1;

                            if columns.is_empty() {
                                columns = row
                                    .columns()
                                    .iter()
                                    .map(|column| column.name().to_string())
                                    .collect();
                            }

                            if rows.len() >= max_query_rows {
                                continue;
                            }

                            let mut mapped_row = BTreeMap::new();
                            for (index, column_name) in columns.iter().enumerate() {
                                mapped_row.insert(column_name.clone(), row.get(index).map(str::to_owned));
                            }
                            rows.push(mapped_row);
                        }
                        SimpleQueryMessage::CommandComplete(count) => {
                            command_tag = Some(count);
                        }
                        _ => {}
                    }
                }

                Ok(QueryResult {
                    columns,
                    row_count: rows.len(),
                    rows,
                    execution_ms: started_at.elapsed().as_millis(),
                    truncated: total_rows > max_query_rows,
                    command_tag,
                })
            })
            .await
        }
        DatabaseEngine::Mysql | DatabaseEngine::Sqlite => {
            run_query_mysql_or_sqlite(&app, &state, &connection_id, &sql, max_query_rows, engine).await
        }
    }
}

async fn fetch_query_editor_metadata_for_connection(
    app: &AppHandle,
    state: &AppState,
    connection_id: &str,
    engine: DatabaseEngine,
) -> Result<QueryEditorMetadata, String> {
    if engine == DatabaseEngine::Mysql {
        let pool = get_or_create_mysql_pool(app, state, connection_id).await?;
        let database = load_connection(app, connection_id)?
            .map(|connection| connection.database)
            .unwrap_or_default();
        let table_rows = sqlx::query(
            "
            select table_schema, table_name
            from information_schema.tables
            where table_type = 'BASE TABLE'
              and table_schema = ?
              and table_schema not in ('information_schema', 'mysql', 'performance_schema', 'sys')
            order by table_schema, table_name
            limit ?
            ",
        )
        .bind(&database)
        .bind(MAX_EDITOR_TABLES + 1)
        .fetch_all(&pool)
        .await
        .map_err(|error| error.to_string())?;

        let truncated_tables = table_rows.len() as i64 > MAX_EDITOR_TABLES;
        let mut tables = Vec::new();
        let mut truncated_columns = false;

        for row in table_rows.into_iter().take(MAX_EDITOR_TABLES as usize) {
            let schema: String = mysql_get_string(&row, 0, "table_schema", "get_query_editor_metadata")?;
            let name: String = mysql_get_string(&row, 1, "table_name", "get_query_editor_metadata")?;
            let column_rows = sqlx::query(
                "
                select column_name, data_type
                from information_schema.columns
                where table_schema = ? and table_name = ?
                order by ordinal_position
                limit ?
                ",
            )
            .bind(&schema)
            .bind(&name)
            .bind(MAX_EDITOR_COLUMNS_PER_TABLE + 1)
            .fetch_all(&pool)
            .await
            .map_err(|error| error.to_string())?;
            if column_rows.len() as i64 > MAX_EDITOR_COLUMNS_PER_TABLE {
                truncated_columns = true;
            }
            let mut columns = Vec::new();
            for column in column_rows.into_iter().take(MAX_EDITOR_COLUMNS_PER_TABLE as usize) {
                columns.push(QueryEditorColumn {
                    name: mysql_get_string(&column, 0, "column_name", "get_query_editor_metadata")?,
                    data_type: mysql_get_string(&column, 1, "data_type", "get_query_editor_metadata")?,
                });
            }
            tables.push(QueryEditorTable { schema, name, columns });
        }

        return Ok(QueryEditorMetadata {
            tables,
            functions: Vec::new(),
            truncated_tables,
            truncated_columns,
            truncated_functions: false,
        });
    }

    if engine == DatabaseEngine::Sqlite {
        let pool = get_or_create_sqlite_pool(app, state, connection_id).await?;
        let table_rows = sqlx::query(
            "
            select name
            from sqlite_master
            where type = 'table'
              and name not like 'sqlite_%'
            order by name
            limit ?
            ",
        )
        .bind(MAX_EDITOR_TABLES + 1)
        .fetch_all(&pool)
        .await
        .map_err(|error| error.to_string())?;
        let truncated_tables = table_rows.len() as i64 > MAX_EDITOR_TABLES;
        let mut tables = Vec::new();
        let mut truncated_columns = false;
        for row in table_rows.into_iter().take(MAX_EDITOR_TABLES as usize) {
            let name: String = sqlite_get_idx(&row, 0, "name", "get_query_editor_metadata")?;
            let pragma_sql = format!("PRAGMA table_info(\"{}\");", quote_identifier(&name));
            let column_rows = sqlx::query(&pragma_sql)
                .fetch_all(&pool)
                .await
                .map_err(|error| error.to_string())?;
            if column_rows.len() as i64 > MAX_EDITOR_COLUMNS_PER_TABLE {
                truncated_columns = true;
            }
            let mut columns = Vec::new();
            for column in column_rows.into_iter().take(MAX_EDITOR_COLUMNS_PER_TABLE as usize) {
                columns.push(QueryEditorColumn {
                    name: sqlite_get_name(&column, "name", "get_query_editor_metadata")?,
                    data_type: sqlite_get_name(&column, "type", "get_query_editor_metadata")?,
                });
            }
            tables.push(QueryEditorTable {
                schema: "main".to_string(),
                name,
                columns,
            });
        }
        return Ok(QueryEditorMetadata {
            tables,
            functions: Vec::new(),
            truncated_tables,
            truncated_columns,
            truncated_functions: false,
        });
    }

    with_pool_client_retry(app, state, connection_id, (), |client, ()| async move {
        let table_rows = client
            .query(
                "
            select n.nspname::text as schema_name, c.relname::text as table_name
            from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
            where c.relkind in ('r', 'p', 'v', 'm', 'f')
              and n.nspname not in ('pg_catalog', 'information_schema')
            order by n.nspname, c.relname
            limit $1
            ",
                &[&(MAX_EDITOR_TABLES + 1)],
            )
            .await
            .map_err(|error| map_pg_err(error, None))?;

        let truncated_tables = table_rows.len() as i64 > MAX_EDITOR_TABLES;
        let table_rows = if truncated_tables {
            table_rows
                .into_iter()
                .take(MAX_EDITOR_TABLES as usize)
                .collect::<Vec<_>>()
        } else {
            table_rows
        };

        let mut tables = Vec::with_capacity(table_rows.len());
        let mut truncated_columns = false;

        for row in table_rows {
            let schema: String = row.get(0);
            let name: String = row.get(1);
            let column_rows = client
                .query(
                    "
                select a.attname::text as column_name,
                       format_type(a.atttypid, a.atttypmod)::text as data_type
                from pg_attribute a
                join pg_class c on c.oid = a.attrelid
                join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = $1
                  and c.relname = $2
                  and a.attnum > 0
                  and not a.attisdropped
                order by a.attnum
                limit $3
                ",
                    &[&schema, &name, &(MAX_EDITOR_COLUMNS_PER_TABLE + 1)],
                )
                .await
                .map_err(|error| map_pg_err(error, None))?;

            let columns_exceeded = column_rows.len() as i64 > MAX_EDITOR_COLUMNS_PER_TABLE;
            if columns_exceeded {
                truncated_columns = true;
            }
            let columns = column_rows
                .into_iter()
                .take(MAX_EDITOR_COLUMNS_PER_TABLE as usize)
                .map(|column| QueryEditorColumn {
                    name: column.get(0),
                    data_type: column.get(1),
                })
                .collect();

            tables.push(QueryEditorTable {
                schema,
                name,
                columns,
            });
        }

        let function_rows = client
            .query(
                "
            select
              n.nspname::text as schema_name,
              p.proname::text as function_name,
              coalesce(pg_get_function_identity_arguments(p.oid), '')::text as args,
              pg_get_function_result(p.oid)::text as return_type
            from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
            where n.nspname not in ('pg_catalog', 'information_schema')
            order by n.nspname, p.proname
            limit $1
            ",
                &[&(MAX_EDITOR_FUNCTIONS + 1)],
            )
            .await
            .map_err(|error| map_pg_err(error, None))?;

        let truncated_functions = function_rows.len() as i64 > MAX_EDITOR_FUNCTIONS;
        let functions = function_rows
            .into_iter()
            .take(MAX_EDITOR_FUNCTIONS as usize)
            .map(|row| {
                let args_raw: String = row.get(2);
                QueryEditorFunction {
                    schema: row.get(0),
                    name: row.get(1),
                    arg_types: if args_raw.trim().is_empty() {
                        Vec::new()
                    } else {
                        args_raw
                            .split(',')
                            .map(|value| value.trim().to_string())
                            .collect()
                    },
                    return_type: row.get(3),
                }
            })
            .collect();

        Ok(QueryEditorMetadata {
            tables,
            functions,
            truncated_tables,
            truncated_columns,
            truncated_functions,
        })
    })
    .await
}

async fn fetch_foreign_keys_for_connection(
    app: &AppHandle,
    state: &AppState,
    connection_id: &str,
    engine: DatabaseEngine,
) -> Result<Vec<ForeignKeyEdge>, String> {
    if engine == DatabaseEngine::Mysql {
        let pool = get_or_create_mysql_pool(app, state, connection_id).await?;
        let rows = sqlx::query(
            "
            select
              kcu.table_schema as from_schema,
              kcu.table_name as from_table,
              kcu.column_name as from_column,
              kcu.referenced_table_schema as to_schema,
              kcu.referenced_table_name as to_table,
              kcu.referenced_column_name as to_column
            from information_schema.key_column_usage kcu
            where kcu.referenced_table_name is not null
            order by kcu.table_schema, kcu.table_name, kcu.ordinal_position
            limit ?
            ",
        )
        .bind(MAX_FOREIGN_KEY_ROWS)
        .fetch_all(&pool)
        .await
        .map_err(|error| error.to_string())?;
        let mut edges = Vec::new();
        for row in rows {
            edges.push(ForeignKeyEdge {
                from_schema: mysql_get_string(&row, 0, "from_schema", "get_foreign_keys")?,
                from_table: mysql_get_string(&row, 1, "from_table", "get_foreign_keys")?,
                from_column: mysql_get_string(&row, 2, "from_column", "get_foreign_keys")?,
                to_schema: mysql_get_string(&row, 3, "to_schema", "get_foreign_keys")?,
                to_table: mysql_get_string(&row, 4, "to_table", "get_foreign_keys")?,
                to_column: mysql_get_string(&row, 5, "to_column", "get_foreign_keys")?,
            });
        }
        return Ok(edges);
    }

    if engine == DatabaseEngine::Sqlite {
        let pool = get_or_create_sqlite_pool(app, state, connection_id).await?;
        let tables = sqlx::query(
            "
            select name
            from sqlite_master
            where type = 'table'
              and name not like 'sqlite_%'
            ",
        )
        .fetch_all(&pool)
        .await
        .map_err(|error| error.to_string())?;
        let mut edges = Vec::new();
        for table in tables {
            let table_name: String = sqlite_get_idx(&table, 0, "name", "get_foreign_keys")?;
            let fk_sql = format!("PRAGMA foreign_key_list(\"{}\");", quote_identifier(&table_name));
            let fk_rows = sqlx::query(&fk_sql)
                .fetch_all(&pool)
                .await
                .map_err(|error| error.to_string())?;
            for row in fk_rows {
                edges.push(ForeignKeyEdge {
                    from_schema: "main".to_string(),
                    from_table: table_name.clone(),
                    from_column: sqlite_get_name(&row, "from", "get_foreign_keys")?,
                    to_schema: "main".to_string(),
                    to_table: sqlite_get_name(&row, "table", "get_foreign_keys")?,
                    to_column: sqlite_get_name(&row, "to", "get_foreign_keys")?,
                });
                if edges.len() >= MAX_FOREIGN_KEY_ROWS as usize {
                    return Ok(edges);
                }
            }
        }
        return Ok(edges);
    }

    with_pool_client_retry(app, state, connection_id, (), |client, ()| async move {
        let rows = client
            .query(
                "
            select
              src_ns.nspname::text as from_schema,
              src_cls.relname::text as from_table,
              src_att.attname::text as from_column,
              tgt_ns.nspname::text as to_schema,
              tgt_cls.relname::text as to_table,
              tgt_att.attname::text as to_column
            from pg_constraint c
            join pg_class src_cls on src_cls.oid = c.conrelid
            join pg_namespace src_ns on src_ns.oid = src_cls.relnamespace
            join pg_class tgt_cls on tgt_cls.oid = c.confrelid
            join pg_namespace tgt_ns on tgt_ns.oid = tgt_cls.relnamespace
            cross join lateral unnest(c.conkey, c.confkey) as u(attnum, confattnum)
            join pg_attribute src_att
              on src_att.attrelid = c.conrelid
             and src_att.attnum = u.attnum
             and not src_att.attisdropped
            join pg_attribute tgt_att
              on tgt_att.attrelid = c.confrelid
             and tgt_att.attnum = u.confattnum
             and not tgt_att.attisdropped
            where c.contype = 'f'
              and src_ns.nspname not in ('pg_catalog', 'information_schema')
            order by src_ns.nspname, src_cls.relname, c.conname, u.attnum
            limit $1
            ",
                &[&MAX_FOREIGN_KEY_ROWS],
            )
            .await
            .map_err(|error| error.to_string())?;

        Ok(rows
            .into_iter()
            .map(|row| ForeignKeyEdge {
                from_schema: row.get(0),
                from_table: row.get(1),
                from_column: row.get(2),
                to_schema: row.get(3),
                to_table: row.get(4),
                to_column: row.get(5),
            })
            .collect())
    })
    .await
}

fn ask_veloxy_context_cache_key(connection_id: &str, database_name: &str) -> String {
    format!("{}::{}", connection_id, database_name)
}

fn ask_veloxy_conversation_key(connection_id: &str, database_name: &str) -> String {
    format!("{}::{}", connection_id, database_name)
}

fn now_epoch_seconds() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

async fn get_or_build_ask_veloxy_db_context(
    app: &AppHandle,
    state: &AppState,
    connection_id: &str,
    engine: DatabaseEngine,
) -> Result<AskVeloxyDbContextCache, String> {
    let stored_connection = load_connection(app, connection_id)?
        .ok_or_else(|| "Stored connection details were not found.".to_string())?;
    let cache_key = ask_veloxy_context_cache_key(connection_id, &stored_connection.database);
    if let Some(cached) = state
        .ask_veloxy_db_context_cache
        .read()
        .await
        .get(&cache_key)
        .cloned()
    {
        return Ok(cached);
    }

    let metadata = fetch_query_editor_metadata_for_connection(app, state, connection_id, engine).await?;
    let foreign_keys = fetch_foreign_keys_for_connection(app, state, connection_id, engine).await?;
    let cache = AskVeloxyDbContextCache {
        database_name: stored_connection.database,
        engine,
        metadata,
        foreign_keys,
    };
    state
        .ask_veloxy_db_context_cache
        .write()
        .await
        .insert(cache_key, cache.clone());
    Ok(cache)
}

fn extract_sql_draft_from_text(message: &str) -> Option<String> {
    let lowered = message.to_lowercase();
    let markers = ["select ", "with ", "insert ", "update ", "delete ", "explain "];
    let start = markers
        .iter()
        .filter_map(|marker| lowered.find(marker))
        .min()?;
    let mut sql = message[start..].trim().to_string();
    if let Some(idx) = sql.find("```") {
        sql.truncate(idx);
    }
    if sql.ends_with('.') {
        sql.pop();
    }
    if sql.is_empty() {
        None
    } else {
        Some(sql)
    }
}

fn parse_bool_field(value: &Value, field: &str, default: bool) -> bool {
    value.get(field).and_then(Value::as_bool).unwrap_or(default)
}

#[tauri::command]
pub async fn get_query_editor_metadata(
    app: AppHandle,
    state: State<'_, AppState>,
    connection_id: Option<String>,
) -> Result<QueryEditorMetadata, String> {
    let (connection_id, engine) = resolve_connection_engine(&app, &state, connection_id).await?;

    if engine == DatabaseEngine::Mysql {
        let pool = get_or_create_mysql_pool(&app, &state, &connection_id).await?;
        let database = load_connection(&app, &connection_id)?
            .map(|connection| connection.database)
            .unwrap_or_default();
        let table_rows = sqlx::query(
            "
            select table_schema, table_name
            from information_schema.tables
            where table_type = 'BASE TABLE'
              and table_schema = ?
              and table_schema not in ('information_schema', 'mysql', 'performance_schema', 'sys')
            order by table_schema, table_name
            limit ?
            ",
        )
        .bind(&database)
        .bind(MAX_EDITOR_TABLES + 1)
        .fetch_all(&pool)
        .await
        .map_err(|error| error.to_string())?;

        let truncated_tables = table_rows.len() as i64 > MAX_EDITOR_TABLES;
        let mut tables = Vec::new();
        let mut truncated_columns = false;

        for row in table_rows.into_iter().take(MAX_EDITOR_TABLES as usize) {
            let schema: String = mysql_get_string(&row, 0, "table_schema", "get_query_editor_metadata")?;
            let name: String = mysql_get_string(&row, 1, "table_name", "get_query_editor_metadata")?;
            let column_rows = sqlx::query(
                "
                select column_name, data_type
                from information_schema.columns
                where table_schema = ? and table_name = ?
                order by ordinal_position
                limit ?
                ",
            )
            .bind(&schema)
            .bind(&name)
            .bind(MAX_EDITOR_COLUMNS_PER_TABLE + 1)
            .fetch_all(&pool)
            .await
            .map_err(|error| error.to_string())?;
            if column_rows.len() as i64 > MAX_EDITOR_COLUMNS_PER_TABLE {
                truncated_columns = true;
            }
            let mut columns = Vec::new();
            for column in column_rows.into_iter().take(MAX_EDITOR_COLUMNS_PER_TABLE as usize) {
                columns.push(QueryEditorColumn {
                    name: mysql_get_string(&column, 0, "column_name", "get_query_editor_metadata")?,
                    data_type: mysql_get_string(&column, 1, "data_type", "get_query_editor_metadata")?,
                });
            }
            tables.push(QueryEditorTable { schema, name, columns });
        }

        return Ok(QueryEditorMetadata {
            tables,
            functions: Vec::new(),
            truncated_tables,
            truncated_columns,
            truncated_functions: false,
        });
    }

    if engine == DatabaseEngine::Sqlite {
        let pool = get_or_create_sqlite_pool(&app, &state, &connection_id).await?;
        let table_rows = sqlx::query(
            "
            select name
            from sqlite_master
            where type = 'table'
              and name not like 'sqlite_%'
            order by name
            limit ?
            ",
        )
        .bind(MAX_EDITOR_TABLES + 1)
        .fetch_all(&pool)
        .await
        .map_err(|error| error.to_string())?;
        let truncated_tables = table_rows.len() as i64 > MAX_EDITOR_TABLES;
        let mut tables = Vec::new();
        let mut truncated_columns = false;
        for row in table_rows.into_iter().take(MAX_EDITOR_TABLES as usize) {
            let name: String = sqlite_get_idx(&row, 0, "name", "get_query_editor_metadata")?;
            let pragma_sql = format!("PRAGMA table_info(\"{}\");", quote_identifier(&name));
            let column_rows = sqlx::query(&pragma_sql)
                .fetch_all(&pool)
                .await
                .map_err(|error| error.to_string())?;
            if column_rows.len() as i64 > MAX_EDITOR_COLUMNS_PER_TABLE {
                truncated_columns = true;
            }
            let mut columns = Vec::new();
            for column in column_rows.into_iter().take(MAX_EDITOR_COLUMNS_PER_TABLE as usize) {
                columns.push(QueryEditorColumn {
                    name: sqlite_get_name(&column, "name", "get_query_editor_metadata")?,
                    data_type: sqlite_get_name(&column, "type", "get_query_editor_metadata")?,
                });
            }
            tables.push(QueryEditorTable {
                schema: "main".to_string(),
                name,
                columns,
            });
        }
        return Ok(QueryEditorMetadata {
            tables,
            functions: Vec::new(),
            truncated_tables,
            truncated_columns,
            truncated_functions: false,
        });
    }

    with_pool_client_retry(&app, &state, &connection_id, (), |client, ()| async move {
        let table_rows = client
            .query(
                "
            select n.nspname::text as schema_name, c.relname::text as table_name
            from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
            where c.relkind in ('r', 'p', 'v', 'm', 'f')
              and n.nspname not in ('pg_catalog', 'information_schema')
            order by n.nspname, c.relname
            limit $1
            ",
                &[&(MAX_EDITOR_TABLES + 1)],
            )
            .await
            .map_err(|error| map_pg_err(error, None))?;

        let truncated_tables = table_rows.len() as i64 > MAX_EDITOR_TABLES;
        let table_rows = if truncated_tables {
            table_rows
                .into_iter()
                .take(MAX_EDITOR_TABLES as usize)
                .collect::<Vec<_>>()
        } else {
            table_rows
        };

        let mut tables = Vec::with_capacity(table_rows.len());
        let mut truncated_columns = false;

        for row in table_rows {
            let schema: String = row.get(0);
            let name: String = row.get(1);
            let column_rows = client
                .query(
                    "
                select a.attname::text as column_name,
                       format_type(a.atttypid, a.atttypmod)::text as data_type
                from pg_attribute a
                join pg_class c on c.oid = a.attrelid
                join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = $1
                  and c.relname = $2
                  and a.attnum > 0
                  and not a.attisdropped
                order by a.attnum
                limit $3
                ",
                    &[&schema, &name, &(MAX_EDITOR_COLUMNS_PER_TABLE + 1)],
                )
                .await
                .map_err(|error| map_pg_err(error, None))?;

            let columns_exceeded = column_rows.len() as i64 > MAX_EDITOR_COLUMNS_PER_TABLE;
            if columns_exceeded {
                truncated_columns = true;
            }
            let columns = column_rows
                .into_iter()
                .take(MAX_EDITOR_COLUMNS_PER_TABLE as usize)
                .map(|column| QueryEditorColumn {
                    name: column.get(0),
                    data_type: column.get(1),
                })
                .collect();

            tables.push(QueryEditorTable {
                schema,
                name,
                columns,
            });
        }

        let function_rows = client
            .query(
                "
            select
              n.nspname::text as schema_name,
              p.proname::text as function_name,
              coalesce(pg_get_function_identity_arguments(p.oid), '')::text as args,
              pg_get_function_result(p.oid)::text as return_type
            from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
            where n.nspname not in ('pg_catalog', 'information_schema')
            order by n.nspname, p.proname
            limit $1
            ",
                &[&(MAX_EDITOR_FUNCTIONS + 1)],
            )
            .await
            .map_err(|error| map_pg_err(error, None))?;

        let truncated_functions = function_rows.len() as i64 > MAX_EDITOR_FUNCTIONS;
        let functions = function_rows
            .into_iter()
            .take(MAX_EDITOR_FUNCTIONS as usize)
            .map(|row| {
                let args_raw: String = row.get(2);
                QueryEditorFunction {
                    schema: row.get(0),
                    name: row.get(1),
                    arg_types: if args_raw.trim().is_empty() {
                        Vec::new()
                    } else {
                        args_raw
                            .split(',')
                            .map(|value| value.trim().to_string())
                            .collect()
                    },
                    return_type: row.get(3),
                }
            })
            .collect();

        Ok(QueryEditorMetadata {
            tables,
            functions,
            truncated_tables,
            truncated_columns,
            truncated_functions,
        })
    })
    .await
}

fn estimate_tokens(chars: usize) -> usize {
    // Lightweight estimate good enough for budget telemetry.
    (chars / 4).max(1)
}

fn normalize_openrouter_base(base: Option<&str>) -> String {
    let trimmed = base.unwrap_or("https://openrouter.ai/api/v1").trim();
    let value = if trimmed.is_empty() {
        "https://openrouter.ai/api/v1"
    } else {
        trimmed
    };
    value.trim_end_matches('/').to_string()
}

fn truncate_on_char_boundary(value: &mut String, max_bytes: usize) {
    if value.len() <= max_bytes {
        return;
    }
    let mut truncate_at = max_bytes;
    while !value.is_char_boundary(truncate_at) && truncate_at > 0 {
        truncate_at -= 1;
    }
    value.truncate(truncate_at);
}

fn table_matches_target(table: &QueryEditorTable, target: Option<&AskVeloxyTableRef>) -> bool {
    let Some(target) = target else {
        return false;
    };
    table.schema.eq_ignore_ascii_case(&target.schema) && table.name.eq_ignore_ascii_case(&target.name)
}

fn table_relevance_score(table: &QueryEditorTable, prompt_lower: &str) -> usize {
    let mut score = 0usize;
    let full_name = format!("{}.{}", table.schema.to_lowercase(), table.name.to_lowercase());
    if prompt_lower.contains(&table.name.to_lowercase()) {
        score += 3;
    }
    if prompt_lower.contains(&table.schema.to_lowercase()) {
        score += 2;
    }
    if prompt_lower.contains(&full_name) {
        score += 4;
    }
    score
}

fn relationship_relevance_score(edge: &ForeignKeyEdge, prompt_lower: &str) -> usize {
    let from_name = format!("{}.{}", edge.from_schema.to_lowercase(), edge.from_table.to_lowercase());
    let to_name = format!("{}.{}", edge.to_schema.to_lowercase(), edge.to_table.to_lowercase());
    let mut score = 0usize;
    if prompt_lower.contains(&edge.from_table.to_lowercase()) || prompt_lower.contains(&from_name) {
        score += 2;
    }
    if prompt_lower.contains(&edge.to_table.to_lowercase()) || prompt_lower.contains(&to_name) {
        score += 2;
    }
    score
}

fn build_schema_context(
    db_context: &AskVeloxyDbContextCache,
    prompt: &str,
    target_table: Option<&AskVeloxyTableRef>,
) -> String {
    let prompt_lower = prompt.to_lowercase();
    let mut ranked: Vec<(&QueryEditorTable, usize, bool)> = db_context
        .metadata
        .tables
        .iter()
        .map(|table| {
            (
                table,
                table_relevance_score(table, &prompt_lower),
                table_matches_target(table, target_table),
            )
        })
        .collect();

    ranked.sort_by(|a, b| b.2.cmp(&a.2).then_with(|| b.1.cmp(&a.1)));

    let mut schema_context = String::new();
    schema_context.push_str(&format!(
        "database {} engine {:?}\n",
        db_context.database_name, db_context.engine
    ));
    for (table, _score, _is_target) in ranked.into_iter().take(ASK_VELOXY_MAX_CONTEXT_TABLES) {
        let columns = table
            .columns
            .iter()
            .take(ASK_VELOXY_MAX_CONTEXT_COLUMNS)
            .map(|column| format!("{}:{}", column.name, column.data_type))
            .collect::<Vec<_>>()
            .join(", ");
        schema_context.push_str(&format!(
            "table {}.{} columns [{}]\n",
            table.schema, table.name, columns
        ));
        if schema_context.len() >= ASK_VELOXY_SCHEMA_CHAR_BUDGET {
            truncate_on_char_boundary(&mut schema_context, ASK_VELOXY_SCHEMA_CHAR_BUDGET);
            break;
        }
    }

    let mut ranked_relationships = db_context
        .foreign_keys
        .iter()
        .map(|edge| (edge, relationship_relevance_score(edge, &prompt_lower)))
        .collect::<Vec<_>>();
    ranked_relationships.sort_by(|a, b| b.1.cmp(&a.1));
    for (edge, _score) in ranked_relationships
        .into_iter()
        .take(ASK_VELOXY_MAX_CONTEXT_RELATIONSHIPS)
    {
        schema_context.push_str(&format!(
            "relationship {}.{}({}) -> {}.{}({})\n",
            edge.from_schema,
            edge.from_table,
            edge.from_column,
            edge.to_schema,
            edge.to_table,
            edge.to_column
        ));
        if schema_context.len() >= ASK_VELOXY_SCHEMA_CHAR_BUDGET {
            truncate_on_char_boundary(&mut schema_context, ASK_VELOXY_SCHEMA_CHAR_BUDGET);
            break;
        }
    }
    schema_context
}

fn classify_sql_intent(sql: &str) -> String {
    let normalized = sql.trim_start().to_ascii_lowercase();
    if normalized.starts_with("select") || normalized.starts_with("with") {
        return "select".to_string();
    }
    if normalized.starts_with("insert") {
        return "insert".to_string();
    }
    if normalized.starts_with("update") {
        return "update".to_string();
    }
    if normalized.starts_with("delete") {
        return "delete".to_string();
    }
    if normalized.starts_with("explain") {
        return "explain".to_string();
    }
    "unknown".to_string()
}

fn has_multiple_statements(sql: &str) -> bool {
    let statements = sql
        .split(';')
        .map(str::trim)
        .filter(|segment| !segment.is_empty())
        .count();
    statements > 1
}

fn validate_generated_sql(sql: &str) -> Result<(), String> {
    let trimmed = sql.trim();
    if trimmed.is_empty() {
        return Err("Ask Veloxy returned an empty SQL statement.".to_string());
    }
    if has_multiple_statements(trimmed) {
        return Err("Ask Veloxy generated multiple SQL statements. Please ask for a single statement.".to_string());
    }
    Ok(())
}

fn extract_openrouter_message_content(payload: &Value) -> Result<String, String> {
    let content_value = payload
        .get("choices")
        .and_then(|choices| choices.get(0))
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("content"))
        .ok_or_else(|| "OpenRouter response missing choices[0].message.content".to_string())?;

    if let Some(content) = content_value.as_str() {
        return Ok(content.to_string());
    }

    if let Some(items) = content_value.as_array() {
        let mut merged = String::new();
        for item in items {
            if let Some(text) = item.get("text").and_then(Value::as_str) {
                merged.push_str(text);
            }
        }
        if !merged.trim().is_empty() {
            return Ok(merged);
        }
    }

    Err("OpenRouter returned an unsupported message format.".to_string())
}

fn parse_ask_veloxy_json(content: &str) -> Result<Value, String> {
    if let Ok(value) = serde_json::from_str::<Value>(content) {
        return Ok(value);
    }
    let start = content.find('{');
    let end = content.rfind('}');
    match (start, end) {
        (Some(start_idx), Some(end_idx)) if end_idx > start_idx => {
            serde_json::from_str::<Value>(&content[start_idx..=end_idx])
                .map_err(|error| format!("Ask Veloxy response was not valid JSON: {}", error))
        }
        _ => Err("Ask Veloxy response did not contain JSON.".to_string()),
    }
}

fn parse_ask_veloxy_suggestions(generated: &Value) -> Vec<String> {
    generated
        .get("suggestions")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|item| !item.is_empty())
                .take(5)
                .map(|item| {
                    let mut value = item.to_string();
                    truncate_on_char_boundary(&mut value, 200);
                    value
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn parse_ask_veloxy_chat_json(content: &str) -> Result<Value, String> {
    if let Ok(value) = serde_json::from_str::<Value>(content) {
        return Ok(value);
    }
    let start = content.find('{');
    let end = content.rfind('}');
    match (start, end) {
        (Some(start_idx), Some(end_idx)) if end_idx > start_idx => {
            serde_json::from_str::<Value>(&content[start_idx..=end_idx])
                .map_err(|error| format!("Ask Veloxy chat JSON was invalid: {}", error))
        }
        _ => Err("Ask Veloxy chat response did not contain JSON.".to_string()),
    }
}

fn decode_json_quoted_string(value: &str) -> Option<String> {
    serde_json::from_str::<String>(&format!("\"{}\"", value)).ok()
}

fn unescape_json_string_fragment(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut chars = raw.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\\' {
            match chars.next() {
                Some('n') => out.push('\n'),
                Some('t') => out.push('\t'),
                Some('r') => out.push('\r'),
                Some('"') => out.push('"'),
                Some('\\') => out.push('\\'),
                Some(other) => {
                    out.push('\\');
                    out.push(other);
                }
                None => out.push('\\'),
            }
        } else {
            out.push(ch);
        }
    }
    out
}

fn extract_json_string_field(content: &str, key: &str, allow_partial: bool) -> Option<String> {
    let marker = format!("\"{}\"", key);
    let marker_idx = content.find(&marker)?;
    let mut idx = marker_idx + marker.len();
    let bytes = content.as_bytes();

    while idx < bytes.len() && bytes[idx].is_ascii_whitespace() {
        idx += 1;
    }
    if idx >= bytes.len() || bytes[idx] != b':' {
        return None;
    }
    idx += 1;
    while idx < bytes.len() && bytes[idx].is_ascii_whitespace() {
        idx += 1;
    }
    if idx >= bytes.len() || bytes[idx] != b'"' {
        return None;
    }
    idx += 1;
    let start = idx;
    let mut escaped = false;
    while idx < bytes.len() {
        let byte = bytes[idx];
        if escaped {
            escaped = false;
            idx += 1;
            continue;
        }
        if byte == b'\\' {
            escaped = true;
            idx += 1;
            continue;
        }
        if byte == b'"' {
            let raw = &content[start..idx];
            return decode_json_quoted_string(raw)
                .or_else(|| Some(unescape_json_string_fragment(raw)))
                .map(|text| text.trim().to_string())
                .filter(|text| !text.is_empty());
        }
        idx += 1;
    }

    if allow_partial && start < bytes.len() {
        let raw = &content[start..];
        let text = unescape_json_string_fragment(raw).trim().to_string();
        if !text.is_empty() {
            return Some(text);
        }
    }
    None
}

fn extract_message_from_loose_json(content: &str) -> Option<String> {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return None;
    }
    let unwrapped = trimmed
        .strip_prefix("```json")
        .or_else(|| trimmed.strip_prefix("```JSON"))
        .map(str::trim_start)
        .unwrap_or(trimmed);
    let unwrapped = unwrapped.strip_suffix("```").unwrap_or(unwrapped).trim();

    ["message", "reply", "content"]
        .iter()
        .find_map(|key| extract_json_string_field(unwrapped, key, false))
        .or_else(|| {
            ["message", "reply", "content"]
                .iter()
                .find_map(|key| extract_json_string_field(unwrapped, key, true))
        })
}

fn looks_like_json_response(content: &str) -> bool {
    let trimmed = content.trim_start();
    trimmed.starts_with('{') || trimmed.starts_with("```")
}

fn streaming_display_text(accumulated: &str) -> String {
    let trimmed = accumulated.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    if let Some(text) = extract_message_from_loose_json(trimmed) {
        return text;
    }
    if !looks_like_json_response(trimmed) {
        return trimmed.to_string();
    }
    String::new()
}

fn parse_chat_message(value: &Value) -> Option<String> {
    if let Some(text) = value
        .as_str()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
    {
        return Some(text);
    }
    value
        .get("message")
        .and_then(Value::as_str)
        .or_else(|| value.get("reply").and_then(Value::as_str))
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
}

type ParsedAskVeloxyChat = (
    String,
    Vec<String>,
    Vec<String>,
    Option<String>,
    bool,
    bool,
);

fn parse_ask_veloxy_chat_content(message_content: &str) -> ParsedAskVeloxyChat {
    match parse_ask_veloxy_chat_json(message_content) {
        Ok(value) => {
            let message =
                parse_chat_message(&value).unwrap_or_else(|| message_content.trim().to_string());
            let mut draft = value
                .get("sqlDraft")
                .and_then(Value::as_str)
                .or_else(|| value.get("sql_draft").and_then(Value::as_str))
                .map(str::trim)
                .filter(|text| !text.is_empty())
                .map(str::to_string);
            if draft.is_none() {
                draft = extract_sql_draft_from_text(&message);
            }
            let suggestions = value
                .get("suggestions")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(Value::as_str)
                        .map(str::trim)
                        .filter(|text| !text.is_empty())
                        .take(5)
                        .map(str::to_string)
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            let warnings = value
                .get("warnings")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(Value::as_str)
                        .map(str::to_string)
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            let needs_sql_generation = parse_bool_field(&value, "needsSqlGeneration", draft.is_some());
            let needs_clarification = parse_bool_field(&value, "needsClarification", false);
            (
                message,
                suggestions,
                warnings,
                draft,
                needs_sql_generation,
                needs_clarification,
            )
        }
        Err(_) => {
            let normalized_message = extract_message_from_loose_json(message_content)
                .unwrap_or_else(|| {
                    if looks_like_json_response(message_content) {
                        String::new()
                    } else {
                        message_content.trim().to_string()
                    }
                });
            let mut warnings = vec!["Model returned non-JSON chat output. Parsed in tolerant mode.".to_string()];
            if normalized_message.is_empty() && looks_like_json_response(message_content) {
                warnings.push("Response JSON could not be parsed. Try asking again.".to_string());
            }
            let draft = extract_sql_draft_from_text(&normalized_message);
            let needs_sql_generation = draft.is_some();
            (
                normalized_message,
                Vec::new(),
                warnings,
                draft,
                needs_sql_generation,
                false,
            )
        }
    }
}

fn extract_openrouter_stream_delta(data: &str) -> Option<String> {
    let payload: Value = serde_json::from_str(data).ok()?;
    payload
        .get("choices")
        .and_then(|choices| choices.get(0))
        .and_then(|choice| choice.get("delta"))
        .and_then(|delta| delta.get("content"))
        .and_then(Value::as_str)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
}

fn emit_veloxy_stream_chunk(app: &AppHandle, chunk: VeloxyStreamChunk) {
    let _ = app.emit("veloxy-stream-chunk", chunk);
}

fn extract_openrouter_finish_reason(data: &str) -> Option<String> {
    let payload: Value = serde_json::from_str(data).ok()?;
    payload
        .get("choices")
        .and_then(|choices| choices.get(0))
        .and_then(|choice| choice.get("finish_reason"))
        .and_then(Value::as_str)
        .map(str::to_string)
}

async fn stream_openrouter_chat_completion(
    app: &AppHandle,
    client: &reqwest::Client,
    endpoint: &str,
    api_key: &str,
    model: &str,
    system_prompt: &str,
    user_prompt: &str,
    request_id: &str,
    cancel: Arc<AtomicBool>,
) -> Result<(String, bool), String> {
    let response = client
        .post(endpoint)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "model": model,
            "temperature": 0.2,
            "max_tokens": ASK_VELOXY_MAX_CHAT_TOKENS,
            "stream": true,
            "messages": [
                { "role": "system", "content": system_prompt },
                { "role": "user", "content": user_prompt }
            ]
        }))
        .send()
        .await
        .map_err(|error| format!("OpenRouter request failed: {}", error))?;

    let status = response.status();
    if !status.is_success() {
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown OpenRouter error".to_string());
        if let Ok(payload) = serde_json::from_str::<Value>(&body) {
            let message = payload
                .get("error")
                .and_then(|error| error.get("message"))
                .and_then(Value::as_str)
                .unwrap_or("Unknown OpenRouter error");
            return Err(format!("OpenRouter error ({}): {}", status.as_u16(), message));
        }
        return Err(format!("OpenRouter error ({}): {}", status.as_u16(), body));
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut accumulated = String::new();
    let mut last_display_len = 0usize;
    let mut hit_token_limit = false;

    while let Some(chunk) = stream.next().await {
        if cancel.load(Ordering::Relaxed) {
            return Ok((accumulated, hit_token_limit));
        }
        let bytes = chunk.map_err(|error| format!("OpenRouter stream read failed: {}", error))?;
        buffer.push_str(&String::from_utf8_lossy(&bytes));

        while let Some(line_end) = buffer.find('\n') {
            let line = buffer[..line_end].trim_end_matches('\r').to_string();
            buffer.drain(..=line_end);

            if !line.starts_with("data: ") {
                continue;
            }
            let data = line["data: ".len()..].trim();
            if data == "[DONE]" {
                continue;
            }
            if extract_openrouter_finish_reason(data).as_deref() == Some("length") {
                hit_token_limit = true;
            }
            if let Some(delta) = extract_openrouter_stream_delta(data) {
                accumulated.push_str(&delta);
                let display = streaming_display_text(&accumulated);
                let display_delta = if display.len() > last_display_len {
                    display[last_display_len..].to_string()
                } else {
                    String::new()
                };
                last_display_len = display.len();
                if !display_delta.is_empty() {
                    emit_veloxy_stream_chunk(
                        app,
                        VeloxyStreamChunk {
                            request_id: request_id.to_string(),
                            delta: display_delta,
                            done: false,
                            message: None,
                            suggestions: Vec::new(),
                            warnings: Vec::new(),
                            sql_draft: None,
                            needs_sql_generation: false,
                            needs_clarification: false,
                        },
                    );
                }
            }
        }
    }

    Ok((accumulated, hit_token_limit))
}

#[tauri::command]
pub async fn cancel_veloxy_request(state: State<'_, AppState>) -> Result<(), String> {
    if let Some(cancel) = state.veloxy_cancel.read().await.as_ref() {
        cancel.store(true, Ordering::Relaxed);
    }
    Ok(())
}

#[tauri::command]
pub async fn chat_with_db(
    app: AppHandle,
    state: State<'_, AppState>,
    input: AskVeloxyChatRequest,
) -> Result<AskVeloxyChatResponse, String> {
    let natural_prompt = input.natural_prompt.trim();
    if natural_prompt.is_empty() {
        return Err("Ask Veloxy prompt cannot be empty.".to_string());
    }
    if input.provider_config.api_key.trim().is_empty() {
        return Err("OpenRouter API key is required.".to_string());
    }
    if input.provider_config.model.trim().is_empty() {
        return Err("OpenRouter model is required.".to_string());
    }

    let (connection_id, engine) =
        resolve_connection_engine(&app, &state, input.connection_id.clone()).await?;
    let stored_connection = load_connection(&app, &connection_id)?
        .ok_or_else(|| "Stored connection details were not found.".to_string())?;
    let db_context = get_or_build_ask_veloxy_db_context(&app, &state, &connection_id, engine).await?;
    let schema_context = build_schema_context(&db_context, natural_prompt, input.target_table.as_ref());
    let conversation_key = ask_veloxy_conversation_key(&connection_id, &stored_connection.database);
    let history = state
        .ask_veloxy_conversations
        .read()
        .await
        .get(&conversation_key)
        .cloned()
        .unwrap_or_default();

    let history_block = history
        .iter()
        .rev()
        .take(8)
        .rev()
        .map(|message| format!("{}: {}", message.role, message.text))
        .collect::<Vec<_>>()
        .join("\n");

    let mut user_prompt = format!(
        "Engine: {:?}\nDatabase: {}\nTask: {}\nMaxRows: {}\nRecentConversation:\n{}\nSchemaContext:\n{}\n",
        db_context.engine,
        db_context.database_name,
        natural_prompt,
        input.max_rows.unwrap_or(MAX_QUERY_ROWS),
        history_block,
        schema_context
    );
    truncate_on_char_boundary(&mut user_prompt, ASK_VELOXY_PROMPT_CHAR_BUDGET);

    let system_prompt = "You are Ask Veloxy chat mode. Return JSON when possible with keys: message (string), suggestions (array of strings), sqlDraft (string optional), needsSqlGeneration (boolean), needsClarification (boolean), warnings (array of strings). If JSON is not possible, return helpful plain text.";
    let base_url = normalize_openrouter_base(input.provider_config.base_url.as_deref());
    let endpoint = format!("{}/chat/completions", base_url);
    let client = state.openrouter_client.get_or_init(reqwest::Client::new);
    let request_id = input
        .request_id
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| format!("req-{}", uuid::Uuid::new_v4()));

    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut guard = state.veloxy_cancel.write().await;
        *guard = Some(cancel.clone());
    }

    let (message_content, hit_token_limit) = stream_openrouter_chat_completion(
        &app,
        client,
        &endpoint,
        input.provider_config.api_key.trim(),
        input.provider_config.model.trim(),
        system_prompt,
        &user_prompt,
        &request_id,
        cancel.clone(),
    )
    .await?;

    {
        let mut guard = state.veloxy_cancel.write().await;
        *guard = None;
    }

    let (message, suggestions, mut warnings, sql_draft, needs_sql_generation, needs_clarification) =
        parse_ask_veloxy_chat_content(&message_content);

    if cancel.load(Ordering::Relaxed) {
        warnings.push("Stopped early.".to_string());
    }
    if hit_token_limit {
        warnings.push(format!(
            "Response may be truncated (model output limit of {} tokens).",
            ASK_VELOXY_MAX_CHAT_TOKENS
        ));
    }

    emit_veloxy_stream_chunk(
        &app,
        VeloxyStreamChunk {
            request_id: request_id.clone(),
            delta: String::new(),
            done: true,
            message: Some(message.clone()),
            suggestions: suggestions.clone(),
            warnings: warnings.clone(),
            sql_draft: sql_draft.clone(),
            needs_sql_generation,
            needs_clarification,
        },
    );

    {
        let mut conversations = state.ask_veloxy_conversations.write().await;
        let bucket = conversations.entry(conversation_key).or_default();
        bucket.push(AskVeloxyConversationMessage {
            id: format!("msg-{}", uuid::Uuid::new_v4()),
            role: "user".to_string(),
            mode: "chat".to_string(),
            text: natural_prompt.to_string(),
            created_at: now_epoch_seconds(),
            sql_draft: None,
        });
        bucket.push(AskVeloxyConversationMessage {
            id: format!("msg-{}", uuid::Uuid::new_v4()),
            role: "assistant".to_string(),
            mode: "chat".to_string(),
            text: message.clone(),
            created_at: now_epoch_seconds(),
            sql_draft: sql_draft.clone(),
        });
        if bucket.len() > ASK_VELOXY_MAX_HISTORY_MESSAGES {
            let remove_count = bucket.len() - ASK_VELOXY_MAX_HISTORY_MESSAGES;
            bucket.drain(0..remove_count);
        }
    }

    Ok(AskVeloxyChatResponse {
        message,
        suggestions,
        warnings,
        sql_draft,
        needs_sql_generation,
        needs_clarification,
    })
}

#[tauri::command]
pub async fn load_veloxy_conversation(
    app: AppHandle,
    state: State<'_, AppState>,
    connection_id: Option<String>,
) -> Result<AskVeloxyConversationResponse, String> {
    let (resolved_connection_id, _) = resolve_connection_engine(&app, &state, connection_id).await?;
    let stored_connection = load_connection(&app, &resolved_connection_id)?
        .ok_or_else(|| "Stored connection details were not found.".to_string())?;
    let key = ask_veloxy_conversation_key(&resolved_connection_id, &stored_connection.database);
    let messages = state
        .ask_veloxy_conversations
        .read()
        .await
        .get(&key)
        .cloned()
        .unwrap_or_default();
    Ok(AskVeloxyConversationResponse { messages })
}

#[tauri::command]
pub async fn clear_veloxy_conversation(
    app: AppHandle,
    state: State<'_, AppState>,
    connection_id: Option<String>,
) -> Result<(), String> {
    let (resolved_connection_id, _) = resolve_connection_engine(&app, &state, connection_id).await?;
    let stored_connection = load_connection(&app, &resolved_connection_id)?
        .ok_or_else(|| "Stored connection details were not found.".to_string())?;
    let key = ask_veloxy_conversation_key(&resolved_connection_id, &stored_connection.database);
    state.ask_veloxy_conversations.write().await.remove(&key);
    Ok(())
}

#[tauri::command]
pub async fn generate_sql_from_nl(
    app: AppHandle,
    state: State<'_, AppState>,
    input: AskVeloxyRequest,
) -> Result<AskVeloxyResponse, String> {
    let natural_prompt = input.natural_prompt.trim();
    if natural_prompt.is_empty() {
        return Err("Ask Veloxy prompt cannot be empty.".to_string());
    }
    if input.provider_config.api_key.trim().is_empty() {
        return Err("OpenRouter API key is required.".to_string());
    }
    if input.provider_config.model.trim().is_empty() {
        return Err("OpenRouter model is required.".to_string());
    }

    let (connection_id, engine) =
        resolve_connection_engine(&app, &state, input.connection_id.clone()).await?;
    let db_context = get_or_build_ask_veloxy_db_context(&app, &state, &connection_id, engine).await?;
    let schema_context = build_schema_context(&db_context, natural_prompt, input.target_table.as_ref());

    let mut user_prompt = format!(
        "Engine: {:?}\nDatabase: {}\nTask: {}\nMaxRows: {}\nSchemaContext:\n{}\n",
        db_context.engine,
        db_context.database_name,
        natural_prompt,
        input.max_rows.unwrap_or(MAX_QUERY_ROWS),
        schema_context
    );
    truncate_on_char_boundary(&mut user_prompt, ASK_VELOXY_PROMPT_CHAR_BUDGET);

    let system_prompt = "You are Ask Veloxy. Return JSON only with keys: sql (string), intent (string), confidence (number 0..1), explanation (string), suggestions (array of short strings), warnings (array of strings). Generate exactly one SQL statement, keep explanation concise, and never include markdown.";
    let base_url = normalize_openrouter_base(input.provider_config.base_url.as_deref());
    let endpoint = format!("{}/chat/completions", base_url);

    let client = state.openrouter_client.get_or_init(reqwest::Client::new);
    let response = client
        .post(&endpoint)
        .header("Authorization", format!("Bearer {}", input.provider_config.api_key.trim()))
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "model": input.provider_config.model.trim(),
            "temperature": 0.1,
            "max_tokens": 500,
            "messages": [
                { "role": "system", "content": system_prompt },
                { "role": "user", "content": user_prompt }
            ]
        }))
        .send()
        .await
        .map_err(|error| format!("OpenRouter request failed: {}", error))?;

    let status = response.status();
    let payload = response
        .json::<Value>()
        .await
        .map_err(|error| format!("Invalid OpenRouter JSON response: {}", error))?;
    if !status.is_success() {
        let message = payload
            .get("error")
            .and_then(|error| error.get("message"))
            .and_then(Value::as_str)
            .unwrap_or("Unknown OpenRouter error");
        return Err(format!("OpenRouter error ({}): {}", status.as_u16(), message));
    }

    let message_content = extract_openrouter_message_content(&payload)?;
    let generated = parse_ask_veloxy_json(&message_content)?;
    let sql = generated
        .get("sql")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();
    validate_generated_sql(&sql)?;

    let mut warnings = generated
        .get("warnings")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let intent = generated
        .get("intent")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| classify_sql_intent(&sql));
    let confidence = generated
        .get("confidence")
        .and_then(Value::as_f64)
        .unwrap_or(0.6)
        .clamp(0.0, 1.0);
    let explanation = generated
        .get("explanation")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| {
            let mut truncated = value.to_string();
            truncate_on_char_boundary(&mut truncated, 350);
            truncated
        });
    let suggestions = parse_ask_veloxy_suggestions(&generated);

    if intent != "select" {
        warnings.push("Generated SQL is not read-only. Review before execution.".to_string());
    }
    if confidence < 0.5 {
        warnings.push("Low confidence result. Review SQL carefully.".to_string());
    }

    let token_stats = AskVeloxyTokenStats {
        schema_chars: schema_context.len(),
        schema_tokens_estimate: estimate_tokens(schema_context.len()),
        prompt_chars: user_prompt.len() + system_prompt.len(),
        prompt_tokens_estimate: estimate_tokens(user_prompt.len() + system_prompt.len()),
    };

    Ok(AskVeloxyResponse {
        sql,
        intent,
        confidence,
        explanation,
        suggestions,
        warnings,
        token_stats,
    })
}

#[tauri::command]
pub async fn lint_sql(
    app: AppHandle,
    state: State<'_, AppState>,
    input: LintSqlRequest,
) -> Result<LintSqlResult, String> {
    let (connection_id, engine) = resolve_connection_engine(&app, &state, input.connection_id.clone()).await?;
    let sql = input.sql.trim().to_string();
    if sql.is_empty() {
        return Ok(LintSqlResult {
            diagnostics: Vec::new(),
        });
    }
    if sql.len() > MAX_LINT_SQL_BYTES {
        return Err("SQL is too large to lint in the editor.".to_string());
    }

    match engine {
        DatabaseEngine::Postgres => {
            with_pool_client_retry(&app, &state, &connection_id, sql, |client, sql| async move {
                let lint_sql = format!("EXPLAIN {}", sql);
                let diagnostics = match client.simple_query(&lint_sql).await {
                    Ok(_) => Vec::new(),
                    Err(error) => {
                        let (line, column) = error_line_column(&error, &sql)
                            .map(|(l, c)| (Some(l), Some(c)))
                            .unwrap_or((None, None));
                        vec![SqlDiagnostic {
                            message: map_pg_err(error, Some(sql.as_str())),
                            severity: "error".to_string(),
                            line,
                            column,
                            end_line: line,
                            end_column: column.map(|value| value + 1),
                        }]
                    }
                };
                Ok(LintSqlResult { diagnostics })
            })
            .await
        }
        DatabaseEngine::Mysql => {
            let pool = get_or_create_mysql_pool(&app, &state, &connection_id).await?;
            let lint_sql = format!("EXPLAIN {}", sql);
            let diagnostics = match sqlx::query(&lint_sql).execute(&pool).await {
                Ok(_) => Vec::new(),
                Err(error) => vec![SqlDiagnostic {
                    message: error.to_string(),
                    severity: "error".to_string(),
                    line: None,
                    column: None,
                    end_line: None,
                    end_column: None,
                }],
            };
            Ok(LintSqlResult { diagnostics })
        }
        DatabaseEngine::Sqlite => {
            let pool = get_or_create_sqlite_pool(&app, &state, &connection_id).await?;
            let lint_sql = format!("EXPLAIN QUERY PLAN {}", sql);
            let diagnostics = match sqlx::query(&lint_sql).execute(&pool).await {
                Ok(_) => Vec::new(),
                Err(error) => vec![SqlDiagnostic {
                    message: error.to_string(),
                    severity: "error".to_string(),
                    line: None,
                    column: None,
                    end_line: None,
                    end_column: None,
                }],
            };
            Ok(LintSqlResult { diagnostics })
        }
    }
}

#[tauri::command]
pub async fn get_tables(
    app: AppHandle,
    state: State<'_, AppState>,
    connection_id: Option<String>,
) -> Result<Vec<TableInfo>, String> {
    let (connection_id, engine) = resolve_connection_engine(&app, &state, connection_id).await?;

    match engine {
        DatabaseEngine::Postgres => {
            with_pool_client_retry(&app, &state, &connection_id, (), |client, ()| async move {
                let rows = client
                    .query(
                        "
                    select table_schema, table_name
                    from information_schema.tables
                    where table_type = 'BASE TABLE'
                      and table_schema not in ('pg_catalog', 'information_schema')
                    order by table_schema, table_name
                    ",
                        &[],
                    )
                    .await
                    .map_err(|error| map_pg_err(error, None))?;

                Ok(rows
                    .into_iter()
                    .map(|row| {
                        let schema: String = row.get(0);
                        let name: String = row.get(1);
                        let preview_query = format!(
                            "select * from \"{}\".\"{}\" limit 100;",
                            quote_identifier(&schema),
                            quote_identifier(&name)
                        );

                        TableInfo {
                            schema,
                            name,
                            preview_query,
                        }
                    })
                    .collect())
            })
            .await
        }
        DatabaseEngine::Mysql => {
            let pool = get_or_create_mysql_pool(&app, &state, &connection_id).await?;
            let database = load_connection(&app, &connection_id)?
                .map(|connection| connection.database)
                .unwrap_or_default();
            let rows = sqlx::query(
                "
                select table_schema, table_name
                from information_schema.tables
                where table_type = 'BASE TABLE'
                  and table_schema = ?
                  and table_schema not in ('information_schema', 'mysql', 'performance_schema', 'sys')
                order by table_schema, table_name
                ",
            )
            .bind(&database)
            .fetch_all(&pool)
            .await
            .map_err(|error| error.to_string())?;
            let mut tables = Vec::new();
            for row in rows {
                let schema: String = mysql_get_string(&row, 0, "table_schema", "get_tables")?;
                let name: String = mysql_get_string(&row, 1, "table_name", "get_tables")?;
                tables.push(TableInfo {
                    preview_query: format!("select * from `{}`.`{}` limit 100;", schema, name),
                    schema,
                    name,
                });
            }
            Ok(tables)
        }
        DatabaseEngine::Sqlite => {
            let pool = get_or_create_sqlite_pool(&app, &state, &connection_id).await?;
            let rows = sqlx::query(
                "
                select name
                from sqlite_master
                where type = 'table'
                  and name not like 'sqlite_%'
                order by name
                ",
            )
            .fetch_all(&pool)
            .await
            .map_err(|error| error.to_string())?;
            let mut tables = Vec::new();
            for row in rows {
                let name: String = sqlite_get_idx(&row, 0, "name", "get_tables")?;
                tables.push(TableInfo {
                    schema: "main".to_string(),
                    preview_query: format!("select * from \"{}\" limit 100;", quote_identifier(&name)),
                    name,
                });
            }
            Ok(tables)
        }
    }
}

#[tauri::command]
pub async fn get_schema(
    app: AppHandle,
    state: State<'_, AppState>,
    input: SchemaRequest,
) -> Result<Vec<ColumnInfo>, String> {
    let (connection_id, engine) = resolve_connection_engine(&app, &state, input.connection_id.clone()).await?;
    let schema_request = input.clone();

    match engine {
        DatabaseEngine::Postgres => {
            with_pool_client_retry(
                &app,
                &state,
                &connection_id,
                schema_request,
                |client, input| async move {
                    let rows = client
                        .query(
                            "
                    select table_schema, table_name, column_name, data_type, is_nullable
                    from information_schema.columns
                    where table_schema = $1 and table_name = $2
                    order by ordinal_position
                    ",
                            &[&input.table_schema, &input.table_name],
                        )
                        .await
                        .map_err(|error| map_pg_err(error, None))?;

                    Ok(rows
                        .into_iter()
                        .map(|row| ColumnInfo {
                            table_schema: row.get(0),
                            table_name: row.get(1),
                            column_name: row.get(2),
                            data_type: row.get(3),
                            is_nullable: row.get::<_, String>(4) == "YES",
                        })
                        .collect())
                },
            )
            .await
        }
        DatabaseEngine::Mysql => {
            let pool = get_or_create_mysql_pool(&app, &state, &connection_id).await?;
            let rows = sqlx::query(
                "
                select table_schema, table_name, column_name, data_type, is_nullable
                from information_schema.columns
                where table_schema = ? and table_name = ?
                order by ordinal_position
                ",
            )
            .bind(&schema_request.table_schema)
            .bind(&schema_request.table_name)
            .fetch_all(&pool)
            .await
            .map_err(|error| error.to_string())?;
            let mut columns = Vec::new();
            for row in rows {
                columns.push(ColumnInfo {
                    table_schema: mysql_get_string(&row, 0, "table_schema", "get_schema")?,
                    table_name: mysql_get_string(&row, 1, "table_name", "get_schema")?,
                    column_name: mysql_get_string(&row, 2, "column_name", "get_schema")?,
                    data_type: mysql_get_string(&row, 3, "data_type", "get_schema")?,
                    is_nullable: mysql_get_string(&row, 4, "is_nullable", "get_schema")? == "YES",
                });
            }
            Ok(columns)
        }
        DatabaseEngine::Sqlite => {
            let pool = get_or_create_sqlite_pool(&app, &state, &connection_id).await?;
            let pragma_sql = format!(
                "PRAGMA table_info(\"{}\");",
                quote_identifier(&schema_request.table_name)
            );
            let rows = sqlx::query(&pragma_sql)
                .fetch_all(&pool)
                .await
                .map_err(|error| error.to_string())?;
            let mut columns = Vec::new();
            for row in rows {
                let col_name: String = sqlite_get_name(&row, "name", "get_schema")?;
                let col_type: String = sqlite_get_name(&row, "type", "get_schema")?;
                let notnull: i64 = sqlite_get_name(&row, "notnull", "get_schema")?;
                columns.push(ColumnInfo {
                    table_schema: "main".to_string(),
                    table_name: schema_request.table_name.clone(),
                    column_name: col_name,
                    data_type: col_type,
                    is_nullable: notnull == 0,
                });
            }
            Ok(columns)
        }
    }
}

fn veloxdb_unique_constraint_name(table_name: &str, column_name: &str) -> String {
    // Postgres constraint names are limited to 63 bytes.
    // Keep this deterministic so we can drop the exact constraint later.
    let suffix = "_uniq";
    let max_base_len = 63usize.saturating_sub(suffix.len());

    let mut base = format!("veloxdb_{}_{}", table_name, column_name);
    base.truncate(max_base_len);

    format!("{}{}", base, suffix)
}

#[tauri::command]
pub async fn get_table_properties(
    app: AppHandle,
    state: State<'_, AppState>,
    input: SchemaRequest,
) -> Result<Vec<ColumnProperties>, String> {
    let (connection_id, engine) = resolve_connection_engine(&app, &state, input.connection_id.clone()).await?;
    let ctx = input.clone();

    if engine == DatabaseEngine::Mysql {
        let pool = get_or_create_mysql_pool(&app, &state, &connection_id).await?;
        let rows = sqlx::query(
            "
            select
              c.table_schema,
              c.table_name,
              c.column_name,
              c.data_type,
              c.is_nullable,
              c.column_default,
              c.extra
            from information_schema.columns c
            where c.table_schema = ? and c.table_name = ?
            order by c.ordinal_position
            ",
        )
        .bind(&ctx.table_schema)
        .bind(&ctx.table_name)
        .fetch_all(&pool)
        .await
        .map_err(|error| error.to_string())?;

        let pk_rows = sqlx::query(
            "
            select column_name
            from information_schema.key_column_usage
            where table_schema = ? and table_name = ? and constraint_name = 'PRIMARY'
            ",
        )
        .bind(&ctx.table_schema)
        .bind(&ctx.table_name)
        .fetch_all(&pool)
        .await
        .map_err(|error| error.to_string())?;
        let pk_cols: HashSet<String> = pk_rows
            .into_iter()
            .map(|row| mysql_get_string(&row, 0, "column_name", "get_table_properties"))
            .collect::<Result<HashSet<_>, _>>()?;

        let unique_rows = sqlx::query(
            "
            select index_name, column_name, seq_in_index
            from information_schema.statistics
            where table_schema = ?
              and table_name = ?
              and non_unique = 0
            order by index_name, seq_in_index
            ",
        )
        .bind(&ctx.table_schema)
        .bind(&ctx.table_name)
        .fetch_all(&pool)
        .await
        .map_err(|error| error.to_string())?;
        let mut unique_by_index: HashMap<String, Vec<String>> = HashMap::new();
        for row in unique_rows {
            let index_name: String = mysql_get_string(&row, 0, "index_name", "get_table_properties")?;
            if index_name == "PRIMARY" {
                continue;
            }
            let column_name: String = mysql_get_string(&row, 1, "column_name", "get_table_properties")?;
            unique_by_index.entry(index_name).or_default().push(column_name);
        }
        let mut unique_cols: HashSet<String> = HashSet::new();
        let mut composite_unique_cols: HashSet<String> = HashSet::new();
        for cols in unique_by_index.values() {
            for col in cols {
                unique_cols.insert(col.clone());
            }
            if cols.len() > 1 {
                for col in cols {
                    composite_unique_cols.insert(col.clone());
                }
            }
        }

        let mut properties = Vec::new();
        for row in rows {
                let column_name: String = mysql_get_string(&row, 2, "column_name", "get_table_properties")?;
                let is_primary_key = pk_cols.contains(&column_name);
                let is_unique = is_primary_key || unique_cols.contains(&column_name);
                let is_part_of_composite_unique = composite_unique_cols.contains(&column_name);
                let extra: String = mysql_get_string(&row, 6, "extra", "get_table_properties")?;
                let lower_extra = extra.to_lowercase();
                properties.push(ColumnProperties {
                    table_schema: mysql_get_string(&row, 0, "table_schema", "get_table_properties")?,
                    table_name: mysql_get_string(&row, 1, "table_name", "get_table_properties")?,
                    column_name,
                    data_type: mysql_get_string(&row, 3, "data_type", "get_table_properties")?,
                    is_nullable: mysql_get_string(&row, 4, "is_nullable", "get_table_properties")? == "YES",
                    is_primary_key,
                    is_unique,
                    is_part_of_composite_unique,
                    column_default: mysql_get_optional_string(&row, 5, "column_default", "get_table_properties")?,
                    is_identity: lower_extra.contains("auto_increment"),
                    identity_generation: if lower_extra.contains("auto_increment") {
                        Some("BY DEFAULT".to_string())
                    } else {
                        None
                    },
                    is_generated: if lower_extra.contains("generated") {
                        Some("ALWAYS".to_string())
                    } else {
                        None
                    },
                });
            }
        return Ok(properties);
    }

    if engine == DatabaseEngine::Sqlite {
        let pool = get_or_create_sqlite_pool(&app, &state, &connection_id).await?;
        let pragma_sql = format!("PRAGMA table_info(\"{}\");", quote_identifier(&ctx.table_name));
        let rows = sqlx::query(&pragma_sql)
            .fetch_all(&pool)
            .await
            .map_err(|error| error.to_string())?;
        let index_list_sql = format!("PRAGMA index_list(\"{}\");", quote_identifier(&ctx.table_name));
        let index_rows = sqlx::query(&index_list_sql)
            .fetch_all(&pool)
            .await
            .map_err(|error| error.to_string())?;
        let mut unique_cols: HashSet<String> = HashSet::new();
        let mut composite_unique_cols: HashSet<String> = HashSet::new();
        for index in index_rows {
            let is_unique = sqlite_get_name::<i64>(&index, "unique", "get_table_properties")? == 1;
            if !is_unique {
                continue;
            }
            let origin = sqlite_get_name::<String>(&index, "origin", "get_table_properties")?;
            if origin == "pk" {
                continue;
            }
            let index_name = sqlite_get_name::<String>(&index, "name", "get_table_properties")?;
            let info_sql = format!("PRAGMA index_info(\"{}\");", quote_identifier(&index_name));
            let info_rows = sqlx::query(&info_sql)
                .fetch_all(&pool)
                .await
                .map_err(|error| error.to_string())?;
            let mut cols: Vec<String> = Vec::new();
            for info in info_rows {
                if let Ok(name) = sqlite_get_name::<String>(&info, "name", "get_table_properties") {
                    cols.push(name);
                }
            }
            for col in &cols {
                unique_cols.insert(col.clone());
            }
            if cols.len() > 1 {
                for col in cols {
                    composite_unique_cols.insert(col);
                }
            }
        }
        let mut properties = Vec::new();
        for row in rows {
                let column_name: String = sqlite_get_name(&row, "name", "get_table_properties")?;
                let is_primary_key = sqlite_get_name::<i64>(&row, "pk", "get_table_properties")? == 1;
                let is_unique = is_primary_key || unique_cols.contains(&column_name);
                let is_part_of_composite_unique = composite_unique_cols.contains(&column_name);
                properties.push(ColumnProperties {
                    table_schema: "main".to_string(),
                    table_name: ctx.table_name.clone(),
                    column_name,
                    data_type: sqlite_get_name(&row, "type", "get_table_properties")?,
                    is_nullable: sqlite_get_name::<i64>(&row, "notnull", "get_table_properties")? == 0,
                    is_primary_key,
                    is_unique,
                    is_part_of_composite_unique,
                    column_default: sqlite_get_name::<Option<String>>(&row, "dflt_value", "get_table_properties")?,
                    is_identity: false,
                    identity_generation: None,
                    is_generated: None,
                });
            }
        return Ok(properties);
    }

    with_pool_client_retry(&app, &state, &connection_id, ctx, |client, input| async move {
        let columns = client
        .query(
            "
            select
              c.table_schema,
              c.table_name,
              c.column_name,
              c.data_type,
              c.is_nullable,
              c.column_default,
              c.is_identity,
              c.identity_generation,
              c.is_generated
            from information_schema.columns c
            where c.table_schema = $1 and c.table_name = $2
            order by c.ordinal_position
            ",
            &[&input.table_schema, &input.table_name],
        )
        .await
        .map_err(|error| map_pg_err(error, None))?;

    let primary_keys = client
        .query(
            "
            select kcu.column_name
            from information_schema.table_constraints tc
            join information_schema.key_column_usage kcu
              on tc.constraint_name = kcu.constraint_name
             and tc.table_schema = kcu.table_schema
            where tc.table_schema = $1
              and tc.table_name = $2
              and tc.constraint_type = 'PRIMARY KEY'
            order by kcu.ordinal_position
            ",
            &[&input.table_schema, &input.table_name],
        )
        .await
        .map_err(|error| map_pg_err(error, None))?;

    let primary_key_columns: HashSet<String> = primary_keys
        .into_iter()
        .filter_map(|row| Some(row.get::<_, String>(0)))
        .collect();

    let unique_constraints = client
        .query(
            "
            select tc.constraint_name, kcu.column_name, kcu.ordinal_position
            from information_schema.table_constraints tc
            join information_schema.key_column_usage kcu
              on tc.constraint_name = kcu.constraint_name
             and tc.table_schema = kcu.table_schema
            where tc.table_schema = $1
              and tc.table_name = $2
              and tc.constraint_type = 'UNIQUE'
            order by tc.constraint_name, kcu.ordinal_position
            ",
            &[&input.table_schema, &input.table_name],
        )
        .await
        .map_err(|error| map_pg_err(error, None))?;

    let mut unique_by_name: HashMap<String, Vec<String>> = HashMap::new();
    for row in unique_constraints {
        let constraint_name: String = row.get(0);
        let column_name: String = row.get(1);
        unique_by_name.entry(constraint_name).or_default().push(column_name);
    }

    let mut unique_columns: HashSet<String> = HashSet::new();
    let mut composite_unique_columns: HashSet<String> = HashSet::new();

    for (_constraint_name, cols) in unique_by_name {
        for c in &cols {
            unique_columns.insert(c.clone());
        }
        if cols.len() > 1 {
            for c in &cols {
                composite_unique_columns.insert(c.clone());
            }
        }
    }

    Ok(columns
        .into_iter()
        .map(|row| {
            let table_schema: String = row.get(0);
            let table_name: String = row.get(1);
            let column_name: String = row.get(2);
            let data_type: String = row.get(3);
            let is_nullable = row.get::<_, String>(4) == "YES";
            let column_default: Option<String> = row.get(5);
            let is_identity = row.get::<_, Option<String>>(6).as_deref() == Some("YES");
            let identity_generation: Option<String> = row.get(7);
            let is_generated: Option<String> = row.get(8);

            let is_primary_key = primary_key_columns.contains(&column_name);
            let is_unique = is_primary_key || unique_columns.contains(&column_name);
            let is_part_of_composite_unique = composite_unique_columns.contains(&column_name);

            ColumnProperties {
                table_schema,
                table_name,
                column_name,
                data_type,
                is_nullable,
                is_primary_key,
                is_unique,
                is_part_of_composite_unique,
                column_default,
                is_identity,
                identity_generation,
                is_generated,
            }
        })
        .collect())
    })
    .await
}

#[tauri::command]
pub async fn apply_table_properties(
    app: AppHandle,
    state: State<'_, AppState>,
    input: TablePropertiesApplyRequest,
) -> Result<(), String> {
    let (connection_id, engine) = resolve_connection_engine(&app, &state, input.connection_id.clone()).await?;
    if engine != DatabaseEngine::Postgres {
        return Err(format!(
            "Table property editing is not supported for {} connections yet.",
            match engine {
                DatabaseEngine::Postgres => "PostgreSQL",
                DatabaseEngine::Mysql => "MySQL",
                DatabaseEngine::Sqlite => "SQLite",
            }
        ));
    }

    with_pool_client_retry(&app, &state, &connection_id, input, |mut client, input| async move {
        let table_schema = input.table_schema;
        let table_name = input.table_name;
        let columns = input.columns;

        let current_columns = client
        .query(
            "
            select column_name, is_nullable
            from information_schema.columns
            where table_schema = $1 and table_name = $2
            ",
            &[&table_schema, &table_name],
        )
        .await
        .map_err(|error| map_pg_err(error, None))?;

    let mut current_nullable: HashMap<String, bool> = HashMap::new();
    for row in current_columns {
        let column_name: String = row.get(0);
        let is_nullable = row.get::<_, String>(1) == "YES";
        current_nullable.insert(column_name, is_nullable);
    }

    let primary_keys = client
        .query(
            "
            select kcu.column_name
            from information_schema.table_constraints tc
            join information_schema.key_column_usage kcu
              on tc.constraint_name = kcu.constraint_name
             and tc.table_schema = kcu.table_schema
            where tc.table_schema = $1
              and tc.table_name = $2
              and tc.constraint_type = 'PRIMARY KEY'
            ",
            &[&table_schema, &table_name],
        )
        .await
        .map_err(|error| map_pg_err(error, None))?;

    let primary_key_columns: HashSet<String> = primary_keys
        .into_iter()
        .filter_map(|row| Some(row.get::<_, String>(0)))
        .collect();

    let unique_constraints = client
        .query(
            "
            select tc.constraint_name, kcu.column_name, kcu.ordinal_position
            from information_schema.table_constraints tc
            join information_schema.key_column_usage kcu
              on tc.constraint_name = kcu.constraint_name
             and tc.table_schema = kcu.table_schema
            where tc.table_schema = $1
              and tc.table_name = $2
              and tc.constraint_type = 'UNIQUE'
            order by tc.constraint_name, kcu.ordinal_position
            ",
            &[&table_schema, &table_name],
        )
        .await
        .map_err(|error| map_pg_err(error, None))?;

    let mut unique_by_name: HashMap<String, Vec<String>> = HashMap::new();
    for row in unique_constraints {
        let constraint_name: String = row.get(0);
        let column_name: String = row.get(1);
        unique_by_name.entry(constraint_name).or_default().push(column_name);
    }

    let mut composite_unique_columns: HashSet<String> = HashSet::new();
    let mut single_unique_constraint_names_by_column: HashMap<String, Vec<String>> = HashMap::new();

    for (constraint_name, cols) in &unique_by_name {
        if cols.len() > 1 {
            for c in cols {
                composite_unique_columns.insert(c.clone());
            }
        } else if cols.len() == 1 {
            let c = &cols[0];
            single_unique_constraint_names_by_column
                .entry(c.clone())
                .or_default()
                .push(constraint_name.clone());
        }
    }

    let mut desired_by_column: HashMap<String, (bool, bool)> = HashMap::new();
    for update in columns {
        desired_by_column.insert(update.column_name, (update.is_nullable, update.is_unique));
    }

    let txn = client.transaction().await.map_err(|error| map_pg_err(error, None))?;

    // 1) Nullable changes
    for (column_name, (desired_is_nullable, _desired_is_unique)) in &desired_by_column {
        let current_is_nullable = current_nullable
            .get(column_name)
            .ok_or_else(|| format!("Unknown column: {}", column_name))?;

        if *current_is_nullable == *desired_is_nullable {
            continue;
        }

        let qualified_table = format!(
            "\"{}\".\"{}\"",
            quote_identifier(&table_schema),
            quote_identifier(&table_name)
        );

        let qualified_column = format!("\"{}\"", quote_identifier(column_name));

        if *desired_is_nullable {
            let sql = format!(
                "ALTER TABLE {} ALTER COLUMN {} DROP NOT NULL",
                qualified_table, qualified_column
            );
            txn.execute(sql.as_str(), &[]).await.map_err(|error| map_pg_err(error, Some(sql.as_str())))?;
        } else {
            let sql = format!(
                "ALTER TABLE {} ALTER COLUMN {} SET NOT NULL",
                qualified_table, qualified_column
            );
            txn.execute(sql.as_str(), &[]).await.map_err(|error| map_pg_err(error, Some(sql.as_str())))?;
        }
    }

    // 2) UNIQUE changes (v1: only support single-column UNIQUE constraints)
    for (column_name, (_desired_is_nullable, desired_is_unique)) in &desired_by_column {
        let is_primary_key = primary_key_columns.contains(column_name);
        let is_part_of_composite_unique = composite_unique_columns.contains(column_name);

        if !*desired_is_unique {
            if is_primary_key {
                return Err(format!(
                    "Cannot disable UNIQUE for primary key column: {}",
                    column_name
                ));
            }

            if is_part_of_composite_unique {
                return Err(format!(
                    "Cannot disable UNIQUE for column in a composite UNIQUE constraint: {}",
                    column_name
                ));
            }
        }

        // Compute current uniqueness:
        let has_single_unique = single_unique_constraint_names_by_column
            .get(column_name)
            .map(|names| !names.is_empty())
            .unwrap_or(false);

        let current_is_unique = is_primary_key || has_single_unique || is_part_of_composite_unique;

        if *desired_is_unique == current_is_unique {
            continue;
        }

        let qualified_table = format!(
            "\"{}\".\"{}\"",
            quote_identifier(&table_schema),
            quote_identifier(&table_name)
        );
        let qualified_column = format!("\"{}\"", quote_identifier(column_name));

        if *desired_is_unique {
            // Add a new single-column UNIQUE constraint.
            if current_is_unique {
                continue;
            }

            let generated_name = veloxdb_unique_constraint_name(&table_name, column_name);

            // If a constraint with that name exists and doesn't match our target column, fail fast.
            if let Some(existing_cols) = unique_by_name.get(&generated_name) {
                if existing_cols.len() != 1 || existing_cols[0] != *column_name {
                    return Err(format!(
                        "Cannot create UNIQUE constraint due to name collision ({}). Rename the existing constraint.",
                        generated_name
                    ));
                }
            }

            let sql = format!(
                "ALTER TABLE {} ADD CONSTRAINT \"{}\" UNIQUE ({})",
                qualified_table,
                quote_identifier(&generated_name),
                qualified_column
            );
            txn.execute(sql.as_str(), &[]).await.map_err(|error| map_pg_err(error, Some(sql.as_str())))?;
        } else {
            // Drop the existing single-column UNIQUE constraints for this column.
            let constraint_names = single_unique_constraint_names_by_column
                .get(column_name)
                .cloned()
                .unwrap_or_default();

            for constraint_name in constraint_names {
                let sql = format!(
                    "ALTER TABLE {} DROP CONSTRAINT \"{}\"",
                    qualified_table,
                    quote_identifier(&constraint_name)
                );
                txn.execute(sql.as_str(), &[]).await.map_err(|error| map_pg_err(error, Some(sql.as_str())))?;
            }
        }
    }

        txn.commit().await.map_err(|error| map_pg_err(error, None))?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn get_foreign_keys(
    app: AppHandle,
    state: State<'_, AppState>,
    connection_id: Option<String>,
) -> Result<Vec<ForeignKeyEdge>, String> {
    let (connection_id, engine) = resolve_connection_engine(&app, &state, connection_id).await?;

    if engine == DatabaseEngine::Mysql {
        let pool = get_or_create_mysql_pool(&app, &state, &connection_id).await?;
        let rows = sqlx::query(
            "
            select
              kcu.table_schema as from_schema,
              kcu.table_name as from_table,
              kcu.column_name as from_column,
              kcu.referenced_table_schema as to_schema,
              kcu.referenced_table_name as to_table,
              kcu.referenced_column_name as to_column
            from information_schema.key_column_usage kcu
            where kcu.referenced_table_name is not null
            order by kcu.table_schema, kcu.table_name, kcu.ordinal_position
            limit ?
            ",
        )
        .bind(MAX_FOREIGN_KEY_ROWS)
        .fetch_all(&pool)
        .await
        .map_err(|error| error.to_string())?;
        let mut edges = Vec::new();
        for row in rows {
            edges.push(ForeignKeyEdge {
                from_schema: mysql_get_string(&row, 0, "from_schema", "get_foreign_keys")?,
                from_table: mysql_get_string(&row, 1, "from_table", "get_foreign_keys")?,
                from_column: mysql_get_string(&row, 2, "from_column", "get_foreign_keys")?,
                to_schema: mysql_get_string(&row, 3, "to_schema", "get_foreign_keys")?,
                to_table: mysql_get_string(&row, 4, "to_table", "get_foreign_keys")?,
                to_column: mysql_get_string(&row, 5, "to_column", "get_foreign_keys")?,
            });
        }
        return Ok(edges);
    }

    if engine == DatabaseEngine::Sqlite {
        let pool = get_or_create_sqlite_pool(&app, &state, &connection_id).await?;
        let tables = sqlx::query(
            "
            select name
            from sqlite_master
            where type = 'table'
              and name not like 'sqlite_%'
            ",
        )
        .fetch_all(&pool)
        .await
        .map_err(|error| error.to_string())?;
        let mut edges = Vec::new();
        for table in tables {
            let table_name: String = sqlite_get_idx(&table, 0, "name", "get_foreign_keys")?;
            let fk_sql = format!("PRAGMA foreign_key_list(\"{}\");", quote_identifier(&table_name));
            let fk_rows = sqlx::query(&fk_sql)
                .fetch_all(&pool)
                .await
                .map_err(|error| error.to_string())?;
            for row in fk_rows {
                edges.push(ForeignKeyEdge {
                    from_schema: "main".to_string(),
                    from_table: table_name.clone(),
                    from_column: sqlite_get_name(&row, "from", "get_foreign_keys")?,
                    to_schema: "main".to_string(),
                    to_table: sqlite_get_name(&row, "table", "get_foreign_keys")?,
                    to_column: sqlite_get_name(&row, "to", "get_foreign_keys")?,
                });
                if edges.len() >= MAX_FOREIGN_KEY_ROWS as usize {
                    return Ok(edges);
                }
            }
        }
        return Ok(edges);
    }

    with_pool_client_retry(&app, &state, &connection_id, (), |client, ()| async move {
        let rows = client
            .query(
                "
            select
              src_ns.nspname::text as from_schema,
              src_cls.relname::text as from_table,
              src_att.attname::text as from_column,
              tgt_ns.nspname::text as to_schema,
              tgt_cls.relname::text as to_table,
              tgt_att.attname::text as to_column
            from pg_constraint c
            join pg_class src_cls on src_cls.oid = c.conrelid
            join pg_namespace src_ns on src_ns.oid = src_cls.relnamespace
            join pg_class tgt_cls on tgt_cls.oid = c.confrelid
            join pg_namespace tgt_ns on tgt_ns.oid = tgt_cls.relnamespace
            cross join lateral unnest(c.conkey, c.confkey) as u(attnum, confattnum)
            join pg_attribute src_att
              on src_att.attrelid = c.conrelid
             and src_att.attnum = u.attnum
             and not src_att.attisdropped
            join pg_attribute tgt_att
              on tgt_att.attrelid = c.confrelid
             and tgt_att.attnum = u.confattnum
             and not tgt_att.attisdropped
            where c.contype = 'f'
              and src_ns.nspname not in ('pg_catalog', 'information_schema')
            order by src_ns.nspname, src_cls.relname, c.conname, u.attnum
            limit $1
            ",
                &[&MAX_FOREIGN_KEY_ROWS],
            )
            .await
            .map_err(|error| error.to_string())?;

        Ok(rows
            .into_iter()
            .map(|row| ForeignKeyEdge {
                from_schema: row.get(0),
                from_table: row.get(1),
                from_column: row.get(2),
                to_schema: row.get(3),
                to_table: row.get(4),
                to_column: row.get(5),
            })
            .collect())
    })
    .await
}

#[tauri::command]
pub async fn get_table_indexes(
    app: AppHandle,
    state: State<'_, AppState>,
    input: SchemaRequest,
) -> Result<TableIndexesResult, String> {
    let (connection_id, engine) = resolve_connection_engine(&app, &state, input.connection_id.clone()).await?;
    let ctx = input.clone();

    if engine == DatabaseEngine::Mysql {
        let pool = get_or_create_mysql_pool(&app, &state, &connection_id).await?;
        let fetch_limit = MAX_TABLE_INDEX_ROWS + 1;
        let rows = sqlx::query(
            "
            select
              table_schema as index_schema,
              index_name,
              table_schema,
              table_name,
              non_unique = 0 as is_unique,
              index_name = 'PRIMARY' as is_primary,
              true as is_valid,
              false as is_partial,
              concat(index_name, ' (', group_concat(column_name order by seq_in_index separator ', '), ')') as definition,
              0 as index_bytes,
              0 as idx_scan,
              0 as idx_tup_read,
              0 as idx_tup_fetch
            from information_schema.statistics
            where table_schema = ?
              and table_name = ?
            group by table_schema, table_name, index_name, non_unique
            order by index_name
            limit ?
            ",
        )
        .bind(&ctx.table_schema)
        .bind(&ctx.table_name)
        .bind(fetch_limit)
        .fetch_all(&pool)
        .await
        .map_err(|error| error.to_string())?;
        let truncated = rows.len() as i64 > MAX_TABLE_INDEX_ROWS;
        let mut indexes = Vec::new();
        for row in rows.into_iter().take(MAX_TABLE_INDEX_ROWS as usize) {
            indexes.push(IndexInfo {
                index_schema: mysql_get_string(&row, 0, "index_schema", "get_table_indexes")?,
                index_name: mysql_get_string(&row, 1, "index_name", "get_table_indexes")?,
                table_schema: mysql_get_string(&row, 2, "table_schema", "get_table_indexes")?,
                table_name: mysql_get_string(&row, 3, "table_name", "get_table_indexes")?,
                is_unique: mysql_get_idx(&row, 4, "is_unique", "get_table_indexes")?,
                is_primary: mysql_get_idx(&row, 5, "is_primary", "get_table_indexes")?,
                is_valid: true,
                is_partial: false,
                definition: mysql_get_string(&row, 8, "definition", "get_table_indexes")?,
                index_bytes: 0,
                idx_scan: 0,
                idx_tup_read: 0,
                idx_tup_fetch: 0,
            });
        }
        return Ok(TableIndexesResult { indexes, truncated });
    }

    if engine == DatabaseEngine::Sqlite {
        let pool = get_or_create_sqlite_pool(&app, &state, &connection_id).await?;
        let pragma_sql = format!(
            "PRAGMA index_list(\"{}\");",
            quote_identifier(&ctx.table_name)
        );
        let rows = sqlx::query(&pragma_sql)
            .fetch_all(&pool)
            .await
            .map_err(|error| error.to_string())?;
        let truncated = rows.len() as i64 > MAX_TABLE_INDEX_ROWS;
        let mut indexes = Vec::new();
        for row in rows.into_iter().take(MAX_TABLE_INDEX_ROWS as usize) {
            let index_name: String = sqlite_get_name(&row, "name", "get_table_indexes")?;
            let index_info_sql = format!("PRAGMA index_info(\"{}\");", quote_identifier(&index_name));
            let index_info_rows = sqlx::query(&index_info_sql)
                .fetch_all(&pool)
                .await
                .map_err(|error| error.to_string())?;
            let index_columns = index_info_rows
                .into_iter()
                .filter_map(|idx| sqlite_get_name::<String>(&idx, "name", "get_table_indexes").ok())
                .collect::<Vec<_>>();
            indexes.push(IndexInfo {
                index_schema: "main".to_string(),
                index_name: index_name.clone(),
                table_schema: "main".to_string(),
                table_name: ctx.table_name.clone(),
                is_unique: sqlite_get_name::<i64>(&row, "unique", "get_table_indexes")? == 1,
                is_primary: sqlite_get_name::<String>(&row, "origin", "get_table_indexes")? == "pk",
                is_valid: true,
                is_partial: sqlite_get_name::<i64>(&row, "partial", "get_table_indexes")? == 1,
                definition: if index_columns.is_empty() {
                    format!("index {}", index_name)
                } else {
                    format!("index {} ({})", index_name, index_columns.join(", "))
                },
                index_bytes: 0,
                idx_scan: 0,
                idx_tup_read: 0,
                idx_tup_fetch: 0,
            });
        }
        return Ok(TableIndexesResult { indexes, truncated });
    }

    with_pool_client_retry(&app, &state, &connection_id, ctx, |client, input| async move {
        let table_schema = input.table_schema;
        let table_name = input.table_name;
        let fetch_limit = MAX_TABLE_INDEX_ROWS + 1;

        let rows = client
            .query(
                "
            select
              ins.nspname::text as index_schema,
              ic.relname::text as index_name,
              tn.nspname::text as table_schema,
              tc.relname::text as table_name,
              i.indisunique as is_unique,
              i.indisprimary as is_primary,
              i.indisvalid as is_valid,
              (i.indpred is not null) as is_partial,
              pg_get_indexdef(i.indexrelid) as definition,
              coalesce(pg_relation_size(i.indexrelid::regclass), 0)::bigint as index_bytes,
              coalesce(s.idx_scan, 0)::bigint as idx_scan,
              coalesce(s.idx_tup_read, 0)::bigint as idx_tup_read,
              coalesce(s.idx_tup_fetch, 0)::bigint as idx_tup_fetch
            from pg_index i
            join pg_class ic on ic.oid = i.indexrelid
            join pg_namespace ins on ins.oid = ic.relnamespace
            join pg_class tc on tc.oid = i.indrelid
            join pg_namespace tn on tn.oid = tc.relnamespace
            left join pg_stat_user_indexes s on s.indexrelid = i.indexrelid
            where tn.nspname = $1
              and tc.relname = $2
              and ins.nspname not in ('pg_catalog', 'information_schema')
            order by ic.relname
            limit $3
            ",
                &[&table_schema, &table_name, &fetch_limit],
            )
            .await
            .map_err(|error| error.to_string())?;

        let truncated = rows.len() as i64 > MAX_TABLE_INDEX_ROWS;
        let take = if truncated {
            MAX_TABLE_INDEX_ROWS as usize
        } else {
            rows.len()
        };

        let mut indexes = Vec::with_capacity(take);
        for row in rows.into_iter().take(take) {
            indexes.push(IndexInfo {
                index_schema: row.get(0),
                index_name: row.get(1),
                table_schema: row.get(2),
                table_name: row.get(3),
                is_unique: row.get(4),
                is_primary: row.get(5),
                is_valid: row.get(6),
                is_partial: row.get(7),
                definition: row.get(8),
                index_bytes: row.get(9),
                idx_scan: row.get(10),
                idx_tup_read: row.get(11),
                idx_tup_fetch: row.get(12),
            });
        }

        Ok(TableIndexesResult { indexes, truncated })
    })
    .await
}

#[tauri::command]
pub async fn execute_ddl_transaction(
    app: AppHandle,
    state: State<'_, AppState>,
    input: DdlBatchRequest,
) -> Result<(), String> {
    let (connection_id, engine) = resolve_connection_engine(&app, &state, input.connection_id.clone()).await?;

    match engine {
        DatabaseEngine::Postgres => {
            with_pool_client_retry(&app, &state, &connection_id, input, |mut client, input| async move {
                let stmts: Vec<String> = input
                    .statements
                    .into_iter()
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect();

                if stmts.is_empty() {
                    return Err("No SQL statements to execute.".to_string());
                }

                let txn = client.transaction().await.map_err(|error| map_pg_err(error, None))?;
                for sql in &stmts {
                    txn.execute(sql.as_str(), &[])
                        .await
                        .map_err(|error| map_pg_err(error, Some(sql.as_str())))?;
                }
                txn.commit().await.map_err(|error| map_pg_err(error, None))?;
                Ok(())
            })
            .await
        }
        DatabaseEngine::Mysql => {
            let pool = get_or_create_mysql_pool(&app, &state, &connection_id).await?;
            let mut tx = pool.begin().await.map_err(|error| error.to_string())?;
            for sql in input
                .statements
                .iter()
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
            {
                sqlx::query(sql)
                    .execute(&mut *tx)
                    .await
                    .map_err(|error| error.to_string())?;
            }
            tx.commit().await.map_err(|error| error.to_string())
        }
        DatabaseEngine::Sqlite => {
            let pool = get_or_create_sqlite_pool(&app, &state, &connection_id).await?;
            let mut tx = pool.begin().await.map_err(|error| error.to_string())?;
            for sql in input
                .statements
                .iter()
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
            {
                sqlx::query(sql)
                    .execute(&mut *tx)
                    .await
                    .map_err(|error| error.to_string())?;
            }
            tx.commit().await.map_err(|error| error.to_string())
        }
    }
}

/// Run a single DDL statement outside an explicit transaction (required for `CREATE INDEX CONCURRENTLY`).
#[tauri::command]
pub async fn execute_ddl_statement(
    app: AppHandle,
    state: State<'_, AppState>,
    input: DdlStatementRequest,
) -> Result<(), String> {
    let (connection_id, engine) = resolve_connection_engine(&app, &state, input.connection_id.clone()).await?;
    let sql = input.statement.trim().to_string();
    if sql.is_empty() {
        return Err("No SQL statement to execute.".to_string());
    }

    match engine {
        DatabaseEngine::Postgres => {
            with_pool_client_retry(&app, &state, &connection_id, sql, |client, sql| async move {
                client
                    .execute(sql.as_str(), &[])
                    .await
                    .map_err(|error| map_pg_err(error, Some(sql.as_str())))?;
                Ok(())
            })
            .await
        }
        DatabaseEngine::Mysql => {
            let pool = get_or_create_mysql_pool(&app, &state, &connection_id).await?;
            sqlx::query(&sql)
                .execute(&pool)
                .await
                .map_err(|error| error.to_string())?;
            Ok(())
        }
        DatabaseEngine::Sqlite => {
            let pool = get_or_create_sqlite_pool(&app, &state, &connection_id).await?;
            sqlx::query(&sql)
                .execute(&pool)
                .await
                .map_err(|error| error.to_string())?;
            Ok(())
        }
    }
}

#[tauri::command]
pub async fn export_diagram_png(
    input: DiagramExportRequest,
    output_path: String,
) -> Result<(), String> {
    let path = std::path::PathBuf::from(&output_path);
    tokio::task::spawn_blocking(move || export_diagram_to_png(&input, &path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn export_results_csv_command(
    app: AppHandle,
    state: State<'_, AppState>,
    input: ExportQueryRequest,
) -> Result<(), String> {
    export_results_csv(&app, &state, &input).await
}

#[tauri::command]
pub async fn export_results_json_command(
    app: AppHandle,
    state: State<'_, AppState>,
    input: ExportQueryRequest,
) -> Result<(), String> {
    export_results_json(&app, &state, &input).await
}

#[tauri::command]
pub async fn save_base64_png(data: String, output_path: String) -> Result<(), String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data.strip_prefix("data:image/png;base64,").unwrap_or(&data))
        .map_err(|e| e.to_string())?;
    std::fs::write(&output_path, bytes).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_text_file(content: String, output_path: String) -> Result<(), String> {
    std::fs::write(&output_path, content).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::{
        build_schema_context, classify_sql_intent, database_name_from_mysql_value,
        decode_mysql_bytes_as_string, extract_openrouter_stream_delta, mysql_decode_error,
        parse_ask_veloxy_json, sqlite_decode_error, streaming_display_text,
        validate_generated_sql,
    };
    use crate::models::{
        AskVeloxyDbContextCache, DatabaseEngine, QueryEditorColumn, QueryEditorMetadata,
        QueryEditorTable,
    };

    #[test]
    fn streaming_display_text_extracts_partial_json_message() {
        let partial = r#"{ "message": "The messages table has relationships with:\n- delivery_reports"#;
        let display = streaming_display_text(partial);
        assert!(display.contains("messages table"));
        assert!(display.contains("delivery_reports"));
    }

    #[test]
    fn streaming_display_text_returns_plain_text_directly() {
        assert_eq!(
            streaming_display_text("Hello from Veloxy"),
            "Hello from Veloxy"
        );
    }

    #[test]
    fn extract_openrouter_stream_delta_reads_content() {
        let data = r#"{"choices":[{"delta":{"content":"Hello"}}]}"#;
        assert_eq!(
            extract_openrouter_stream_delta(data).as_deref(),
            Some("Hello")
        );
    }

    #[test]
    fn database_name_from_mysql_value_rejects_empty() {
        assert!(database_name_from_mysql_value(None, "list_databases").is_err());
        assert!(database_name_from_mysql_value(Some(String::new()), "list_databases").is_err());
    }

    #[test]
    fn database_name_from_mysql_value_accepts_non_empty() {
        let name =
            database_name_from_mysql_value(Some("my_app".to_string()), "list_databases").expect("name");
        assert_eq!(name, "my_app");
    }

    #[test]
    fn decode_mysql_bytes_as_string_uses_utf8_text() {
        assert_eq!(
            decode_mysql_bytes_as_string(b"my_schema"),
            "my_schema"
        );
    }

    #[test]
    fn mysql_decode_error_is_explicit() {
        let message = mysql_decode_error("get_tables", "table_schema", Some(0), "mismatched types");
        assert!(message.contains("MySQL decode error"));
        assert!(message.contains("get_tables"));
        assert!(message.contains("table_schema"));
    }

    #[test]
    fn sqlite_decode_error_is_explicit() {
        let message = sqlite_decode_error("get_schema", "name", Some(0), "unsupported value type");
        assert!(message.contains("SQLite decode error"));
        assert!(message.contains("get_schema"));
        assert!(message.contains("name"));
    }

    #[test]
    fn schema_context_is_bounded() {
        let columns = (0..40)
            .map(|idx| QueryEditorColumn {
                name: format!("column_{}", idx),
                data_type: "text".to_string(),
            })
            .collect::<Vec<_>>();
        let tables = (0..20)
            .map(|idx| QueryEditorTable {
                schema: "public".to_string(),
                name: format!("events_{}", idx),
                columns: columns.clone(),
            })
            .collect::<Vec<_>>();
        let metadata = QueryEditorMetadata {
            tables,
            functions: Vec::new(),
            truncated_tables: false,
            truncated_columns: false,
            truncated_functions: false,
        };
        let db_context = AskVeloxyDbContextCache {
            database_name: "test".to_string(),
            engine: DatabaseEngine::Postgres,
            metadata,
            foreign_keys: Vec::new(),
        };

        let context = build_schema_context(&db_context, "show events", None);
        assert!(!context.is_empty());
        assert!(context.len() <= super::ASK_VELOXY_SCHEMA_CHAR_BUDGET);
    }

    #[test]
    fn ask_veloxy_json_parser_handles_embedded_block() {
        let content = "Here is the output {\"sql\":\"select 1\",\"intent\":\"select\",\"confidence\":0.9,\"warnings\":[]}";
        let parsed = parse_ask_veloxy_json(content).expect("json should parse");
        assert_eq!(parsed.get("sql").and_then(|v| v.as_str()), Some("select 1"));
    }

    #[test]
    fn sql_validation_rejects_multi_statement() {
        let multi = "select 1; select 2;";
        assert!(validate_generated_sql(multi).is_err());
    }

    #[test]
    fn sql_intent_classifier_recognizes_update() {
        assert_eq!(classify_sql_intent("UPDATE foo SET bar = 1"), "update");
    }

    #[test]
    fn mysql_timestamp_formats_as_datetime_string() {
        let dt = chrono::DateTime::parse_from_rfc3339("2024-03-15T10:30:45Z")
            .unwrap()
            .with_timezone(&chrono::Utc);
        assert_eq!(dt.format("%Y-%m-%d %H:%M:%S").to_string(), "2024-03-15 10:30:45");
    }

    #[test]
    fn mysql_datetime_formats_as_naive_datetime_string() {
        let dt = chrono::NaiveDateTime::parse_from_str("2024-03-15 10:30:45", "%Y-%m-%d %H:%M:%S").unwrap();
        assert_eq!(dt.format("%Y-%m-%d %H:%M:%S").to_string(), "2024-03-15 10:30:45");
    }

    #[test]
    fn mysql_date_formats_as_iso_date() {
        let d = chrono::NaiveDate::from_ymd_opt(2024, 3, 15).unwrap();
        assert_eq!(d.to_string(), "2024-03-15");
    }

    #[test]
    fn mysql_time_formats_as_iso_time() {
        let t = chrono::NaiveTime::from_hms_opt(10, 30, 45).unwrap();
        assert_eq!(t.to_string(), "10:30:45");
    }
}
