use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Instant;

use scylla::client::session::Session as ScyllaSession;
use scylla::client::session_builder::SessionBuilder;
use tauri::AppHandle;

use crate::db::{load_connection, AppState, DEFAULT_CASSANDRA_PORT};
use crate::error::VeloxError;
use crate::models::{
    ColumnInfo, ConnectionInput, DatabaseInfo, QueryResult, TableInfo,
};
use crate::ssh_tunnel::SshTunnel;

use super::DatabaseEngineOps;

pub struct CassandraEngine;

fn cql_value_to_string(val: &scylla::value::CqlValue) -> String {
    match val {
        scylla::value::CqlValue::Ascii(s) | scylla::value::CqlValue::Text(s) => s.clone(),
        scylla::value::CqlValue::Boolean(b) => b.to_string(),
        scylla::value::CqlValue::Int(i) => i.to_string(),
        scylla::value::CqlValue::BigInt(i) => i.to_string(),
        scylla::value::CqlValue::SmallInt(i) => i.to_string(),
        scylla::value::CqlValue::TinyInt(i) => i.to_string(),
        scylla::value::CqlValue::Float(f) => f.to_string(),
        scylla::value::CqlValue::Double(d) => d.to_string(),
        scylla::value::CqlValue::Uuid(u) => u.to_string(),
        scylla::value::CqlValue::Timeuuid(u) => u.to_string(),
        scylla::value::CqlValue::Timestamp(t) => format!("{:?}", t),
        scylla::value::CqlValue::Date(d) => format!("{:?}", d),
        scylla::value::CqlValue::Time(t) => format!("{:?}", t),
        scylla::value::CqlValue::Inet(ip) => ip.to_string(),
        _ => format!("{:?}", val),
    }
}

async fn get_or_create_session(
    app: &AppHandle,
    state: &AppState,
    connection_id: &str,
) -> Result<Arc<ScyllaSession>, VeloxError> {
    if let Some(s) = state.scylla_sessions.read().await.get(connection_id).cloned() {
        return Ok(s);
    }
    let stored = load_connection(app, connection_id)?
        .ok_or_else(|| VeloxError::Connection("Stored connection details were not found.".to_string()))?;
    let input = stored.to_input();

    let (host, port) = if let Some(ref ssh_config) = input.ssh_config {
        if ssh_config.is_active() {
            let tunnel = SshTunnel::connect(
                ssh_config,
                &input.host,
                if input.port == 0 { DEFAULT_CASSANDRA_PORT } else { input.port },
            )
            .await
            .map_err(|e| VeloxError::Connection(format!("SSH tunnel failed: {}", e)))?;
            let local_port = tunnel.local_port;
            state.ssh_tunnels.write().await.insert(connection_id.to_string(), tunnel);
            ("127.0.0.1".to_string(), local_port)
        } else {
            (input.host.clone(), if input.port == 0 { DEFAULT_CASSANDRA_PORT } else { input.port })
        }
    } else {
        (input.host.clone(), if input.port == 0 { DEFAULT_CASSANDRA_PORT } else { input.port })
    };

    let resolved_host = if host.is_empty() { "127.0.0.1".to_string() } else { host };
    let mut builder = SessionBuilder::new()
        .known_node(format!("{}:{}", resolved_host, port));

    if !input.user.is_empty() {
        builder = builder.user(&input.user, &input.password);
    }

    let session = builder.build().await
        .map_err(|e| VeloxError::Connection(format!("Cassandra / ScyllaDB connection failed: {}", e)))?;

    if !input.database.is_empty() {
        let _ = session.use_keyspace(&input.database, false).await;
    }

    let session_arc = Arc::new(session);
    state.scylla_sessions.write().await.insert(connection_id.to_string(), session_arc.clone());
    Ok(session_arc)
}

