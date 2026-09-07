use std::collections::BTreeMap;
use std::time::Instant;

use tauri::AppHandle;

use crate::db::{
    ClickhouseConfig, load_connection, AppState, DEFAULT_CLICKHOUSE_PORT,
};
use crate::error::VeloxError;
use crate::models::{
    ColumnInfo, ConnectionInput, ConnectionSslMode, DatabaseInfo, QueryResult, TableInfo,
};
use crate::ssh_tunnel::SshTunnel;

use super::DatabaseEngineOps;

pub struct ClickhouseEngine;

async fn get_or_create_clickhouse_config(
    app: &AppHandle,
    state: &AppState,
    connection_id: &str,
) -> Result<ClickhouseConfig, VeloxError> {
    if let Some(cfg) = state.clickhouse_clients.read().await.get(connection_id).cloned() {
        return Ok(cfg);
    }
    let stored = load_connection(app, connection_id)?
        .ok_or_else(|| VeloxError::Connection("Stored connection details were not found.".to_string()))?;
    let input = stored.to_input();

    let (host, port) = if let Some(ref ssh_config) = input.ssh_config {
        if ssh_config.is_active() {
            let tunnel = SshTunnel::connect(
                ssh_config,
                &input.host,
                if input.port == 0 { DEFAULT_CLICKHOUSE_PORT } else { input.port },
            )
            .await
            .map_err(|e| VeloxError::Connection(format!("SSH tunnel failed: {}", e)))?;
            let local_port = tunnel.local_port;
            state.ssh_tunnels.write().await.insert(connection_id.to_string(), tunnel);
            ("127.0.0.1".to_string(), local_port)
        } else {
            (input.host.clone(), if input.port == 0 { DEFAULT_CLICKHOUSE_PORT } else { input.port })
        }
    } else {
        (input.host.clone(), if input.port == 0 { DEFAULT_CLICKHOUSE_PORT } else { input.port })
    };

    let scheme = match input.ssl_mode {
        ConnectionSslMode::Require => "https",
        _ => "http",
    };
    let resolved_host = if host.is_empty() { "127.0.0.1" } else { &host };
    let base_url = format!("{}://{}:{}", scheme, resolved_host, port);
    let cfg = ClickhouseConfig {
        base_url,
        user: input.user,
        password: input.password,
        database: if input.database.is_empty() { "default".to_string() } else { input.database },
    };
    state.clickhouse_clients.write().await.insert(connection_id.to_string(), cfg.clone());
    Ok(cfg)
}

async fn execute_clickhouse_http(
    config: &ClickhouseConfig,
    sql: &str,
) -> Result<reqwest::Response, VeloxError> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| VeloxError::Connection(e.to_string()))?;

    let url = format!(
        "{}/?database={}&default_format=JSON",
        config.base_url,
        urlencoding::encode(&config.database)
    );

    let mut req = client.post(&url).body(sql.to_string());
    if !config.user.is_empty() {
        req = req.header("X-ClickHouse-User", &config.user);
    }
    if !config.password.is_empty() {
        req = req.header("X-ClickHouse-Key", &config.password);
    }

    req.send().await.map_err(|e| VeloxError::Query(format!("ClickHouse request error: {}", e)))
}

