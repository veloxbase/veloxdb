use std::collections::BTreeMap;
use std::time::Instant;
use tauri::{AppHandle, State};
use crate::db::{get_or_create_redis_client, resolve_connection_engine, AppState};
use crate::models::{QueryRequest, QueryResult, TableInfo, ColumnInfo};

#[tauri::command]
pub async fn redis_run_query(
    app: AppHandle,
    state: State<'_, AppState>,
    input: QueryRequest,
) -> Result<QueryResult, String> {
    let (connection_id, _) = resolve_connection_engine(&app, &state, input.connection_id.clone()).await?;
    let mut client = get_or_create_redis_client(&app, &state, &connection_id).await?;
    let raw = input.sql.trim().to_string();
    if raw.is_empty() { return Err("Enter a Redis command.".to_string()); }
    let started_at = Instant::now();
    let parts: Vec<&str> = raw.split_whitespace().collect();
    let cmd = parts.first().map(|s| s.to_uppercase()).unwrap_or_default();

    match cmd.as_str() {
        "PING" => {
            let result: String = redis::cmd("PING").query_async(&mut client).await.map_err(|e| e.to_string())?;
            Ok(QueryResult { columns: vec!["result".to_string()], rows: vec![BTreeMap::from([("result".to_string(), Some(result))])], row_count: 1, execution_ms: started_at.elapsed().as_millis(), truncated: false, command_tag: None })
        }
        "GET" => {
            let key = parts.get(1).unwrap_or(&"");
            let result: Option<String> = redis::cmd("GET").arg(key).query_async(&mut client).await.map_err(|e| e.to_string())?;
            Ok(QueryResult { columns: vec!["value".to_string()], rows: vec![BTreeMap::from([("value".to_string(), result)])], row_count: 1, execution_ms: started_at.elapsed().as_millis(), truncated: false, command_tag: None })
        }
        "SET" => {
            let key = parts.get(1).unwrap_or(&"");
            let value = parts.get(2).unwrap_or(&"");
            redis::cmd("SET").arg(key).arg(value).query_async::<_, ()>(&mut client).await.map_err(|e| e.to_string())?;
            Ok(QueryResult { columns: vec![], rows: vec![], row_count: 0, execution_ms: started_at.elapsed().as_millis(), truncated: false, command_tag: Some(0) })
        }
        "KEYS" | "SCAN" => {
            let pattern = parts.get(1).unwrap_or(&"*");
            let keys: Vec<String> = redis::cmd("KEYS").arg(pattern).query_async(&mut client).await.map_err(|e| e.to_string())?;
            let rows: Vec<BTreeMap<String, Option<String>>> = keys.into_iter().map(|k| BTreeMap::from([("key".to_string(), Some(k))])).collect();
            Ok(QueryResult { columns: vec!["key".to_string()], rows: rows.clone(), row_count: rows.len(), execution_ms: started_at.elapsed().as_millis(), truncated: false, command_tag: None })
        }
        "HGETALL" => {
            let key = parts.get(1).unwrap_or(&"");
            let hash: Vec<String> = redis::cmd("HGETALL").arg(key).query_async(&mut client).await.map_err(|e| e.to_string())?;
            let mut row = BTreeMap::new();
            let mut cols = Vec::new();
            for chunk in hash.chunks(2) {
                if chunk.len() == 2 {
                    cols.push(chunk[0].clone());
                    row.insert(chunk[0].clone(), Some(chunk[1].clone()));
                }
            }
            Ok(QueryResult { columns: cols, rows: vec![row], row_count: 1, execution_ms: started_at.elapsed().as_millis(), truncated: false, command_tag: None })
        }
        "LRANGE" => {
            let key = parts.get(1).unwrap_or(&"");
            let start: isize = parts.get(2).and_then(|s| s.parse().ok()).unwrap_or(0);
            let stop: isize = parts.get(3).and_then(|s| s.parse().ok()).unwrap_or(-1);
            let list: Vec<String> = redis::cmd("LRANGE").arg(key).arg(start).arg(stop).query_async(&mut client).await.map_err(|e| e.to_string())?;
            let rows: Vec<BTreeMap<String, Option<String>>> = list.into_iter().enumerate().map(|(i, v)| {
                let mut map = BTreeMap::new();
                map.insert("index".to_string(), Some(i.to_string()));
                map.insert("value".to_string(), Some(v));
                map
            }).collect();
            Ok(QueryResult { columns: vec!["index".to_string(), "value".to_string()], rows: rows.clone(), row_count: rows.len(), execution_ms: started_at.elapsed().as_millis(), truncated: false, command_tag: None })
        }
        "SMEMBERS" => {
            let key = parts.get(1).unwrap_or(&"");
            let members: Vec<String> = redis::cmd("SMEMBERS").arg(key).query_async(&mut client).await.map_err(|e| e.to_string())?;
            let rows: Vec<BTreeMap<String, Option<String>>> = members.into_iter().map(|v| BTreeMap::from([("member".to_string(), Some(v))])).collect();
            Ok(QueryResult { columns: vec!["member".to_string()], rows: rows.clone(), row_count: rows.len(), execution_ms: started_at.elapsed().as_millis(), truncated: false, command_tag: None })
        }
        _ => Err(format!("Unsupported Redis command: {}. Try GET, SET, KEYS, HGETALL, LRANGE, SMEMBERS, PING.", cmd))
    }
}

