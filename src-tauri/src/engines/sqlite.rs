use tauri::AppHandle;

use crate::db::{
    build_sqlite_pool, get_or_create_sqlite_pool, quote_identifier,
    require_safe_identifier, AppState,
};
use crate::error::VeloxError;
use crate::models::{ColumnInfo, ConnectionInput, DatabaseInfo, QueryResult, TableInfo};

use super::DatabaseEngineOps;

use crate::commands::{sqlite_get_idx, sqlite_get_name, run_query_mysql_or_sqlite};

pub struct SqliteEngine;

impl DatabaseEngineOps for SqliteEngine {
    async fn connect(
        &self,
        _app: &AppHandle,
        state: &AppState,
        input: &ConnectionInput,
        connection_id: &str,
    ) -> Result<(), VeloxError> {
        let pool = build_sqlite_pool(input).await?;
        sqlx::query("select 1").execute(&pool).await
            .map_err(|e| VeloxError::Connection(e.to_string()))?;
        state.sqlite_pools.write().await.insert(connection_id.to_string(), pool);
        Ok(())
    }

    async fn ping(
        &self,
        app: &AppHandle,
        state: &AppState,
        connection_id: &str,
    ) -> Result<(), VeloxError> {
        let pool = get_or_create_sqlite_pool(app, state, connection_id).await?;
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
            crate::models::DatabaseEngine::Sqlite,
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
        let pool = get_or_create_sqlite_pool(app, state, connection_id).await?;
        let rows = sqlx::query(
            "select name from sqlite_master \
             where type = 'table' and name not like 'sqlite_%' order by name",
        ).fetch_all(&pool).await
            .map_err(|e| VeloxError::Query(e.to_string()))?;
        let mut tables = Vec::new();
        for row in rows {
            let name: String = sqlite_get_idx(&row, 0, "name", "get_tables")
                .map_err(VeloxError::from)?;
            require_safe_identifier(&name, "table name")?;
            tables.push(TableInfo {
                schema: "main".to_string(),
                preview_query: format!("select * from \"{}\" limit 100;", quote_identifier(&name)),
                name,
            });
        }
        Ok(tables)
    }

    async fn get_schema(
        &self,
        app: &AppHandle,
        state: &AppState,
        connection_id: &str,
        _table_schema: &str,
        table_name: &str,
    ) -> Result<Vec<ColumnInfo>, VeloxError> {
        let pool = get_or_create_sqlite_pool(app, state, connection_id).await?;
        require_safe_identifier(table_name, "table name")?;
        let pragma_sql = format!("PRAGMA table_info(\"{}\");", quote_identifier(table_name));
        let rows = sqlx::query(&pragma_sql).fetch_all(&pool).await
            .map_err(|e| VeloxError::Query(e.to_string()))?;
        let mut columns = Vec::new();
        for row in rows {
            let col_name: String = sqlite_get_name(&row, "name", "get_schema")
                .map_err(VeloxError::from)?;
            let col_type: String = sqlite_get_name(&row, "type", "get_schema")
                .map_err(VeloxError::from)?;
            let notnull: i64 = sqlite_get_name(&row, "notnull", "get_schema")
                .map_err(VeloxError::from)?;
            columns.push(ColumnInfo {
                table_schema: "main".to_string(),
                table_name: table_name.to_string(),
                column_name: col_name,
                data_type: col_type,
                is_nullable: notnull == 0,
            });
        }
        Ok(columns)
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
