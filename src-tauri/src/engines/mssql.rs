use std::collections::BTreeMap;
use std::time::Instant;

use tauri::AppHandle;
use tiberius::{AuthMethod, Client, ColumnData, Config, EncryptionLevel};
use tokio::net::TcpStream;
use tokio_util::compat::{Compat, TokioAsyncWriteCompatExt};

use crate::db::{
    MssqlConfig, load_connection, AppState, DEFAULT_MSSQL_PORT,
};
use crate::error::VeloxError;
use crate::models::{
    ColumnInfo, ConnectionInput, ConnectionSslMode, DatabaseEngine, DatabaseInfo, QueryResult, TableInfo,
};
use crate::ssh_tunnel::SshTunnel;

use super::DatabaseEngineOps;

pub struct MssqlEngine;

fn build_tiberius_config(cfg: &MssqlConfig) -> Result<Config, VeloxError> {
    let mut config = Config::new();
    config.host(&cfg.host);
    config.port(cfg.port);
    config.authentication(AuthMethod::sql_server(&cfg.user, &cfg.password));
    if !cfg.database.is_empty() {
        config.database(&cfg.database);
    }
    if cfg.is_azure || cfg.ssl_mode == ConnectionSslMode::Require {
        config.encryption(EncryptionLevel::Required);
        config.trust_cert();
    } else {
        config.encryption(EncryptionLevel::Off);
    }
    Ok(config)
}

async fn connect_client(cfg: &MssqlConfig) -> Result<Client<Compat<TcpStream>>, VeloxError> {
    let t_cfg = build_tiberius_config(cfg)?;
    let addr = format!("{}:{}", cfg.host, cfg.port);
    let tcp = TcpStream::connect(&addr).await
        .map_err(|e| VeloxError::Connection(format!("MSSQL connection to {} failed: {}", addr, e)))?;
    tcp.set_nodelay(true).ok();
    let client = Client::connect(t_cfg, tcp.compat_write()).await
        .map_err(|e| VeloxError::Connection(format!("MSSQL TDS handshake failed: {}", e)))?;
    Ok(client)
}

async fn get_or_create_mssql_config(
    app: &AppHandle,
    state: &AppState,
    connection_id: &str,
) -> Result<MssqlConfig, VeloxError> {
    if let Some(cfg) = state.mssql_configs.read().await.get(connection_id).cloned() {
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
                if input.port == 0 { DEFAULT_MSSQL_PORT } else { input.port },
            )
            .await
            .map_err(|e| VeloxError::Connection(format!("SSH tunnel failed: {}", e)))?;
            let local_port = tunnel.local_port;
            state.ssh_tunnels.write().await.insert(connection_id.to_string(), tunnel);
            ("127.0.0.1".to_string(), local_port)
        } else {
            (input.host.clone(), if input.port == 0 { DEFAULT_MSSQL_PORT } else { input.port })
        }
    } else {
        (input.host.clone(), if input.port == 0 { DEFAULT_MSSQL_PORT } else { input.port })
    };

    let cfg = MssqlConfig {
        host: if host.is_empty() { "127.0.0.1".to_string() } else { host },
        port,
        user: input.user,
        password: input.password,
        database: if input.database.is_empty() { "master".to_string() } else { input.database },
        is_azure: input.engine == DatabaseEngine::Azuresql,
        ssl_mode: input.ssl_mode,
    };
    state.mssql_configs.write().await.insert(connection_id.to_string(), cfg.clone());
    Ok(cfg)
}