#[tauri::command]
pub async fn redis_get_keys(
    app: AppHandle,
    state: State<'_, AppState>,
    connection_id: Option<String>,
) -> Result<Vec<TableInfo>, String> {
    let (connection_id, _) = resolve_connection_engine(&app, &state, connection_id).await?;
    let mut client = get_or_create_redis_client(&app, &state, &connection_id).await?;
    let keys: Vec<String> = redis::cmd("KEYS").arg("*").query_async(&mut client).await.map_err(|e| e.to_string())?;
    Ok(keys.into_iter().map(|k| TableInfo { schema: "0".to_string(), name: k.clone(), preview_query: format!("GET {}", k) }).collect())
}

/// Infer schema for a Redis key by checking its type and sampling data.
#[tauri::command]
pub async fn redis_get_schema(
    app: AppHandle,
    state: State<'_, AppState>,
    connection_id: Option<String>,
    _table_schema: String,
    table_name: String,
) -> Result<Vec<ColumnInfo>, String> {
    let (connection_id, _) = resolve_connection_engine(&app, &state, connection_id).await?;
    let mut client = get_or_create_redis_client(&app, &state, &connection_id).await?;

    let key_type: String = redis::cmd("TYPE").arg(&table_name).query_async(&mut client)
        .await.map_err(|e| format!("Redis TYPE failed: {}", e))?;

    match key_type.as_str() {
        "string" => Ok(vec![ColumnInfo {
            table_schema: "0".to_string(), table_name: table_name.clone(),
            column_name: "value".to_string(), data_type: "string".to_string(), is_nullable: true,
        }]),
        "hash" => {
            let fields: Vec<String> = redis::cmd("HKEYS").arg(&table_name).query_async(&mut client)
                .await.map_err(|e| format!("Redis HKEYS failed: {}", e))?;
            Ok(fields.into_iter().map(|f| ColumnInfo {
                table_schema: "0".to_string(), table_name: table_name.clone(),
                column_name: f, data_type: "string".to_string(), is_nullable: true,
            }).collect())
        }
        "list" => Ok(vec![
            ColumnInfo { table_schema: "0".to_string(), table_name: table_name.clone(), column_name: "index".to_string(), data_type: "integer".to_string(), is_nullable: false },
            ColumnInfo { table_schema: "0".to_string(), table_name: table_name.clone(), column_name: "value".to_string(), data_type: "string".to_string(), is_nullable: true },
        ]),
        "set" => Ok(vec![ColumnInfo {
            table_schema: "0".to_string(), table_name: table_name.clone(),
            column_name: "member".to_string(), data_type: "string".to_string(), is_nullable: false,
        }]),
        _ => Ok(vec![ColumnInfo {
            table_schema: "0".to_string(), table_name: table_name.clone(),
            column_name: "value".to_string(), data_type: key_type, is_nullable: true,
        }]),
    }
}
