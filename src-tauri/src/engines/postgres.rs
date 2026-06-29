use std::time::Instant;

use tauri::AppHandle;
use tokio_postgres::SimpleQueryMessage;

use crate::db::{
    build_pool, build_pool_custom, drop_pool, quote_identifier,
    with_pool_client_retry, AppState,
};
use crate::error::VeloxError;
use crate::models::{ColumnInfo, ConnectionInput, DatabaseInfo, QueryResult, TableInfo};
use crate::pg_error::map_pg_err;
use crate::ssh_tunnel::SshTunnel;

use super::DatabaseEngineOps;

pub struct PostgresEngine;

impl DatabaseEngineOps for PostgresEngine {
    async fn connect(
        &self,
        _app: &AppHandle,
        state: &AppState,
        input: &ConnectionInput,
        connection_id: &str,
    ) -> Result<(), VeloxError> {
        let pool = if let Some(ref ssh_config) = input.ssh_config {
            if ssh_config.is_active() {
                let tunnel = SshTunnel::connect(ssh_config, &input.host, input.port)
                    .await
                    .map_err(|e| VeloxError::Connection(format!("SSH tunnel failed: {}", e)))?;
                let local_port = tunnel.local_port;
                state.ssh_tunnels.write().await.insert(connection_id.to_string(), tunnel);
                build_pool_custom("127.0.0.1", local_port, input)?
            } else {
                build_pool(input)?
            }
        } else {
            build_pool(input)?
        };

        let client = pool.get().await.map_err(|e| {
            VeloxError::Connection(e.to_string())
        })?;

        if let Err(e) = client.simple_query("select 1").await {
            drop_pool(state, connection_id).await;
            return Err(VeloxError::Postgres(crate::error::PgError::from_error(e, None)));
        }

        state.pools.write().await.insert(connection_id.to_string(), pool);
        Ok(())
    }

    async fn ping(
        &self,
        app: &AppHandle,
        state: &AppState,
        connection_id: &str,
    ) -> Result<(), VeloxError> {
        with_pool_client_retry(app, state, connection_id, (), |client, ()| async move {
            client.simple_query("select 1").await.map_err(|error| error.to_string())?;
            Ok(())
        })
        .await
    }

    async fn run_query(
        &self,
        app: &AppHandle,
        state: &AppState,
        connection_id: &str,
        sql: &str,
        max_rows: usize,
    ) -> Result<QueryResult, VeloxError> {
        with_pool_client_retry(app, state, connection_id, sql.to_string(), |client, sql| async move {
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
                        if rows.len() >= max_rows { continue; }
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
                truncated: total_rows > max_rows,
                command_tag,
            })
        }).await
    }

    async fn get_tables(
        &self,
        app: &AppHandle,
        state: &AppState,
        connection_id: &str,
    ) -> Result<Vec<TableInfo>, VeloxError> {
        with_pool_client_retry(app, state, connection_id, (), |client, ()| async move {
            let rows = client.query(
                "select t.table_schema, t.table_name \
                 from information_schema.tables t \
                 join pg_catalog.pg_class c on c.oid = (quote_ident(t.table_schema) || '.' || quote_ident(t.table_name))::regclass \
                 where t.table_type = 'BASE TABLE' \
                   and t.table_schema not in ('pg_catalog', 'information_schema') \
                   and c.relispartition = false \
                 order by t.table_schema, t.table_name",
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

    async fn get_schema(
        &self,
        app: &AppHandle,
        state: &AppState,
        connection_id: &str,
        table_schema: &str,
        table_name: &str,
    ) -> Result<Vec<ColumnInfo>, VeloxError> {
        let ts = table_schema.to_string();
        let tn = table_name.to_string();
        with_pool_client_retry(app, state, connection_id, (ts, tn), |client, (schema, name)| async move {
            let rows = client.query(
                "select table_schema, table_name, column_name, data_type, is_nullable \
                 from information_schema.columns \
                 where table_schema = $1 and table_name = $2 \
                 order by ordinal_position",
                &[&schema, &name],
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

    async fn list_databases(
        &self,
        app: &AppHandle,
        state: &AppState,
        connection_id: &str,
    ) -> Result<Vec<DatabaseInfo>, VeloxError> {
        with_pool_client_retry(app, state, connection_id, (), |client, ()| async move {
            let rows = client.query(
                "select datname from pg_database \
                 where datistemplate = false and has_database_privilege(datname, 'CONNECT') \
                 order by datname",
                &[],
            ).await.map_err(|error| map_pg_err(error, None))?;
            Ok(rows.into_iter().map(|row| {
                let name: String = row.get(0);
                DatabaseInfo { name }
            }).collect())
        }).await
    }
}
