use tauri::{AppHandle, State};

use crate::db::{
    get_or_create_mysql_pool, get_or_create_sqlite_pool, resolve_connection_engine,
    with_pool_client_retry, AppState,
};
use crate::models::{DatabaseEngine, LintSqlRequest, LintSqlResult, SqlDiagnostic};
use crate::pg_error::{error_line_column, map_pg_err};

use super::MAX_LINT_SQL_BYTES;

#[tauri::command]
pub async fn lint_sql(
    app: AppHandle,
    state: State<'_, AppState>,
    input: LintSqlRequest,
) -> Result<LintSqlResult, String> {
    let (connection_id, engine) = resolve_connection_engine(&app, &state, input.connection_id.clone()).await?;
    let sql = input.sql.trim().to_string();
    if sql.is_empty() {
        return Ok(LintSqlResult { diagnostics: Vec::new() });
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
            }).await
        }
        DatabaseEngine::Mysql => {
            let pool = get_or_create_mysql_pool(&app, &state, &connection_id).await?;
            let lint_sql = format!("EXPLAIN {}", sql);
            let diagnostics = match sqlx::query(&lint_sql).execute(&pool).await {
                Ok(_) => Vec::new(),
                Err(error) => vec![SqlDiagnostic {
                    message: error.to_string(),
                    severity: "error".to_string(),
                    line: None, column: None, end_line: None, end_column: None,
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
                    line: None, column: None, end_line: None, end_column: None,
                }],
            };
            Ok(LintSqlResult { diagnostics })
        }
        DatabaseEngine::Mongo => {
            Err("MongoDB does not support SQL linting.".to_string())
        }
        DatabaseEngine::Duckdb => {
            let conns = state.duckdb_connections.read().await;
            let conn_mutex = conns
                .get(&connection_id)
                .ok_or("DuckDB connection not found.".to_string())?;
            let conn = conn_mutex.lock().await;
            let lint_sql = format!("EXPLAIN {}", sql);
            match conn.prepare(&lint_sql) {
                Ok(_) => Ok(LintSqlResult { diagnostics: vec![] }),
                Err(e) => Ok(LintSqlResult {
                    diagnostics: vec![SqlDiagnostic {
                        message: e.to_string(),
                        severity: "error".to_string(),
                        line: None,
                        column: None,
                        end_line: None,
                        end_column: None,
                    }],
                }),
            }
        }
        DatabaseEngine::Redis => Err("Not supported for Redis.".to_string()),
    }
}
