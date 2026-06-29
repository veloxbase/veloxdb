use std::collections::BTreeMap;
use std::time::Instant;

use mongodb::bson::{self, doc, Document};
use tauri::AppHandle;

use crate::db::{
    build_mongo_connection_string, get_or_create_mongo_client, load_connection, AppState,
};
use crate::error::VeloxError;
use crate::models::{ColumnInfo, ConnectionInput, DatabaseInfo, QueryResult, TableInfo};

use super::DatabaseEngineOps;

pub struct MongoEngine;

impl DatabaseEngineOps for MongoEngine {
    async fn connect(
        &self,
        _app: &AppHandle,
        state: &AppState,
        input: &ConnectionInput,
        connection_id: &str,
    ) -> Result<(), VeloxError> {
        let uri = build_mongo_connection_string(input);
        let client = mongodb::Client::with_uri_str(&uri)
            .await
            .map_err(|e| VeloxError::Connection(format!("MongoDB connection failed: {}", e)))?;
        client
            .database("admin")
            .run_command(doc! { "ping": 1 })
            .await
            .map_err(|e| VeloxError::Connection(format!("MongoDB ping failed: {}", e)))?;
        state.mongo_clients.write().await.insert(connection_id.to_string(), client);
        Ok(())
    }

    async fn ping(
        &self,
        app: &AppHandle,
        state: &AppState,
        connection_id: &str,
    ) -> Result<(), VeloxError> {
        let client = get_or_create_mongo_client(app, state, connection_id).await?;
        client.database("admin").run_command(doc! { "ping": 1 }).await
            .map_err(|e| VeloxError::Connection(format!("MongoDB ping failed: {}", e)))?;
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
        let client = get_or_create_mongo_client(app, state, connection_id).await?;
        let stored = load_connection(app, connection_id)?
            .ok_or_else(|| VeloxError::Connection("Stored connection details were not found.".to_string()))?;
        let db = client.default_database().ok_or_else(|| {
            VeloxError::Connection("No default database for MongoDB connection.".to_string())
        })?;

        // Parse: "db.collection.find({...})" or just collection name
        let trimmed = sql.trim();
        let (db_name, coll_name, filter) = parse_mongo_query(trimmed, &stored.database);

        let db = if db_name == stored.database { db } else { client.database(&db_name) };
        let collection = db.collection::<Document>(&coll_name);

        let started_at = Instant::now();
        let mut cursor = collection
            .find(filter)
            .limit(max_rows as i64)
            .await
            .map_err(|e| VeloxError::Query(format!("MongoDB find failed: {}", e)))?;

        let mut rows: Vec<BTreeMap<String, Option<String>>> = Vec::new();
        let mut columns_set = std::collections::HashSet::new();
        let mut columns = Vec::new();

        while let Ok(true) = cursor.advance().await {
            let doc = cursor.deserialize_current()
                .map_err(|e| VeloxError::Query(format!("MongoDB cursor error: {}", e)))?;
            let mut row = BTreeMap::new();
            for (key, value) in &doc {
                if !columns_set.contains(key) {
                    columns.push(key.clone());
                    columns_set.insert(key.clone());
                }
                row.insert(key.clone(), bson_to_display(value));
            }
            for col in &columns {
                row.entry(col.clone()).or_insert(None);
            }
            rows.push(row);
        }

        Ok(QueryResult {
            row_count: rows.len(),
            rows,
            columns,
            execution_ms: started_at.elapsed().as_millis(),
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
        let client = get_or_create_mongo_client(app, state, connection_id).await?;
        let db = client.default_database().ok_or_else(|| {
            VeloxError::Connection("No default database for MongoDB connection.".to_string())
        })?;
        let db_name = db.name().to_string();
        let names = db.list_collection_names().await
            .map_err(|e| VeloxError::Query(format!("Failed to list MongoDB collections: {}", e)))?;
        Ok(names.into_iter().map(|name| TableInfo {
            schema: db_name.clone(),
            name: name.clone(),
            preview_query: format!("{}.find({{}}).limit(100)", name),
        }).collect())
    }

    async fn get_schema(
        &self,
        app: &AppHandle,
        state: &AppState,
        connection_id: &str,
        database: &str,
        collection: &str,
    ) -> Result<Vec<ColumnInfo>, VeloxError> {
        let client = get_or_create_mongo_client(app, state, connection_id).await?;
        let db = client.database(database);
        let coll = db.collection::<Document>(collection);
        let mut cursor = coll.find(doc! {}).limit(200).await
            .map_err(|e| VeloxError::Query(format!("MongoDB cursor error: {}", e)))?;

        let mut field_counts: BTreeMap<String, usize> = BTreeMap::new();
        let mut field_types: BTreeMap<String, &'static str> = BTreeMap::new();
        while let Ok(true) = cursor.advance().await {
            let doc = cursor.deserialize_current()
                .map_err(|e| VeloxError::Query(format!("MongoDB cursor error: {}", e)))?;
            for (key, value) in &doc {
                let entry = field_counts.entry(key.clone()).or_default();
                *entry += 1;
                // Track the first non-null BSON type seen for each field
                let btype = infer_bson_type(value);
                if btype != "null" {
                    field_types.entry(key.clone()).or_insert(btype);
                }
            }
        }

        let total = field_counts.values().max().copied().unwrap_or(1).max(1);
        Ok(field_counts.into_iter().map(|(name, count)| {
            let btype = field_types.get(&name).copied().unwrap_or("unknown");
            ColumnInfo {
                table_schema: database.to_string(),
                table_name: collection.to_string(),
                column_name: name,
                data_type: format!("{} ({}% present)", btype, count * 100 / total),
                is_nullable: count < total,
            }
        }).collect())
    }

    async fn list_databases(
        &self,
        app: &AppHandle,
        state: &AppState,
        connection_id: &str,
    ) -> Result<Vec<DatabaseInfo>, VeloxError> {
        let client = get_or_create_mongo_client(app, state, connection_id).await?;
        let db_names = client.list_database_names().await
            .map_err(|e| VeloxError::Query(format!("Failed to list MongoDB databases: {}", e)))?;
        Ok(db_names.into_iter().map(|name| DatabaseInfo { name }).collect())
    }
}

fn infer_bson_type(value: &mongodb::bson::Bson) -> &'static str {
    use mongodb::bson::Bson;
    match value {
        Bson::String(_) => "string",
        Bson::Int32(_) | Bson::Int64(_) => "integer",
        Bson::Double(_) => "double",
        Bson::Boolean(_) => "boolean",
        Bson::ObjectId(_) => "objectId",
        Bson::DateTime(_) => "date",
        Bson::Array(_) => "array",
        Bson::Document(_) => "object",
        Bson::Null => "null",
        Bson::Binary(_) => "binary",
        Bson::RegularExpression(_) => "regex",
        Bson::Decimal128(_) => "decimal",
        _ => "unknown",
    }
}

fn parse_mongo_query(sql: &str, default_db: &str) -> (String, String, Document) {
    let trimmed = sql.trim();
    // "db.collection.find({...})" format
    if let Some(rest) = trimmed.strip_prefix("db.") {
        if let Some(dot) = rest.find('.') {
            let collection = &rest[..dot];
            let after = &rest[dot + 1..];
            if let Some(filter_part) = after.strip_prefix("find(") {
                let filter_str = filter_part.trim_end_matches(')').trim();
                let filter = parse_filter(filter_str);
                return (default_db.to_string(), collection.to_string(), filter);
            }
        }
    }
    // "database.collection" format
    if let Some(dot) = trimmed.find('.') {
        let db = &trimmed[..dot];
        let coll = &trimmed[dot + 1..];
        return (db.to_string(), coll.to_string(), doc! {});
    }
    // Just collection name
    (default_db.to_string(), trimmed.to_string(), doc! {})
}

fn parse_filter(input: &str) -> Document {
    let trimmed = input.trim();
    if trimmed.is_empty() || trimmed == "{}" {
        return doc! {};
    }
    // Try JSON
    if let Ok(doc) = bson::from_slice(trimmed.as_bytes()) {
        return doc;
    }
    // Try as relaxed JSON (single quotes)
    let json_like = trimmed.replace('\'', "\"");
    if let Ok(doc) = bson::from_slice(json_like.as_bytes()) {
        return doc;
    }
    // Key-value pairs: "key: value, key2: value2"
    let mut doc = Document::new();
    for part in trimmed.split(',') {
        let part = part.trim();
        if let Some(colon) = part.find(':') {
            let key = part[..colon].trim().trim_matches('"').trim_matches('\'');
            let val = part[colon + 1..].trim().trim_matches('"').trim_matches('\'');
            if let Ok(n) = val.parse::<i32>() {
                doc.insert(key, n);
            } else if val == "true" {
                doc.insert(key, true);
            } else if val == "false" {
                doc.insert(key, false);
            } else {
                doc.insert(key, val);
            }
        }
    }
    doc
}

fn bson_to_display(value: &bson::Bson) -> Option<String> {
    match value {
        bson::Bson::Double(v) => Some(v.to_string()),
        bson::Bson::String(v) => Some(v.clone()),
        bson::Bson::Boolean(v) => Some(v.to_string()),
        bson::Bson::Null => None,
        bson::Bson::Int32(v) => Some(v.to_string()),
        bson::Bson::Int64(v) => Some(v.to_string()),
        bson::Bson::ObjectId(v) => Some(v.to_hex()),
        bson::Bson::DateTime(v) => Some(v.to_string()),
        bson::Bson::Binary(v) => Some(hex::encode(&v.bytes)),
        bson::Bson::Array(arr) => {
            let items: Vec<String> = arr.iter().filter_map(bson_to_display).collect();
            Some(format!("[{}]", items.join(", ")))
        }
        bson::Bson::Document(doc) => {
            let items: Vec<String> = doc.iter()
                .map(|(k, v)| format!("{}: {}", k, bson_to_display(v).unwrap_or_else(|| "null".to_string())))
                .collect();
            Some(format!("{{{}}}", items.join(", ")))
        }
        _ => Some(format!("{:?}", value)),
    }
}