impl DatabaseEngineOps for ClickhouseEngine {
    async fn connect(
        &self,
        _app: &AppHandle,
        state: &AppState,
        input: &ConnectionInput,
        connection_id: &str,
    ) -> Result<(), VeloxError> {
        let (host, port) = if let Some(ref ssh_config) = input.ssh_config {
            if ssh_config.is_active() {
                let tunnel = SshTunnel::connect(
                    ssh_config,
                    &input.host,
                    if input.port == 0 { DEFAULT_CLICKHOUSE_PORT } else { input.port },
                )
                .await
                .map_err(|e| VeloxError::Connection(format!("SSH tunnel failed: {}", e)))?;
                let local_port = tunnel.local_port;
                state.ssh_tunnels.write().await.insert(connection_id.to_string(), tunnel);
                ("127.0.0.1".to_string(), local_port)
            } else {
                (input.host.clone(), if input.port == 0 { DEFAULT_CLICKHOUSE_PORT } else { input.port })
            }
        } else {
            (input.host.clone(), if input.port == 0 { DEFAULT_CLICKHOUSE_PORT } else { input.port })
        };

        let scheme = match input.ssl_mode {
            ConnectionSslMode::Require => "https",
            _ => "http",
        };
        let resolved_host = if host.is_empty() { "127.0.0.1" } else { &host };
        let base_url = format!("{}://{}:{}", scheme, resolved_host, port);
        let config = ClickhouseConfig {
            base_url,
            user: input.user.clone(),
            password: input.password.clone(),
            database: if input.database.is_empty() { "default".to_string() } else { input.database.clone() },
        };

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(12))
            .build()
            .map_err(|e| VeloxError::Connection(e.to_string()))?;

