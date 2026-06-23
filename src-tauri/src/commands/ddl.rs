use tauri::{AppHandle, State};

use crate::db::{
    get_or_create_duckdb_connection, get_or_create_mysql_pool, get_or_create_sqlite_pool,
    resolve_connection_engine, with_pool_client_retry, AppState,
};
use crate::models::{DatabaseEngine, DdlBatchRequest, DdlStatementRequest};
use crate::pg_error::map_pg_err;

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
                let stmts: Vec<String> = input.statements.into_iter()
                    .map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();

                if stmts.is_empty() {
                    return Err("No SQL statements to execute.".to_string());
                }

                let txn = client.transaction().await.map_err(|error| map_pg_err(error, None))?;
                for sql in &stmts {
                    txn.execute(sql.as_str(), &[]).await
                        .map_err(|error| map_pg_err(error, Some(sql.as_str())))?;
                }
                txn.commit().await.map_err(|error| map_pg_err(error, None))?;
                Ok(())
            }).await
        }
        DatabaseEngine::Mysql => {
            let pool = get_or_create_mysql_pool(&app, &state, &connection_id).await?;
            let mut tx = pool.begin().await.map_err(|error| error.to_string())?;
            for sql in input.statements.iter().map(|s| s.trim()).filter(|s| !s.is_empty()) {
                sqlx::query(sql).execute(&mut *tx).await.map_err(|error| error.to_string())?;
            }
            tx.commit().await.map_err(|error| error.to_string())
        }
        DatabaseEngine::Sqlite => {
            let pool = get_or_create_sqlite_pool(&app, &state, &connection_id).await?;
            let mut tx = pool.begin().await.map_err(|error| error.to_string())?;
            for sql in input.statements.iter().map(|s| s.trim()).filter(|s| !s.is_empty()) {
                sqlx::query(sql).execute(&mut *tx).await.map_err(|error| error.to_string())?;
            }
            tx.commit().await.map_err(|error| error.to_string())
        }
        DatabaseEngine::Mongo => {
            Err("MongoDB does not support DDL transactions.".to_string())
        }
        DatabaseEngine::Duckdb => {
            get_or_create_duckdb_connection(&app, &state, &connection_id).await?;
            let conns = state.duckdb_connections.read().await;
            let conn_mutex = conns.get(&connection_id).ok_or("DuckDB connection not found")?;
            let conn = conn_mutex.lock().await;
            for sql in input.statements.iter().map(|s| s.trim()).filter(|s| !s.is_empty()) {
                conn.execute(sql, []).map_err(|e| format!("DuckDB DDL failed: {}", e))?;
            }
            Ok(())
        }
        DatabaseEngine::Redis => Err("Not supported for Redis.".to_string()),
    }
}

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
                client.execute(sql.as_str(), &[]).await
                    .map_err(|error| map_pg_err(error, Some(sql.as_str())))?;
                Ok(())
            }).await
        }
        DatabaseEngine::Mysql => {
            let pool = get_or_create_mysql_pool(&app, &state, &connection_id).await?;
            sqlx::query(&sql).execute(&pool).await.map_err(|error| error.to_string())?;
            Ok(())
        }
        DatabaseEngine::Sqlite => {
            let pool = get_or_create_sqlite_pool(&app, &state, &connection_id).await?;
            sqlx::query(&sql).execute(&pool).await.map_err(|error| error.to_string())?;
            Ok(())
        }
        DatabaseEngine::Mongo => {
            Err("MongoDB does not support DDL statements.".to_string())
        }
        DatabaseEngine::Duckdb => {
            get_or_create_duckdb_connection(&app, &state, &connection_id).await?;
            let conns = state.duckdb_connections.read().await;
            let conn_mutex = conns.get(&connection_id).ok_or("DuckDB connection not found")?;
            let conn = conn_mutex.lock().await;
            conn.execute(&sql, []).map_err(|e| format!("DuckDB DDL failed: {}", e))?;
            Ok(())
        }
        DatabaseEngine::Redis => Err("Not supported for Redis.".to_string()),
    }
}
