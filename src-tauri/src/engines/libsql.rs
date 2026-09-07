use std::collections::BTreeMap;
use std::time::Instant;

use tauri::AppHandle;

use crate::db::{
    TursoConfig, load_connection, AppState, DEFAULT_TURSO_PORT,
};
use crate::error::VeloxError;
use crate::models::{
    ColumnInfo, ConnectionInput, ConnectionSslMode, DatabaseInfo, QueryResult, TableInfo,
};

use super::sqlite::SqliteEngine;
use super::DatabaseEngineOps;

pub struct LibsqlEngine;

fn is_local_file(input: &ConnectionInput) -> bool {
    if let Some(ref fp) = input.file_path {
        !fp.trim().is_empty()
    } else {
        false
    }
}

fn resolve_libsql_base_url(input: &ConnectionInput) -> String {
    let raw = input.host.trim();
    if raw.starts_with("libsql://") {
        return raw.replacen("libsql://", "https://", 1);
    }
    if raw.starts_with("http://") || raw.starts_with("https://") {
        return raw.to_string();
    }
    let scheme = if input.port == 443 || input.ssl_mode == ConnectionSslMode::Require {
        "https"
    } else {
        "http"
    };
    let port = if input.port == 0 { DEFAULT_TURSO_PORT } else { input.port };
    let host = if raw.is_empty() { "127.0.0.1" } else { raw };
    if (scheme == "https" && port == 443) || (scheme == "http" && port == 80) {
        format!("{}://{}", scheme, host)
    } else {
        format!("{}://{}:{}", scheme, host, port)
    }
}

async fn get_or_create_turso_config(
    app: &AppHandle,
    state: &AppState,
    connection_id: &str,
) -> Result<TursoConfig, VeloxError> {
    if let Some(cfg) = state.turso_clients.read().await.get(connection_id).cloned() {
        return Ok(cfg);
    }
    let stored = load_connection(app, connection_id)?
        .ok_or_else(|| VeloxError::Connection("Stored connection details were not found.".to_string()))?;
    let input = stored.to_input();

    let base_url = resolve_libsql_base_url(&input);
    let cfg = TursoConfig {
        base_url,
        auth_token: input.password,
        database: if input.database.is_empty() { "main".to_string() } else { input.database },
    };
    state.turso_clients.write().await.insert(connection_id.to_string(), cfg.clone());
    Ok(cfg)
}

async fn execute_pipeline_stmt(
    config: &TursoConfig,
    sql: &str,
) -> Result<serde_json::Value, VeloxError> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| VeloxError::Connection(e.to_string()))?;

    let url = format!("{}/v2/pipeline", config.base_url.trim_end_matches('/'));
    let payload = serde_json::json!({
        "requests": [
            { "type": "execute", "stmt": { "sql": sql } },
            { "type": "close" }
        ]
    });

    let mut req = client.post(&url).json(&payload);
    if !config.auth_token.is_empty() {
        req = req.header("Authorization", format!("Bearer {}", config.auth_token));
    }

    let resp = req.send().await.map_err(|e| VeloxError::Query(format!("LibSQL / Turso request failed: {}", e)))?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();

    if !status.is_success() {
        return Err(VeloxError::Query(format!("LibSQL / Turso error ({}): {}", status, text)));
    }

    let json_val: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| VeloxError::Query(format!("Invalid LibSQL JSON response: {}", e)))?;

    if let Some(results) = json_val.get("results").and_then(|r| r.as_array()) {
        if let Some(first) = results.first() {
            let typ = first.get("type").and_then(|t| t.as_str()).unwrap_or("");
            if typ == "error" {
                let msg = first.get("error").and_then(|e| e.get("message")).and_then(|m| m.as_str()).unwrap_or("Unknown LibSQL error");
                return Err(VeloxError::Query(msg.to_string()));
            }
            if typ == "ok" {
                if let Some(res) = first.get("response").and_then(|r| r.get("result")) {
                    return Ok(res.clone());
                }
            }
        }
    }

    Ok(json_val)
}

impl DatabaseEngineOps for LibsqlEngine {
    async fn connect(
        &self,
        app: &AppHandle,
        state: &AppState,
        input: &ConnectionInput,
        connection_id: &str,
    ) -> Result<(), VeloxError> {
        if is_local_file(input) {
            return SqliteEngine.connect(app, state, input, connection_id).await;
        }

        let base_url = resolve_libsql_base_url(input);
        let config = TursoConfig {
            base_url,
            auth_token: input.password.clone(),
            database: if input.database.is_empty() { "main".to_string() } else { input.database.clone() },
        };

        // Ping test via pipeline
        let res = execute_pipeline_stmt(&config, "SELECT 1").await?;
        if res.get("cols").is_none() && res.get("rows").is_none() {
            return Err(VeloxError::Connection("Unexpected response from LibSQL endpoint.".to_string()));
        }

        state.turso_clients.write().await.insert(connection_id.to_string(), config);
        Ok(())
    }