        let ping_url = format!("{}/ping", config.base_url);
        let resp = client.get(&ping_url).send().await
            .map_err(|e| VeloxError::Connection(format!("ClickHouse connection failed: {}", e)))?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(VeloxError::Connection(format!("ClickHouse ping error: {}", body)));
        }

        state.clickhouse_clients.write().await.insert(connection_id.to_string(), config);
        Ok(())
    }

    async fn ping(
        &self,
        app: &AppHandle,
        state: &AppState,
        connection_id: &str,
    ) -> Result<(), VeloxError> {
        let config = get_or_create_clickhouse_config(app, state, connection_id).await?;
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(8))
            .build()
            .map_err(|e| VeloxError::Connection(e.to_string()))?;

        let ping_url = format!("{}/ping", config.base_url);
        let resp = client.get(&ping_url).send().await
            .map_err(|e| VeloxError::Connection(format!("ClickHouse ping failed: {}", e)))?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(VeloxError::Connection(format!("ClickHouse ping error: {}", body)));
        }
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
        let config = get_or_create_clickhouse_config(app, state, connection_id).await?;
        let trimmed = sql.trim();
        let upper = trimmed.to_ascii_uppercase();
        let is_query = upper.starts_with("SELECT")
            || upper.starts_with("SHOW")
            || upper.starts_with("DESCRIBE")
            || upper.starts_with("DESC")
            || upper.starts_with("EXPLAIN")
            || upper.starts_with("WITH");

        let formatted_sql = if is_query && !upper.contains("FORMAT ") {
            format!("{}\nFORMAT JSON", trimmed.trim_end_matches(';'))
        } else {
            trimmed.to_string()
        };

        let start = Instant::now();
        let resp = execute_clickhouse_http(&config, &formatted_sql).await?;
        let elapsed_ms = start.elapsed().as_millis();

        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();

        if !status.is_success() {
            return Err(VeloxError::Query(text.trim().to_string()));
        }

        if text.trim().is_empty() {
            return Ok(QueryResult {
                columns: vec![],
                rows: vec![],
                row_count: 0,
                execution_ms: elapsed_ms,
                truncated: false,
                command_tag: None,
            });
        }

        if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(&text) {
            let mut columns = Vec::new();
            if let Some(meta) = json_val.get("meta").and_then(|m| m.as_array()) {
                for col in meta {
                    let name = col.get("name").and_then(|n| n.as_str()).unwrap_or("").to_string();
                    columns.push(name);
                }
            }

            let mut rows = Vec::new();
            let mut truncated = false;
            let total_rows = json_val.get("rows").and_then(|r| r.as_u64()).unwrap_or(0) as usize;

            if let Some(data) = json_val.get("data").and_then(|d| d.as_array()) {
                for item in data.iter().take(max_rows) {
                    if let Some(obj) = item.as_object() {
                        let mut row = BTreeMap::new();
                        for (k, v) in obj {
                            let str_val = match v {
                                serde_json::Value::Null => None,
                                serde_json::Value::String(s) => Some(s.clone()),
                                _ => Some(v.to_string()),
                            };
                            row.insert(k.clone(), str_val);
                        }
                        rows.push(row);
                    }
                }
                if data.len() > max_rows {
                    truncated = true;
                }
            }

            let row_count = if total_rows > 0 { total_rows } else { rows.len() };
            return Ok(QueryResult {
                columns,
                rows,
                row_count,
                execution_ms: elapsed_ms,
                truncated,
                command_tag: Some(row_count as u64),
            });
        }

        Ok(QueryResult {
            columns: vec![],
            rows: vec![],
            row_count: 0,
            execution_ms: elapsed_ms,
            truncated: false,
            command_tag: None,
        })
    }

    async fn get_tables(
        &self,
        app: &AppHandle,
        state: &AppState,
        connection_id: &str,
    ) -> Result<Vec<TableInfo>, VeloxError> {
        let config = get_or_create_clickhouse_config(app, state, connection_id).await?;
        let query = format!(
            "SELECT name, engine FROM system.tables WHERE database = '{}' AND is_temporary = 0 ORDER BY name FORMAT JSON",
            config.database
        );
        let resp = execute_clickhouse_http(&config, &query).await?;
        let text = resp.text().await.unwrap_or_default();
        let val: serde_json::Value = serde_json::from_str(&text)
            .map_err(|e| VeloxError::Query(format!("Failed to parse ClickHouse tables: {}", e)))?;

        let mut tables = Vec::new();
        if let Some(data) = val.get("data").and_then(|d| d.as_array()) {
            for row in data {
                let name = row.get("name").and_then(|n| n.as_str()).unwrap_or("").to_string();
                let engine = row.get("engine").and_then(|e| e.as_str()).unwrap_or("table").to_string();
                let kind = if engine.to_lowercase().contains("view") { "view" } else { "table" };
                tables.push(TableInfo {
                    preview_query: format!("SELECT * FROM \"{}\".\"{}\" LIMIT 100;", config.database, name),
                    schema: config.database.clone(),
                    name,
                    kind: Some(kind.to_string()),
                });
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
        let config = get_or_create_clickhouse_config(app, state, connection_id).await?;
        let target_db = if table_schema.is_empty() { &config.database } else { table_schema };
        let query = format!(
            "SELECT name, type FROM system.columns WHERE database = '{}' AND table = '{}' ORDER BY position FORMAT JSON",
            target_db.replace('\'', "''"),
            table_name.replace('\'', "''")
        );
        let resp = execute_clickhouse_http(&config, &query).await?;
        let text = resp.text().await.unwrap_or_default();
        let val: serde_json::Value = serde_json::from_str(&text)
            .map_err(|e| VeloxError::Query(format!("Failed to parse ClickHouse schema: {}", e)))?;

        let mut columns = Vec::new();
        if let Some(data) = val.get("data").and_then(|d| d.as_array()) {
            for row in data {
                let col_name = row.get("name").and_then(|n| n.as_str()).unwrap_or("").to_string();
                let typ = row.get("type").and_then(|t| t.as_str()).unwrap_or("String").to_string();
                let is_nullable = typ.starts_with("Nullable(");
                columns.push(ColumnInfo {
                    table_schema: target_db.to_string(),
                    table_name: table_name.to_string(),
                    column_name: col_name,
                    data_type: typ,
                    is_nullable,
                });
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
        let config = get_or_create_clickhouse_config(app, state, connection_id).await?;
        let query = "SELECT name FROM system.databases ORDER BY name FORMAT JSON";
        let resp = execute_clickhouse_http(&config, query).await?;
        let text = resp.text().await.unwrap_or_default();
        let val: serde_json::Value = serde_json::from_str(&text)
            .map_err(|e| VeloxError::Query(format!("Failed to parse ClickHouse databases: {}", e)))?;

        let mut databases = Vec::new();
        if let Some(data) = val.get("data").and_then(|d| d.as_array()) {
            for row in data {
                if let Some(name) = row.get("name").and_then(|n| n.as_str()) {
                    databases.push(DatabaseInfo {
                        name: name.to_string(),
                    });
                }
            }
        }
        Ok(databases)
    }
}
