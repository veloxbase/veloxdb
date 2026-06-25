use tauri::{AppHandle, State};

use crate::db::{resolve_connection_engine, AppState, MAX_QUERY_ROWS};
use crate::engines;
use crate::engines::DatabaseEngineOps;
use crate::models::{ColumnInfo, QueryRequest, QueryResult, SchemaRequest, TableInfo};

use super::is_read_only_sql;

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

    if !input.allow_write.unwrap_or(false) && !is_read_only_sql(&sql) {
        return Err(
            "This statement modifies data or schema. Confirm execution in the editor, \
             or use the model/DDL workflow for schema changes.".to_string(),
        );
    }

    let max_query_rows = input.max_rows.unwrap_or(MAX_QUERY_ROWS);

    let ops = engines::get_engine(engine);
    ops.run_query(&app, &state, &connection_id, &sql, max_query_rows).await.map_err(String::from)
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