impl DatabaseEngineOps for CassandraEngine {
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
                    if input.port == 0 { DEFAULT_CASSANDRA_PORT } else { input.port },
                )
                .await
                .map_err(|e| VeloxError::Connection(format!("SSH tunnel failed: {}", e)))?;
                let local_port = tunnel.local_port;
                state.ssh_tunnels.write().await.insert(connection_id.to_string(), tunnel);
                ("127.0.0.1".to_string(), local_port)
            } else {
                (input.host.clone(), if input.port == 0 { DEFAULT_CASSANDRA_PORT } else { input.port })
            }
        } else {
            (input.host.clone(), if input.port == 0 { DEFAULT_CASSANDRA_PORT } else { input.port })
        };

        let resolved_host = if host.is_empty() { "127.0.0.1".to_string() } else { host };
        let mut builder = SessionBuilder::new()
            .known_node(format!("{}:{}", resolved_host, port));

        if !input.user.is_empty() {
            builder = builder.user(&input.user, &input.password);
        }

        let session = builder.build().await
            .map_err(|e| VeloxError::Connection(format!("Cassandra / ScyllaDB connection failed: {}", e)))?;

        if !input.database.is_empty() {
            let _ = session.use_keyspace(&input.database, false).await;
        }

        // Test ping
        session.query_unpaged("SELECT release_version FROM system.local", ()).await
            .map_err(|e| VeloxError::Connection(format!("Cassandra / ScyllaDB ping failed: {}", e)))?;

        state.scylla_sessions.write().await.insert(connection_id.to_string(), Arc::new(session));
        Ok(())
    }

    async fn ping(
        &self,
        app: &AppHandle,
        state: &AppState,
        connection_id: &str,
    ) -> Result<(), VeloxError> {
        let session = get_or_create_session(app, state, connection_id).await?;
        session.query_unpaged("SELECT release_version FROM system.local", ()).await
            .map_err(|e| VeloxError::Connection(format!("Cassandra / ScyllaDB ping failed: {}", e)))?;
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
        let session = get_or_create_session(app, state, connection_id).await?;
        let start = Instant::now();
        let query_res = session.query_unpaged(sql, ()).await
            .map_err(|e| VeloxError::Query(format!("Cassandra / ScyllaDB query error: {}", e)))?;
        let elapsed_ms = start.elapsed().as_millis();

        let mut columns = Vec::new();
        let mut rows = Vec::new();
        let mut row_count = 0;
        let mut truncated = false;

        if let Ok(rows_res) = query_res.into_rows_result() {
            for spec in rows_res.column_specs().iter() {
                columns.push(spec.name().to_string());
            }

            row_count = rows_res.rows_num();
            if let Ok(rows_iter) = rows_res.rows::<scylla::value::Row>() {
                for r in rows_iter.take(max_rows) {
                    if let Ok(row_val) = r {
                        let mut row_map = BTreeMap::new();
                        for (idx, col_name) in columns.iter().enumerate() {
                            let str_val = row_val.columns.get(idx).and_then(|v| v.as_ref().map(cql_value_to_string));
                            row_map.insert(col_name.clone(), str_val);
                        }
                        rows.push(row_map);
                    }
                }
            }
            if row_count > max_rows {
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
        let session = get_or_create_session(app, state, connection_id).await?;
        let query_res = session.query_unpaged(
            "SELECT keyspace_name, table_name FROM system_schema.tables",
            (),
        ).await.map_err(|e| VeloxError::Query(format!("Cassandra error getting tables: {}", e)))?;

        let mut tables = Vec::new();
        if let Ok(rows_res) = query_res.into_rows_result() {
            if let Ok(rows_iter) = rows_res.rows::<(String, String)>() {
                for r in rows_iter.flatten() {
                    let (ks, tbl) = r;
                    if !ks.starts_with("system") {
                        tables.push(TableInfo {
                            preview_query: format!("SELECT * FROM \"{}\".\"{}\" LIMIT 100;", ks, tbl),
                            schema: ks,
                            name: tbl,
                            kind: Some("table".to_string()),
                        });
                    }
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
        let session = get_or_create_session(app, state, connection_id).await?;
        let query = format!(
            "SELECT column_name, type FROM system_schema.columns WHERE keyspace_name = '{}' AND table_name = '{}'",
            table_schema.replace('\'', "''"),
            table_name.replace('\'', "''")
        );
        let query_res = session.query_unpaged(query, ()).await
            .map_err(|e| VeloxError::Query(format!("Cassandra error getting schema: {}", e)))?;

        let mut columns = Vec::new();
        if let Ok(rows_res) = query_res.into_rows_result() {
            if let Ok(rows_iter) = rows_res.rows::<(String, String)>() {
                for (col_name, col_type) in rows_iter.flatten() {
                    columns.push(ColumnInfo {
                        table_schema: table_schema.to_string(),
                        table_name: table_name.to_string(),
                        column_name: col_name,
                        data_type: col_type,
                        is_nullable: true,
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
        let session = get_or_create_session(app, state, connection_id).await?;
        let query_res = session.query_unpaged(
            "SELECT keyspace_name FROM system_schema.keyspaces",
            (),
        ).await.map_err(|e| VeloxError::Query(format!("Cassandra error listing keyspaces: {}", e)))?;

        let mut dbs = Vec::new();
        if let Ok(rows_res) = query_res.into_rows_result() {
            if let Ok(rows_iter) = rows_res.rows::<(String,)>() {
                for (name,) in rows_iter.flatten() {
                    dbs.push(DatabaseInfo { name });
                }
            }
        }
        Ok(dbs)
    }
}
