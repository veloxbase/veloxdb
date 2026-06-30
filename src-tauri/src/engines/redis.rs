use tauri::AppHandle;

use crate::db::{build_redis_url, get_or_create_redis_client, AppState};
use crate::error::VeloxError;
use crate::models::{ColumnInfo, ConnectionInput, DatabaseInfo, QueryResult, TableInfo};

use super::DatabaseEngineOps;

pub struct RedisEngine;

impl DatabaseEngineOps for RedisEngine {
    async fn connect(
        &self,
        _app: &AppHandle,
        state: &AppState,
        input: &ConnectionInput,
        connection_id: &str,
    ) -> Result<(), VeloxError> {
        let url = build_redis_url(input);
        let client = redis::Client::open(url)
            .map_err(|e| VeloxError::Connection(format!("Redis connection failed: {}", e)))?;
        let mut conn = redis::aio::ConnectionManager::new(client).await
            .map_err(|e| VeloxError::Connection(format!("Redis connection failed: {}", e)))?;
        redis::cmd("PING").query_async::<_, String>(&mut conn).await
            .map_err(|e| VeloxError::Connection(format!("Redis ping failed: {}", e)))?;
        state.redis_clients.write().await.insert(connection_id.to_string(), conn);
        Ok(())
    }

    async fn ping(
        &self,
        app: &AppHandle,
        state: &AppState,
        connection_id: &str,
    ) -> Result<(), VeloxError> {
        let mut client = get_or_create_redis_client(app, state, connection_id).await?;
        redis::cmd("PING").query_async::<_, String>(&mut client).await
            .map_err(|e| VeloxError::Connection(format!("Redis ping failed: {}", e)))?;
        Ok(())
    }

    async fn run_query(
        &self,
        _app: &AppHandle,
        _state: &AppState,
        _connection_id: &str,
        _sql: &str,
        _max_rows: usize,
    ) -> Result<QueryResult, VeloxError> {
        Err(VeloxError::Validation(
            "Redis uses its own command path. Use the Redis-specific UI.".to_string(),
        ))
    }

    async fn get_tables(
        &self,
        app: &AppHandle,
        state: &AppState,
        connection_id: &str,
    ) -> Result<Vec<TableInfo>, VeloxError> {
        let mut client = get_or_create_redis_client(app, state, connection_id).await?;
        let keys: Vec<String> = redis::cmd("KEYS").arg("*").query_async(&mut client).await
            .map_err(|e| VeloxError::Query(format!("Redis KEYS failed: {}", e)))?;
        Ok(keys.into_iter().map(|k| TableInfo {
            schema: "0".to_string(),
            name: k.clone(),
            preview_query: format!("GET {}", k),
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
        let mut client = get_or_create_redis_client(app, state, connection_id).await?;

        let key_type: String = redis::cmd("TYPE").arg(table_name).query_async(&mut client)
            .await.map_err(|e| VeloxError::Query(format!("Redis TYPE failed: {}", e)))?;

        match key_type.as_str() {
            "string" => Ok(vec![ColumnInfo {
                table_schema: "0".to_string(), table_name: table_name.to_string(),
                column_name: "value".to_string(), data_type: "string".to_string(), is_nullable: true,
            }]),
            "hash" => {
                let fields: Vec<String> = redis::cmd("HKEYS").arg(table_name).query_async(&mut client)
                    .await.map_err(|e| VeloxError::Query(format!("Redis HKEYS failed: {}", e)))?;
                Ok(fields.into_iter().map(|f| ColumnInfo {
                    table_schema: "0".to_string(), table_name: table_name.to_string(),
                    column_name: f, data_type: "string".to_string(), is_nullable: true,
                }).collect())
            }
            "list" => Ok(vec![
                ColumnInfo { table_schema: "0".to_string(), table_name: table_name.to_string(), column_name: "index".to_string(), data_type: "integer".to_string(), is_nullable: false },
                ColumnInfo { table_schema: "0".to_string(), table_name: table_name.to_string(), column_name: "value".to_string(), data_type: "string".to_string(), is_nullable: true },
            ]),
            "set" => Ok(vec![ColumnInfo {
                table_schema: "0".to_string(), table_name: table_name.to_string(),
                column_name: "member".to_string(), data_type: "string".to_string(), is_nullable: false,
            }]),
            _ => Ok(vec![ColumnInfo {
                table_schema: "0".to_string(), table_name: table_name.to_string(),
                column_name: "value".to_string(), data_type: key_type, is_nullable: true,
            }]),
        }
    }

    async fn list_databases(
        &self,
        _app: &AppHandle,
        _state: &AppState,
        _connection_id: &str,
    ) -> Result<Vec<DatabaseInfo>, VeloxError> {
        Ok(vec![DatabaseInfo { name: "0".to_string() }])
    }
}
