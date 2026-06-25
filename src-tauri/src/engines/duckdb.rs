use std::collections::BTreeMap;
use std::time::Instant;

use tauri::AppHandle;

use crate::db::{
    build_duckdb_connection, get_or_create_duckdb_connection, AppState,
};
use crate::error::VeloxError;
use crate::models::{ColumnInfo, ConnectionInput, DatabaseInfo, QueryResult, TableInfo};

use super::DatabaseEngineOps;

pub struct DuckdbEngine;

impl DatabaseEngineOps for DuckdbEngine {
    async fn connect(
        &self,
        _app: &AppHandle,
        state: &AppState,
        input: &ConnectionInput,
        connection_id: &str,
    ) -> Result<(), VeloxError> {
        let conn = build_duckdb_connection(input)?;
        state.duckdb_connections.write().await.insert(
            connection_id.to_string(),
            tokio::sync::Mutex::new(conn),
        );
        Ok(())
    }

    async fn ping(
        &self,
        app: &AppHandle,
        state: &AppState,
        connection_id: &str,
    ) -> Result<(), VeloxError> {
        get_or_create_duckdb_connection(app, state, connection_id).await?;
        let conns = state.duckdb_connections.read().await;
        let conn = conns.get(connection_id)
            .ok_or_else(|| VeloxError::Connection("DuckDB connection not found".to_string()))?;
        let conn = conn.lock().await;
        conn.execute_batch("SELECT 1")
            .map_err(|e| VeloxError::Connection(format!("DuckDB ping failed: {}", e)))?;
        Ok(())
    }

    async fn run_query(
        &self,
        app: &AppHandle,
        state: &AppState,
        connection_id: &str,
        sql: &str,
        max_rows: usize,
    ) -> Result<QueryResult, VeloxError> {
        get_or_create_duckdb_connection(app, state, connection_id).await?;
        let conns = state.duckdb_connections.read().await;
        let conn_mutex = conns.get(connection_id)
            .ok_or_else(|| VeloxError::Connection("DuckDB connection not found".to_string()))?;
        let conn = conn_mutex.lock().await;

        let is_select = sql.trim().to_uppercase().starts_with("SELECT")
            || sql.trim().to_uppercase().starts_with("WITH");

        let started_at = Instant::now();

        if is_select {
            let stmt = conn.prepare(sql)
                .map_err(|e| VeloxError::Query(e.to_string()))?;
            let col_count = stmt.column_count();
            let columns: Vec<String> = (0..col_count)
                .map(|i| stmt.column_name(i).map_or("?".to_string(), |v| v.to_string()))
                .collect();

            let mut rows = Vec::new();
            let mut stmt = conn.prepare(sql)
                .map_err(|e| VeloxError::Query(e.to_string()))?;
            let results = stmt.query_map([], |row| {
                let vals: Vec<Option<String>> = (0..col_count).map(|i| {
                    row.get::<_, Option<String>>(i).ok().flatten()
                }).collect();
                Ok(vals)
            }).map_err(|e| VeloxError::Query(e.to_string()))?;

            let mut total = 0usize;
            for result in results {
                let vals = result.map_err(|e| VeloxError::Query(e.to_string()))?;
                if rows.len() < max_rows {
                    let mut map = BTreeMap::new();
                    for (i, col) in columns.iter().enumerate() {
                        map.insert(col.clone(), vals[i].clone());
                    }
                    rows.push(map);
                }
                total += 1;
            }
            Ok(QueryResult {
                columns,
                row_count: rows.len(),
                rows,
                execution_ms: started_at.elapsed().as_millis(),
                truncated: total > max_rows,
                command_tag: None,
            })
        } else {
            let affected = conn.execute(sql, [])
                .map_err(|e| VeloxError::Query(e.to_string()))?;
            Ok(QueryResult {
                columns: vec![],
                row_count: affected,
                rows: vec![],
                execution_ms: started_at.elapsed().as_millis(),
                truncated: false,
                command_tag: Some(affected as u64),
            })
        }
    }

    async fn get_tables(
        &self,
        app: &AppHandle,
        state: &AppState,
        connection_id: &str,
    ) -> Result<Vec<TableInfo>, VeloxError> {
        get_or_create_duckdb_connection(app, state, connection_id).await?;
        let conns = state.duckdb_connections.read().await;
        let conn_mutex = conns.get(connection_id)
            .ok_or_else(|| VeloxError::Connection("DuckDB connection not found".to_string()))?;
        let conn = conn_mutex.lock().await;

        let mut stmt = conn.prepare(
            "SELECT table_name FROM information_schema.tables WHERE table_schema='main' ORDER BY table_name"
        ).map_err(|e| VeloxError::Query(e.to_string()))?;

        let names: Vec<String> = stmt.query_map([], |row| row.get(0))
            .map_err(|e| VeloxError::Query(e.to_string()))?
            .filter_map(|r| r.ok())
            .collect();

        Ok(names.into_iter().map(|name| TableInfo {
            schema: "main".to_string(),
            name: name.clone(),
            preview_query: format!("SELECT * FROM \"{}\" LIMIT 100;", name),
        }).collect())
    }

    async fn get_schema(
        &self,
        app: &AppHandle,
        state: &AppState,
        connection_id: &str,
        _table_schema: &str,
        table_name: &str,
    ) -> Result<Vec<ColumnInfo>, VeloxError> {
        get_or_create_duckdb_connection(app, state, connection_id).await?;
        let conns = state.duckdb_connections.read().await;
        let conn_mutex = conns.get(connection_id)
            .ok_or_else(|| VeloxError::Connection("DuckDB connection not found".to_string()))?;
        let conn = conn_mutex.lock().await;

        let mut stmt = conn.prepare(
            "SELECT column_name, data_type FROM information_schema.columns \
             WHERE table_name=? ORDER BY ordinal_position"
        ).map_err(|e| VeloxError::Query(e.to_string()))?;

        let cols: Vec<(String, String)> = stmt.query_map(
            duckdb::params![table_name],
            |row| Ok((row.get(0)?, row.get(1)?)),
        ).map_err(|e| VeloxError::Query(e.to_string()))?
        .filter_map(|r| r.ok())
        .collect();

        Ok(cols.into_iter().map(|(name, dtype)| ColumnInfo {
            table_schema: "main".to_string(),
            table_name: table_name.to_string(),
            column_name: name,
            data_type: dtype,
            is_nullable: true,
        }).collect())
    }

    async fn list_databases(
        &self,
        _app: &AppHandle,
        _state: &AppState,
        _connection_id: &str,
    ) -> Result<Vec<DatabaseInfo>, VeloxError> {
        Ok(vec![DatabaseInfo { name: "main".to_string() }])
    }
}
