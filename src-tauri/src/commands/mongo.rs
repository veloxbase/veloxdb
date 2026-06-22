use std::collections::{BTreeMap, HashMap, HashSet};
use std::time::Instant;

use futures_util::StreamExt;
use mongodb::bson::{doc, Document};
use tauri::{AppHandle, State};

use crate::db::{get_or_create_mongo_client, resolve_connection_engine, AppState, MAX_QUERY_ROWS};
use crate::models::{ColumnInfo, QueryRequest, QueryResult, TableInfo};

/// Parse a user-supplied MongoDB query string into a filter Document.
///
/// Supports these input forms:
///   `{"status": "active"}`            — raw JSON filter
///   `db.collection.find({...})`        — full shell syntax (ignores collection prefix)
///   `{ status: "active" }`             — relaxed JSON (unquoted keys, single quotes)
fn parse_mongo_filter(raw: &str) -> Result<Document, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(doc! {});
    }

    // Try strict JSON first
    if let Ok(doc) = serde_json::from_str::<Document>(trimmed) {
        if !doc.is_empty() {
            return Ok(doc);
        }
    }

    // Try shell syntax: db.collection.find({...})
    if let Some(start) = trimmed.find(".find(") {
        let after_find = &trimmed[start + 6..]; // skip ".find("
        let inner = extract_braced_json(after_find)
            .ok_or_else(|| "Could not parse .find() arguments.".to_string())?;
        return normalize_to_document(&inner);
    }

    // Try relaxed JSON (single quotes, unquoted keys)
    let relaxed = trimmed
        .replace('\'', "\"")
        .replace("ObjectId(", "\"ObjectId(")
        .replace("ISODate(", "\"ISODate(");
    if let Ok(doc) = serde_json::from_str::<Document>(&relaxed) {
        return Ok(doc);
    }

    // Last attempt: treat as a raw key-value search
    normalize_to_document(trimmed)
}

fn extract_braced_json(input: &str) -> Option<String> {
    let trimmed = input.trim();
    if !trimmed.starts_with('{') {
        return None;
    }
    let mut depth = 0i32;
    let mut end = 0usize;
    for (i, ch) in trimmed.char_indices() {
        match ch {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    end = i + 1;
                    break;
                }
            }
            _ => {}
        }
    }
    if end > 0 {
        Some(trimmed[..end].to_string())
    } else {
        None
    }
}

fn normalize_to_document(raw: &str) -> Result<Document, String> {
    // Try parsing as BSON
    if let Ok(doc) = serde_json::from_str::<Document>(raw) {
        return Ok(doc);
    }
    // Return empty filter — matches all documents
    Ok(doc! {})
}