fn column_data_to_string(data: &ColumnData) -> Option<String> {
    match data {
        ColumnData::U8(v) => v.map(|n| n.to_string()),
        ColumnData::I16(v) => v.map(|n| n.to_string()),
        ColumnData::I32(v) => v.map(|n| n.to_string()),
        ColumnData::I64(v) => v.map(|n| n.to_string()),
        ColumnData::F32(v) => v.map(|n| n.to_string()),
        ColumnData::F64(v) => v.map(|n| n.to_string()),
        ColumnData::Bit(v) => v.map(|b| if b { "true".to_string() } else { "false".to_string() }),
        ColumnData::String(v) => v.as_ref().map(|s| s.to_string()),
        ColumnData::Guid(v) => v.map(|g| g.to_string()),
        ColumnData::Binary(v) => v.as_ref().map(|b| format!("0x{}", hex::encode(b))),
        ColumnData::Numeric(v) => v.map(|n| n.to_string()),
        ColumnData::DateTime(v) => v.map(|d| format!("{:?}", d)),
        ColumnData::SmallDateTime(v) => v.map(|d| format!("{:?}", d)),
        ColumnData::Time(v) => v.map(|t| format!("{:?}", t)),
        ColumnData::Date(v) => v.map(|d| format!("{:?}", d)),
        ColumnData::DateTime2(v) => v.map(|d| format!("{:?}", d)),
        ColumnData::DateTimeOffset(v) => v.map(|d| format!("{:?}", d)),
        ColumnData::Xml(v) => v.as_ref().map(|x| format!("{:?}", x)),
    }
}

