use std::time::Instant;
use tauri::{AppHandle, State};
use tokio_postgres::SimpleQueryMessage;

use crate::db::{
    get_or_create_mysql_pool, get_or_create_sqlite_pool, load_connection, quote_identifier,
    require_safe_identifier, resolve_connection_engine, with_pool_client_retry, AppState, MAX_QUERY_ROWS,
};
use crate::models::{
    ColumnInfo, DatabaseEngine, QueryRequest, QueryResult, SchemaRequest, TableInfo,
};
use crate::pg_error::map_pg_err;

use super::{is_read_only_sql, run_query_mysql_or_sqlite, mysql_get_string, sqlite_get_idx, sqlite_get_name};
use super::mongo::{mongo_run_query, mongo_get_collections, mongo_get_schema};

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

    match engine {
        DatabaseEngine::Postgres => {
            with_pool_client_retry(&app, &state, &connection_id, sql, |client, sql| async move {
                let started_at = Instant::now();
                let messages = client.simple_query(&sql).await
                    .map_err(|error| map_pg_err(error, Some(sql.as_str())))?;

                let mut columns = Vec::new();
                let mut rows = Vec::new();
                let mut total_rows = 0usize;
                let mut command_tag = None;

                for message in messages {
                    match message {
                        SimpleQueryMessage::RowDescription(description) => {
                            if columns.is_empty() {
                                columns = description.iter()
                                    .map(|column| column.name().to_string()).collect();
                            }
                        }
                        SimpleQueryMessage::Row(row) => {
                            total_rows += 1;
                            if columns.is_empty() {
                                columns = row.columns().iter()
                                    .map(|column| column.name().to_string()).collect();
                            }
                            if rows.len() >= max_query_rows { continue; }
                            let mut mapped_row = std::collections::BTreeMap::new();
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
            }).await
        }
        DatabaseEngine::Mysql | DatabaseEngine::Sqlite => {
            run_query_mysql_or_sqlite(&app, &state, &connection_id, &sql, max_query_rows, engine).await
        }
        DatabaseEngine::Mongo => {
            mongo_run_query(app, state, QueryRequest {
                connection_id: Some(connection_id),
                sql: sql.clone(),
                max_rows: input.max_rows,
                allow_write: input.allow_write,
            }).await
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
                let rows = client.query(
                    "select table_schema, table_name \
                     from information_schema.tables \
                     where table_type = 'BASE TABLE' \
                       and table_schema not in ('pg_catalog', 'information_schema') \
                     order by table_schema, table_name",
                    &[],
                ).await.map_err(|error| map_pg_err(error, None))?;

                Ok(rows.into_iter().map(|row| {
                    let schema: String = row.get(0);
                    let name: String = row.get(1);
                    let preview_query = format!(
                        "select * from \"{}\".\"{}\" limit 100;",
                        quote_identifier(&schema), quote_identifier(&name)
                    );
                    TableInfo { schema, name, preview_query }
                }).collect())
            }).await
        }
        DatabaseEngine::Mysql => {
            let pool = get_or_create_mysql_pool(&app, &state, &connection_id).await?;
            let database = load_connection(&app, &connection_id)?
                .map(|connection| connection.database).unwrap_or_default();
            let rows = sqlx::query(
                "select table_schema, table_name \
                 from information_schema.tables \
                 where table_type = 'BASE TABLE' \
                   and table_schema = ? \
                   and table_schema not in ('information_schema', 'mysql', 'performance_schema', 'sys') \
                 order by table_schema, table_name",
            ).bind(&database).fetch_all(&pool).await.map_err(|error| error.to_string())?;
            let mut tables = Vec::new();
            for row in rows {
                let schema: String = mysql_get_string(&row, 0, "table_schema", "get_tables")?;
                let name: String = mysql_get_string(&row, 1, "table_name", "get_tables")?;
                tables.push(TableInfo {
                    preview_query: format!("select * from `{}`.`{}` limit 100;", schema, name),
                    schema, name,
                });
            }
            Ok(tables)
        }
        DatabaseEngine::Sqlite => {
            let pool = get_or_create_sqlite_pool(&app, &state, &connection_id).await?;
            let rows = sqlx::query(
                "select name from sqlite_master \
                 where type = 'table' and name not like 'sqlite_%' order by name",
            ).fetch_all(&pool).await.map_err(|error| error.to_string())?;
            let mut tables = Vec::new();
            for row in rows {
                let name: String = sqlite_get_idx(&row, 0, "name", "get_tables")?;
                require_safe_identifier(&name, "table name")?;
                tables.push(TableInfo {
                    schema: "main".to_string(),
                    preview_query: format!("select * from \"{}\" limit 100;", quote_identifier(&name)),
                    name,
                });
            }
            Ok(tables)
        }
        DatabaseEngine::Mongo => {
            mongo_get_collections(app, state, Some(connection_id)).await
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
            with_pool_client_retry(&app, &state, &connection_id, schema_request, |client, input| async move {
                let rows = client.query(
                    "select table_schema, table_name, column_name, data_type, is_nullable \
                     from information_schema.columns \
                     where table_schema = $1 and table_name = $2 \
                     order by ordinal_position",
                    &[&input.table_schema, &input.table_name],
                ).await.map_err(|error| map_pg_err(error, None))?;

                Ok(rows.into_iter().map(|row| ColumnInfo {
                    table_schema: row.get(0),
                    table_name: row.get(1),
                    column_name: row.get(2),
                    data_type: row.get(3),
                    is_nullable: row.get::<_, String>(4) == "YES",
                }).collect())
            }).await
        }
        DatabaseEngine::Mysql => {
            let pool = get_or_create_mysql_pool(&app, &state, &connection_id).await?;
            let rows = sqlx::query(
                "select table_schema, table_name, column_name, data_type, is_nullable \
                 from information_schema.columns \
                 where table_schema = ? and table_name = ? \
                 order by ordinal_position",
            ).bind(&schema_request.table_schema).bind(&schema_request.table_name)
            .fetch_all(&pool).await.map_err(|error| error.to_string())?;
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
            require_safe_identifier(&schema_request.table_name, "table name")?;
            let pragma_sql = format!("PRAGMA table_info(\"{}\");", quote_identifier(&schema_request.table_name));
            let rows = sqlx::query(&pragma_sql).fetch_all(&pool).await.map_err(|error| error.to_string())?;
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
        DatabaseEngine::Mongo => {
            mongo_get_schema(app, state, input.connection_id, input.table_schema, input.table_name).await
        }
    }
}