fn bson_to_display_string(value: &mongodb::bson::Bson) -> Option<String> {
    use mongodb::bson::Bson;
    match value {
        Bson::String(s) => Some(s.clone()),
        Bson::Int32(n) => Some(n.to_string()),
        Bson::Int64(n) => Some(n.to_string()),
        Bson::Double(f) => Some(f.to_string()),
        Bson::Boolean(b) => Some(b.to_string()),
        Bson::ObjectId(oid) => Some(oid.to_hex()),
        Bson::DateTime(dt) => Some(
            chrono::DateTime::from_timestamp_millis(dt.timestamp_millis())
                .map(|d| d.format("%Y-%m-%d %H:%M:%S").to_string())
                .unwrap_or_else(|| dt.to_string()),
        ),
        Bson::Null => None,
        Bson::Array(arr) => Some(format!("[{} items]", arr.len())),
        Bson::Document(_) => Some("{...}".to_string()),
        Bson::Binary(_) => Some("<binary>".to_string()),
        Bson::RegularExpression(re) => Some(format!("/{}/", re.pattern)),
        Bson::Decimal128(d) => Some(d.to_string()),
        _ => Some(format!("{:?}", value)),
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

/// Execute a MongoDB find/aggregate query and return tabular results.
#[tauri::command]
pub async fn mongo_run_query(
    app: AppHandle,
    state: State<'_, AppState>,
    input: QueryRequest,
) -> Result<QueryResult, String> {
    let (connection_id, _engine) =
        resolve_connection_engine(&app, &state, input.connection_id.clone()).await?;
    let client = get_or_create_mongo_client(&app, &state, &connection_id).await?;

    let started_at = Instant::now();
    let raw = input.sql.trim().to_string();
    if raw.is_empty() {
        return Err("Enter a MongoDB query or filter.".to_string());
    }

    // Determine the collection name — try extracting from shell syntax
    let (collection_name, filter) = if let Some(dot_find) = raw.find(".find(") {
        let collection = raw[..dot_find].trim().to_string();
        let filter = parse_mongo_filter(&raw)?;
        (collection, filter)
    } else if raw.starts_with('{') {
        // No collection specified — use the stored database's first collection as context,
        // or just return all databases if none specified.
        let db = client.default_database().ok_or_else(|| {
            "No default database. Specify a database or use db.collection.find({...}) syntax."
                .to_string()
        })?;
        let names = db
            .list_collection_names()
            .await
            .map_err(|e| format!("Failed to list collections: {}", e))?;
        if names.is_empty() {
            return Err("No collections found in the current database.".to_string());
        }
        let filter = parse_mongo_filter(&raw)?;
        (names[0].clone(), filter)
    } else {
        return Err(
            "Use MongoDB shell syntax: db.collection.find({...}) or provide a JSON filter."
                .to_string(),
        );
    };

    // Try to determine the database name from the collection
    let db = client.default_database().ok_or_else(|| {
        "No default database available. Try switching to a database first.".to_string()
    })?;

    let collection = db.collection::<Document>(&collection_name);
    let max_rows = input.max_rows.unwrap_or(MAX_QUERY_ROWS) as i64;

    let mut cursor = collection
        .find(filter)
        .limit(max_rows)
        .await
        .map_err(|e| format!("MongoDB query failed: {}", e))?;

    let mut rows: Vec<BTreeMap<String, Option<String>>> = Vec::new();
    let mut columns: Vec<String> = Vec::new();
    let mut columns_set = HashSet::new();
    let mut total = 0usize;

    while let Some(result) = cursor.next().await {
        let doc = result.map_err(|e| format!("MongoDB cursor error: {}", e))?;
        if total == 0 {
            columns = doc.keys().cloned().collect();
            for col in &columns {
                columns_set.insert(col.clone());
            }
        } else {
            // Discover any new fields in subsequent documents
            for key in doc.keys() {
                if !columns_set.contains(key) {
                    columns.push(key.clone());
                    columns_set.insert(key.clone());
                }
            }
        }
        let mut row = BTreeMap::new();
        for key in &columns {
            let value = doc.get(key).and_then(bson_to_display_string);
            row.insert(key.clone(), value);
        }
        rows.push(row);
        total += 1;
        if total >= max_rows as usize {
            break;
        }
    }

    Ok(QueryResult {
        columns,
        rows,
        row_count: total,
        execution_ms: started_at.elapsed().as_millis(),
        truncated: false,
        command_tag: None,
    })
}

/// List all collections in the active database.
#[tauri::command]
pub async fn mongo_get_collections(
    app: AppHandle,
    state: State<'_, AppState>,
    connection_id: Option<String>,
) -> Result<Vec<TableInfo>, String> {
    let (connection_id, _engine) =
        resolve_connection_engine(&app, &state, connection_id.clone()).await?;
    let client = get_or_create_mongo_client(&app, &state, &connection_id).await?;

    let db = client.default_database().ok_or_else(|| {
        "No default database available.".to_string()
    })?;

    let db_name = db.name().to_string();
    let names = db
        .list_collection_names()
        .await
        .map_err(|e| format!("Failed to list collections: {}", e))?;

    Ok(names
        .into_iter()
        .map(|name| TableInfo {
            schema: db_name.clone(),
            name: name.clone(),
            preview_query: format!("db.{}.find({{}}).limit(100)", name),
        })
        .collect())
}

/// Infer the schema of a MongoDB collection by sampling documents.
#[tauri::command]
pub async fn mongo_get_schema(
    app: AppHandle,
    state: State<'_, AppState>,
    connection_id: Option<String>,
    database: String,
    collection: String,
) -> Result<Vec<ColumnInfo>, String> {
    let (connection_id, _engine) =
        resolve_connection_engine(&app, &state, connection_id.clone()).await?;
    let client = get_or_create_mongo_client(&app, &state, &connection_id).await?;

    let db = client.database(&database);
    let coll = db.collection::<Document>(&collection);

    let mut cursor = coll
        .find(doc! {})
        .limit(200)
        .await
        .map_err(|e| format!("MongoDB query failed: {}", e))?;

    // Track field → BSON type. First-seen type wins.
    let mut type_map: HashMap<String, String> = HashMap::new();
    // Track field → nullable. If any document lacks the field, it's nullable.
    let mut doc_count = 0usize;
    let mut field_doc_counts: HashMap<String, usize> = HashMap::new();

    while let Some(result) = cursor.next().await {
        let doc = result.map_err(|e| format!("MongoDB cursor error: {}", e))?;
        doc_count += 1;

        for (key, value) in doc.iter() {
            *field_doc_counts.entry(key.clone()).or_default() += 1;
            type_map
                .entry(key.clone())
                .or_insert_with(|| infer_bson_type(value).to_string());
        }
    }

    if doc_count == 0 {
        return Ok(Vec::new());
    }

    Ok(type_map
        .into_iter()
        .map(|(name, data_type)| {
            let field_count = field_doc_counts.get(&name).copied().unwrap_or(0);
            let is_nullable = field_count < doc_count;
            ColumnInfo {
                table_schema: database.clone(),
                table_name: collection.clone(),
                column_name: name,
                data_type,
                is_nullable,
            }
        })
        .collect())
}