    async fn ping(
        &self,
        app: &AppHandle,
        state: &AppState,
        connection_id: &str,
    ) -> Result<(), VeloxError> {
        let stored = load_connection(app, connection_id)?
            .ok_or_else(|| VeloxError::Connection("Stored connection details were not found.".to_string()))?;
        let input = stored.to_input();
        if is_local_file(&input) {
            return SqliteEngine.ping(app, state, connection_id).await;
        }

        let config = get_or_create_turso_config(app, state, connection_id).await?;
        execute_pipeline_stmt(&config, "SELECT 1").await?;
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
        let stored = load_connection(app, connection_id)?
            .ok_or_else(|| VeloxError::Connection("Stored connection details were not found.".to_string()))?;
        let input = stored.to_input();
        if is_local_file(&input) {
            return SqliteEngine.run_query(app, state, connection_id, sql, max_rows).await;
        }

        let config = get_or_create_turso_config(app, state, connection_id).await?;
        let start = Instant::now();
        let result = execute_pipeline_stmt(&config, sql).await?;
        let elapsed_ms = start.elapsed().as_millis();

        let mut columns = Vec::new();
        if let Some(cols) = result.get("cols").and_then(|c| c.as_array()) {
            for col in cols {
                let name = col.get("name").and_then(|n| n.as_str()).unwrap_or("").to_string();
                columns.push(name);
            }
        }

        let mut rows = Vec::new();
        let mut truncated = false;
        let mut row_count = 0;

        if let Some(row_items) = result.get("rows").and_then(|r| r.as_array()) {
            row_count = row_items.len();
            for item in row_items.iter().take(max_rows) {
                if let Some(cells) = item.as_array() {
                    let mut row = BTreeMap::new();
                    for (idx, cell) in cells.iter().enumerate() {
                        let col_name = columns.get(idx).cloned().unwrap_or_default();
                        let cell_type = cell.get("type").and_then(|t| t.as_str()).unwrap_or("null");
                        let val_str = if cell_type == "null" {
                            None
                        } else {
                            cell.get("value").map(|v| match v {
                                serde_json::Value::String(s) => s.clone(),
                                _ => v.to_string(),
                            })
                        };
                        row.insert(col_name, val_str);
                    }
                    rows.push(row);
                }
            }
            if row_items.len() > max_rows {
                truncated = true;
            }
        } else if let Some(affected) = result.get("affected_row_count").and_then(|a| a.as_u64()) {
            row_count = affected as usize;
        }

        Ok(QueryResult {
            columns,
            rows,
            row_count,
            execution_ms: elapsed_ms,
            truncated,
            command_tag: Some(row_count as u64),
        })
    }

    async fn get_tables(
        &self,
        app: &AppHandle,
        state: &AppState,
        connection_id: &str,
    ) -> Result<Vec<TableInfo>, VeloxError> {
        let stored = load_connection(app, connection_id)?
            .ok_or_else(|| VeloxError::Connection("Stored connection details were not found.".to_string()))?;
        let input = stored.to_input();
        if is_local_file(&input) {
            return SqliteEngine.get_tables(app, state, connection_id).await;
        }

        let config = get_or_create_turso_config(app, state, connection_id).await?;
        let sql = "SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name";
        let res = execute_pipeline_stmt(&config, sql).await?;

        let mut tables = Vec::new();
        if let Some(row_items) = res.get("rows").and_then(|r| r.as_array()) {
            for item in row_items {
                if let Some(cells) = item.as_array() {
                    let name = cells.get(0).and_then(|c| c.get("value")).and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let typ = cells.get(1).and_then(|c| c.get("value")).and_then(|v| v.as_str()).unwrap_or("table").to_string();
                    let kind = if typ == "view" { "view" } else { "table" };
                    tables.push(TableInfo {
                        preview_query: format!("SELECT * FROM \"{}\" LIMIT 100;", name),
                        schema: "main".to_string(),
                        name,
                        kind: Some(kind.to_string()),
                    });
                }
            }
        }
        Ok(tables)
    }

    async fn get_schema(
        &self,
        app: &AppHandle,
        state: &AppState,
        connection_id: &str,
        table_schema: &str,
        table_name: &str,
    ) -> Result<Vec<ColumnInfo>, VeloxError> {
        let stored = load_connection(app, connection_id)?
            .ok_or_else(|| VeloxError::Connection("Stored connection details were not found.".to_string()))?;
        let input = stored.to_input();
        if is_local_file(&input) {
            return SqliteEngine.get_schema(app, state, connection_id, table_schema, table_name).await;
        }

        let config = get_or_create_turso_config(app, state, connection_id).await?;
        let sql = format!("PRAGMA table_info(\"{}\")", table_name.replace('"', "\"\""));
        let res = execute_pipeline_stmt(&config, &sql).await?;

        let mut columns = Vec::new();
        if let Some(row_items) = res.get("rows").and_then(|r| r.as_array()) {
            for item in row_items {
                if let Some(cells) = item.as_array() {
                    // PRAGMA table_info: cid, name, type, notnull, dflt_value, pk
                    let name = cells.get(1).and_then(|c| c.get("value")).and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let typ = cells.get(2).and_then(|c| c.get("value")).and_then(|v| v.as_str()).unwrap_or("TEXT").to_string();
                    let notnull = cells.get(3).and_then(|c| c.get("value")).and_then(|v| match v {
                        serde_json::Value::Number(n) => n.as_i64(),
                        serde_json::Value::String(s) => s.parse().ok(),
                        _ => None,
                    }).unwrap_or(0) == 1;

                    columns.push(ColumnInfo {
                        table_schema: "main".to_string(),
                        table_name: table_name.to_string(),
                        column_name: name,
                        data_type: typ,
                        is_nullable: !notnull,
                    });
                }
            }
        }
        Ok(columns)
    }

    async fn list_databases(
        &self,
        app: &AppHandle,
        state: &AppState,
        connection_id: &str,
    ) -> Result<Vec<DatabaseInfo>, VeloxError> {
        let stored = load_connection(app, connection_id)?
            .ok_or_else(|| VeloxError::Connection("Stored connection details were not found.".to_string()))?;
        let input = stored.to_input();
        if is_local_file(&input) {
            return SqliteEngine.list_databases(app, state, connection_id).await;
        }

        let config = get_or_create_turso_config(app, state, connection_id).await?;
        Ok(vec![DatabaseInfo {
            name: config.database,
        }])
    }
}
