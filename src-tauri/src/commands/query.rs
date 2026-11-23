use tauri::{AppHandle, State};

use crate::db::{resolve_connection_engine, AppState, MAX_QUERY_ROWS};
use crate::engines;
use crate::engines::DatabaseEngineOps;
use crate::models::{ColumnInfo, DatabaseEngine, QueryRequest, QueryResult, SchemaRequest, TableInfo};

use super::{is_read_only_redis_command, is_read_only_sql};

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

    let allow_write = input.allow_write.unwrap_or(false);
    if !allow_write {
        // SQL engines get the SQL read-only check. MongoDB only executes find()
        // here (always read-only). Redis has its own read-only command list so
        // write commands such as SET/DEL still require confirmation.
        let read_only = match engine {
            DatabaseEngine::Mongo => true,
            DatabaseEngine::Redis => is_read_only_redis_command(&sql),
            _ => is_read_only_sql(&sql),
        };
        if !read_only {
            return Err(
                "This statement modifies data or schema. Confirm execution in the editor, \
                 or use the model/DDL workflow for schema changes.".to_string(),
            );
        }
    }

    let max_query_rows = input.max_rows.unwrap_or(MAX_QUERY_ROWS);

    let ops = engines::get_engine(engine);
    let result = if allow_write {
        ops.run_query(&app, &state, &connection_id, &sql, max_query_rows).await
    } else {
        ops.run_read_only_query(&app, &state, &connection_id, &sql, max_query_rows).await
    };
    result.map_err(String::from)
}

#[tauri::command]
pub async fn get_tables(
    app: AppHandle,
    state: State<'_, AppState>,
    connection_id: Option<String>,
) -> Result<Vec<TableInfo>, String> {
    let (connection_id, engine) = resolve_connection_engine(&app, &state, connection_id).await?;

    let ops = engines::get_engine(engine);
    ops.get_tables(&app, &state, &connection_id).await.map_err(String::from)
}

#[tauri::command]
pub async fn get_schema(
    app: AppHandle,
    state: State<'_, AppState>,
    input: SchemaRequest,
) -> Result<Vec<ColumnInfo>, String> {
    let (connection_id, engine) = resolve_connection_engine(&app, &state, input.connection_id.clone()).await?;

    let ops = engines::get_engine(engine);
    ops.get_schema(&app, &state, &connection_id, &input.table_schema, &input.table_name).await.map_err(String::from)
}
