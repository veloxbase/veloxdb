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

fn format_timestamp(unit: duckdb::types::TimeUnit, value: i64) -> String {
    use chrono::{DateTime, Utc};
    use duckdb::types::TimeUnit;
    let millis = match unit {
        TimeUnit::Second => value.saturating_mul(1_000),
        TimeUnit::Millisecond => value,
        TimeUnit::Microsecond => value.div_euclid(1_000),
        TimeUnit::Nanosecond => value.div_euclid(1_000_000),
    };
    DateTime::<Utc>::from_timestamp_millis(millis)
        .map(|timestamp| timestamp.format("%Y-%m-%d %H:%M:%S%.3f").to_string())
        .unwrap_or_else(|| value.to_string())
}

fn format_date32(days: i32) -> String {
    use chrono::{Duration, NaiveDate};
    NaiveDate::from_ymd_opt(1970, 1, 1)
        .and_then(|epoch| epoch.checked_add_signed(Duration::days(days as i64)))
        .map(|date| date.format("%Y-%m-%d").to_string())
        .unwrap_or_else(|| days.to_string())
}

fn format_time64(unit: duckdb::types::TimeUnit, value: i64) -> String {
    use duckdb::types::TimeUnit;
    let micros = match unit {
        TimeUnit::Second => value.saturating_mul(1_000_000),
        TimeUnit::Millisecond => value.saturating_mul(1_000),
        TimeUnit::Microsecond => value,
        TimeUnit::Nanosecond => value.div_euclid(1_000),
    };
    let seconds = micros.div_euclid(1_000_000);
    let fraction = micros.rem_euclid(1_000_000);
    format!(
        "{:02}:{:02}:{:02}.{:06}",
        seconds / 3_600,
        (seconds / 60) % 60,
        seconds % 60,
        fraction
    )
}

fn duckdb_value_to_string(value: duckdb::types::Value) -> Option<String> {
    use duckdb::types::{OrderedMap, Value};
    fn list_to_string(items: Vec<Value>) -> String {
        format!(
            "[{}]",
            items
                .into_iter()
                .map(|item| duckdb_value_to_string(item).unwrap_or_else(|| "NULL".to_string()))
                .collect::<Vec<_>>()
                .join(", ")
        )
    }
    fn map_to_string(map: OrderedMap<String, Value>) -> String {
        format!(
            "{{{}}}",
            map.iter()
                .map(|(key, item)| format!(
                    "{}: {}",
                    key,
                    duckdb_value_to_string(item.clone()).unwrap_or_else(|| "NULL".to_string())
                ))
                .collect::<Vec<_>>()
                .join(", ")
        )
    }

    match value {
        Value::Null => None,
        Value::Boolean(v) => Some(v.to_string()),
        Value::TinyInt(v) => Some(v.to_string()),
        Value::SmallInt(v) => Some(v.to_string()),
        Value::Int(v) => Some(v.to_string()),
        Value::BigInt(v) => Some(v.to_string()),
        Value::HugeInt(v) => Some(v.to_string()),
        Value::UTinyInt(v) => Some(v.to_string()),
        Value::USmallInt(v) => Some(v.to_string()),
        Value::UInt(v) => Some(v.to_string()),
        Value::UBigInt(v) => Some(v.to_string()),
        Value::Float(v) => Some(v.to_string()),
        Value::Double(v) => Some(v.to_string()),
        Value::Decimal(v) => Some(v.to_string()),
        Value::Text(v) => Some(v),
        Value::Blob(bytes) => Some(format!("0x{}", hex::encode(bytes))),
        Value::Timestamp(unit, value) => Some(format_timestamp(unit, value)),
        Value::Date32(days) => Some(format_date32(days)),
        Value::Time64(unit, value) => Some(format_time64(unit, value)),
        Value::Interval { months, days, nanos } => {
            Some(format!("{} months {} days {} ns", months, days, nanos))
        }
        Value::List(items) | Value::Array(items) => Some(list_to_string(items)),
        Value::Enum(v) => Some(v),
        Value::Struct(map) => Some(map_to_string(map)),
        Value::Map(map) => Some(format!(
            "{{{}}}",
            map.iter()
                .map(|(key, item)| format!(
                    "{}: {}",
                    duckdb_value_to_string(key.clone()).unwrap_or_else(|| "NULL".to_string()),
                    duckdb_value_to_string(item.clone()).unwrap_or_else(|| "NULL".to_string())
                ))
                .collect::<Vec<_>>()
                .join(", ")
        )),
        Value::Union(inner) => duckdb_value_to_string(*inner),
        // `Value` is non-exhaustive in newer duckdb releases; show any new
        // variant rather than failing to compile.
        #[allow(unreachable_patterns)]
        other => Some(format!("{other:?}")),
    }
}


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

        let is_row_returning = crate::commands::is_row_returning_sql(sql);

        let started_at = Instant::now();

        if is_row_returning {
            let mut stmt = conn.prepare(sql)
                .map_err(|e| VeloxError::Query(e.to_string()))?;
            let col_count = stmt.column_count();
            let columns: Vec<String> = (0..col_count)
                .map(|i| stmt.column_name(i).map_or("?".to_string(), |v| v.to_string()))
                .collect();

            let mut rows = Vec::new();
            let results = stmt.query_map([], |row| {
                let vals: Vec<Option<String>> = (0..col_count)
                    .map(|i| row.get::<_, duckdb::types::Value>(i).ok().and_then(duckdb_value_to_string))
                    .collect();
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
            "SELECT table_name, table_type FROM information_schema.tables WHERE table_schema='main' ORDER BY table_name"
        ).map_err(|e| VeloxError::Query(e.to_string()))?;

        let items: Vec<(String, String)> = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|e| VeloxError::Query(e.to_string()))?
            .filter_map(|r| r.ok())
            .collect();

        Ok(items.into_iter().map(|(name, table_type)| {
            let kind = if table_type == "VIEW" { "view" } else { "table" };
            TableInfo {
                schema: "main".to_string(),
                name: name.clone(),
                preview_query: format!("SELECT * FROM \"{}\" LIMIT 100;", name),
                kind: Some(kind.to_string()),
            }
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

#[cfg(test)]
mod tests {
    use super::duckdb_value_to_string;
    use duckdb::types::Value;

    #[test]
    fn renders_null_as_none() {
        assert_eq!(duckdb_value_to_string(Value::Null), None);
    }

    #[test]
    fn renders_numeric_and_text_values() {
        assert_eq!(duckdb_value_to_string(Value::Int(42)), Some("42".to_string()));
        assert_eq!(duckdb_value_to_string(Value::UBigInt(7)), Some("7".to_string()));
        assert_eq!(
            duckdb_value_to_string(Value::Text("hello".to_string())),
            Some("hello".to_string())
        );
        assert_eq!(duckdb_value_to_string(Value::Boolean(true)), Some("true".to_string()));
    }

    #[test]
    fn renders_blobs_as_hex() {
        assert_eq!(
            duckdb_value_to_string(Value::Blob(vec![0xde, 0xad])),
            Some("0xdead".to_string())
        );
    }

    #[test]
    fn renders_lists_and_structs() {
        assert_eq!(
            duckdb_value_to_string(Value::List(vec![Value::Int(1), Value::Int(2)])),
            Some("[1, 2]".to_string())
        );
        let nested = Value::Struct(
            vec![("name".to_string(), Value::Text("bob".to_string()))].into(),
        );
        assert_eq!(duckdb_value_to_string(nested), Some("{name: bob}".to_string()));
    }
}
