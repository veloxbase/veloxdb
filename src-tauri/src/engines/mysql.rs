use tauri::AppHandle;

use crate::db::{
    build_mysql_pool, build_mysql_pool_custom, get_or_create_mysql_pool, load_connection,
    AppState, DEFAULT_MYSQL_PORT,
};
use crate::error::VeloxError;
use crate::models::{ColumnInfo, ConnectionInput, DatabaseInfo, QueryResult, TableInfo};
use crate::ssh_tunnel::SshTunnel;

use super::DatabaseEngineOps;

use crate::commands::{
    mysql_get_string, mysql_database_name_from_row, run_query_mysql_or_sqlite,
};

pub struct MySqlEngine;

impl DatabaseEngineOps for MySqlEngine {
    async fn connect(
        &self,
        _app: &AppHandle,
        state: &AppState,
        input: &ConnectionInput,
        connection_id: &str,
    ) -> Result<(), VeloxError> {
        let pool = if let Some(ref ssh_config) = input.ssh_config {
            if ssh_config.is_active() {
                let remote_port = if input.port == 0 { DEFAULT_MYSQL_PORT } else { input.port };
                let tunnel = SshTunnel::connect(ssh_config, &input.host, remote_port)
                    .await
                    .map_err(|e| VeloxError::Connection(format!("SSH tunnel failed: {}", e)))?;
                let local_port = tunnel.local_port;
                state.ssh_tunnels.write().await.insert(connection_id.to_string(), tunnel);
                build_mysql_pool_custom("127.0.0.1", local_port, input).await?
            } else {
                build_mysql_pool(input).await?
            }
        } else {
            build_mysql_pool(input).await?
        };

        sqlx::query("select 1").execute(&pool).await
            .map_err(|e| VeloxError::Connection(e.to_string()))?;
        state.mysql_pools.write().await.insert(connection_id.to_string(), pool);
        Ok(())
    }

    async fn ping(
        &self,
        app: &AppHandle,
        state: &AppState,
        connection_id: &str,
    ) -> Result<(), VeloxError> {
        let pool = get_or_create_mysql_pool(app, state, connection_id).await?;
        sqlx::query("select 1").execute(&pool).await
            .map_err(|e| VeloxError::Connection(e.to_string()))?;
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
        run_query_mysql_or_sqlite(
            app,
            state,
            connection_id,
            sql,
            max_rows,
            crate::models::DatabaseEngine::Mysql,
        )
        .await
        .map_err(VeloxError::from)
    }

    async fn get_tables(
        &self,
        app: &AppHandle,
        state: &AppState,
        connection_id: &str,
    ) -> Result<Vec<TableInfo>, VeloxError> {
        let pool = get_or_create_mysql_pool(app, state, connection_id).await?;
        let database = load_connection(app, connection_id)?
            .map(|connection| connection.database).unwrap_or_default();
        let rows = sqlx::query(
            "select table_schema, table_name \
             from information_schema.tables \
             where table_type = 'BASE TABLE' \
               and table_schema = ? \
               and table_schema not in ('information_schema', 'mysql', 'performance_schema', 'sys') \
             order by table_schema, table_name",
        ).bind(&database).fetch_all(&pool).await
            .map_err(|e| VeloxError::Query(e.to_string()))?;
        let mut tables = Vec::new();
        for row in rows {
            let schema: String = mysql_get_string(&row, 0, "table_schema", "get_tables")
                .map_err(VeloxError::from)?;
            let name: String = mysql_get_string(&row, 1, "table_name", "get_tables")
                .map_err(VeloxError::from)?;
            tables.push(TableInfo {
                preview_query: format!("select * from `{}`.`{}` limit 100;", schema, name),
                schema, name,
            });
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
        let pool = get_or_create_mysql_pool(app, state, connection_id).await?;
        let rows = sqlx::query(
            "select table_schema, table_name, column_name, data_type, is_nullable \
             from information_schema.columns \
             where table_schema = ? and table_name = ? \
             order by ordinal_position",
        ).bind(table_schema).bind(table_name)
        .fetch_all(&pool).await
            .map_err(|e| VeloxError::Query(e.to_string()))?;
        let mut columns = Vec::new();
        for row in rows {
            columns.push(ColumnInfo {
                table_schema: mysql_get_string(&row, 0, "table_schema", "get_schema")
                    .map_err(VeloxError::from)?,
                table_name: mysql_get_string(&row, 1, "table_name", "get_schema")
                    .map_err(VeloxError::from)?,
                column_name: mysql_get_string(&row, 2, "column_name", "get_schema")
                    .map_err(VeloxError::from)?,
                data_type: mysql_get_string(&row, 3, "data_type", "get_schema")
                    .map_err(VeloxError::from)?,
                is_nullable: mysql_get_string(&row, 4, "is_nullable", "get_schema")
                    .map_err(VeloxError::from)? == "YES",
            });
        }
        Ok(columns)
    }

    async fn list_databases(
        &self,
        app: &AppHandle,
        state: &AppState,
        connection_id: &str,
    ) -> Result<Vec<DatabaseInfo>, VeloxError> {
        let pool = get_or_create_mysql_pool(app, state, connection_id).await?;
        let rows = sqlx::query("show databases")
            .fetch_all(&pool).await
            .map_err(|e| VeloxError::Query(e.to_string()))?;
        let mut databases = Vec::with_capacity(rows.len());
        for row in rows {
            let name = mysql_database_name_from_row(&row, "list_databases")
                .map_err(VeloxError::from)?;
            databases.push(DatabaseInfo { name });
        }
        Ok(databases)
    }
}