impl DatabaseEngineOps for MssqlEngine {
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
                    if input.port == 0 { DEFAULT_MSSQL_PORT } else { input.port },
                )
                .await
                .map_err(|e| VeloxError::Connection(format!("SSH tunnel failed: {}", e)))?;
                let local_port = tunnel.local_port;
                state.ssh_tunnels.write().await.insert(connection_id.to_string(), tunnel);
                ("127.0.0.1".to_string(), local_port)
            } else {
                (input.host.clone(), if input.port == 0 { DEFAULT_MSSQL_PORT } else { input.port })
            }
        } else {
            (input.host.clone(), if input.port == 0 { DEFAULT_MSSQL_PORT } else { input.port })
        };

        let cfg = MssqlConfig {
            host: if host.is_empty() { "127.0.0.1".to_string() } else { host },
            port,
            user: input.user.clone(),
            password: input.password.clone(),
            database: if input.database.is_empty() { "master".to_string() } else { input.database.clone() },
            is_azure: input.engine == DatabaseEngine::Azuresql,
            ssl_mode: input.ssl_mode,
        };

        // Validate connectivity
        let mut client = connect_client(&cfg).await?;
        client.simple_query("SELECT 1").await
            .map_err(|e| VeloxError::Connection(format!("MSSQL ping query failed: {}", e)))?;

        state.mssql_configs.write().await.insert(connection_id.to_string(), cfg);
        Ok(())
    }

    async fn ping(
        &self,
        app: &AppHandle,
        state: &AppState,
        connection_id: &str,
    ) -> Result<(), VeloxError> {
        let cfg = get_or_create_mssql_config(app, state, connection_id).await?;
        let mut client = connect_client(&cfg).await?;
        client.simple_query("SELECT 1").await
            .map_err(|e| VeloxError::Connection(format!("MSSQL ping failed: {}", e)))?;
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
        let cfg = get_or_create_mssql_config(app, state, connection_id).await?;
        let mut client = connect_client(&cfg).await?;

        let start = Instant::now();
        let stream = client.simple_query(sql).await
            .map_err(|e| VeloxError::Query(format!("MSSQL query error: {}", e)))?;
        let results = stream.into_results().await
            .map_err(|e| VeloxError::Query(format!("MSSQL error reading results: {}", e)))?;
        let elapsed_ms = start.elapsed().as_millis();

        let mut columns = Vec::new();
        let mut rows = Vec::new();
        let mut truncated = false;
        let mut row_count = 0;

        if let Some(first_set) = results.first() {
            if let Some(first_row) = first_set.first() {
                for col in first_row.columns() {
                    columns.push(col.name().to_string());
                }
            }

            row_count = first_set.len();
            for r in first_set.iter().take(max_rows) {
                let mut row = BTreeMap::new();
                for (col, data) in r.cells() {
                    let val_str = column_data_to_string(data);
                    row.insert(col.name().to_string(), val_str);
                }
                rows.push(row);
            }
            if first_set.len() > max_rows {
                truncated = true;
            }
        }

        let cmd_tag = if !columns.is_empty() {
            Some(row_count as u64)
        } else {
            None
        };

        Ok(QueryResult {
            columns,
            rows,
            row_count,
            execution_ms: elapsed_ms,
            truncated,
            command_tag: cmd_tag,
        })
    }

    async fn get_tables(
        &self,
        app: &AppHandle,
        state: &AppState,
        connection_id: &str,
    ) -> Result<Vec<TableInfo>, VeloxError> {
        let cfg = get_or_create_mssql_config(app, state, connection_id).await?;
        let mut client = connect_client(&cfg).await?;

        let sql = "SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE \
                   FROM INFORMATION_SCHEMA.TABLES \
                   ORDER BY TABLE_SCHEMA, TABLE_NAME";
        let stream = client.simple_query(sql).await
            .map_err(|e| VeloxError::Query(format!("MSSQL error querying tables: {}", e)))?;
        let results = stream.into_results().await
            .map_err(|e| VeloxError::Query(format!("MSSQL error reading table results: {}", e)))?;

        let mut tables = Vec::new();
        if let Some(first_set) = results.first() {
            for r in first_set {
                let schema = r.get::<&str, _>(0).unwrap_or("dbo").to_string();
                let name = r.get::<&str, _>(1).unwrap_or("").to_string();
                let table_type = r.get::<&str, _>(2).unwrap_or("BASE TABLE").to_string();
                let kind = if table_type == "VIEW" { "view" } else { "table" };
                tables.push(TableInfo {
                    preview_query: format!("SELECT TOP 100 * FROM [{schema}].[{name}];"),
                    schema,
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
        let cfg = get_or_create_mssql_config(app, state, connection_id).await?;
        let mut client = connect_client(&cfg).await?;

        let sql = format!(
            "SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE \
             FROM INFORMATION_SCHEMA.COLUMNS \
             WHERE TABLE_SCHEMA = '{}' AND TABLE_NAME = '{}' \
             ORDER BY ORDINAL_POSITION",
            table_schema.replace('\'', "''"),
            table_name.replace('\'', "''")
        );
        let stream = client.simple_query(sql).await
            .map_err(|e| VeloxError::Query(format!("MSSQL error querying schema: {}", e)))?;
        let results = stream.into_results().await
            .map_err(|e| VeloxError::Query(format!("MSSQL error reading schema results: {}", e)))?;

        let mut columns = Vec::new();
        if let Some(first_set) = results.first() {
            for r in first_set {
                let col_name = r.get::<&str, _>(0).unwrap_or("").to_string();
                let data_type = r.get::<&str, _>(1).unwrap_or("nvarchar").to_string();
                let is_nullable = r.get::<&str, _>(2).map(|s| s.eq_ignore_ascii_case("YES")).unwrap_or(true);
                columns.push(ColumnInfo {
                    table_schema: table_schema.to_string(),
                    table_name: table_name.to_string(),
                    column_name: col_name,
                    data_type,
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
        let cfg = get_or_create_mssql_config(app, state, connection_id).await?;
        let mut client = connect_client(&cfg).await?;

        let sql = "SELECT name FROM sys.databases WHERE state_desc = 'ONLINE' ORDER BY name";
        let stream = client.simple_query(sql).await
            .map_err(|e| VeloxError::Query(format!("MSSQL error listing databases: {}", e)))?;
        let results = stream.into_results().await
            .map_err(|e| VeloxError::Query(format!("MSSQL error reading databases: {}", e)))?;

        let mut databases = Vec::new();
        if let Some(first_set) = results.first() {
            for r in first_set {
                if let Some(name) = r.get::<&str, _>(0) {
                    databases.push(DatabaseInfo {
                        name: name.to_string(),
                    });
                }
            }
        }
        Ok(databases)
    }
}
