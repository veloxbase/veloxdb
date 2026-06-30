use std::collections::{BTreeMap, HashMap, HashSet};
use std::time::Instant;

use futures_util::StreamExt;
use mongodb::bson::{doc, Document};
use tauri::{AppHandle, State};

use crate::db::{get_or_create_mongo_client, resolve_connection_engine, AppState, MAX_QUERY_ROWS};
use crate::models::{ColumnInfo, QueryRequest, QueryResult, TableIndexesResult, TableInfo};

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

/// Extract the collection name from MongoDB shell syntax like `db.users` or `db.getSiblingDB('x').users`.
fn extract_shell_collection_name(prefix: &str) -> String {
    prefix
        .split('.')
        .last()
        .unwrap_or(prefix)
        .trim()
        .to_string()
}

/// Resolve `(database, collection)` for export from a MongoDB query string.
pub fn resolve_mongo_export_target(
    query: &str,
    default_database: &str,
) -> Result<(String, String), String> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Err("No MongoDB query to export.".to_string());
    }

    // Shell syntax: db.collection.find(...)
    if let Some(dot_find) = trimmed.find(".find(") {
        let collection = extract_shell_collection_name(trimmed[..dot_find].trim());
        if collection.is_empty() {
            return Err("Could not determine MongoDB collection from query.".to_string());
        }
        return Ok((default_database.to_string(), collection));
    }

    // database.collection (no shell find)
    if let Some(dot) = trimmed.find('.') {
        let prefix = trimmed[..dot].trim();
        let suffix = trimmed[dot + 1..].trim();
        let collection = suffix
            .split(|c: char| c.is_whitespace() || c == '(')
            .next()
            .unwrap_or(suffix)
            .trim();
        if prefix == "db" {
            if collection.is_empty() {
                return Err("Could not determine MongoDB collection from query.".to_string());
            }
            return Ok((default_database.to_string(), collection.to_string()));
        }
        if !prefix.is_empty() && !collection.is_empty() {
            return Ok((prefix.to_string(), collection.to_string()));
        }
    }

    // Bare collection name
    let collection = trimmed
        .split(|c: char| c.is_whitespace() || c == '(')
        .next()
        .unwrap_or(trimmed)
        .trim();
    if collection.is_empty() {
        return Err("Could not determine MongoDB collection from query.".to_string());
    }
    Ok((default_database.to_string(), collection.to_string()))
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
        let collection = extract_shell_collection_name(raw[..dot_find].trim());
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

// ── MongoDB Export ──────────────────────────────────────────────

pub async fn mongo_export_csv(
    app: &AppHandle,
    state: &AppState,
    connection_id: &str,
    database: &str,
    collection: &str,
    output_path: &str,
) -> Result<(), String> {
    let client = crate::db::get_or_create_mongo_client(app, state, connection_id).await?;
    let db = client.database(database);
    let coll = db.collection::<Document>(collection);

    let mut cursor = coll.find(doc! {}).limit(5000).await
        .map_err(|e| format!("MongoDB export failed: {}", e))?;

    let mut columns: Vec<String> = Vec::new();
    let mut rows: Vec<BTreeMap<String, Option<String>>> = Vec::new();
    let mut cols_set = HashSet::new();

    while let Some(result) = cursor.next().await {
        let doc = result.map_err(|e| format!("MongoDB cursor error: {}", e))?;
        if columns.is_empty() {
            columns = doc.keys().cloned().collect();
            for c in &columns { cols_set.insert(c.clone()); }
        } else {
            for k in doc.keys() {
                if !cols_set.contains(k) {
                    columns.push(k.clone());
                    cols_set.insert(k.clone());
                }
            }
        }
        let mut row = BTreeMap::new();
        for key in &columns {
            row.insert(key.clone(), doc.get(key).and_then(bson_to_display_string));
        }
        rows.push(row);
    }

    let mut wtr = csv::Writer::from_path(output_path).map_err(|e| e.to_string())?;
    wtr.write_record(&columns).map_err(|e| e.to_string())?;
    for row in &rows {
        let record: Vec<String> = columns.iter().map(|c| row.get(c).unwrap_or(&None).clone().unwrap_or_default()).collect();
        wtr.write_record(&record).map_err(|e| e.to_string())?;
    }
    wtr.flush().map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn mongo_export_json(
    app: &AppHandle,
    state: &AppState,
    connection_id: &str,
    database: &str,
    collection: &str,
    output_path: &str,
) -> Result<(), String> {
    let client = crate::db::get_or_create_mongo_client(app, state, connection_id).await?;
    let db = client.database(database);
    let coll = db.collection::<Document>(collection);

    let mut cursor = coll.find(doc! {}).limit(5000).await
        .map_err(|e| format!("MongoDB export failed: {}", e))?;

    let mut docs: Vec<serde_json::Value> = Vec::new();
    while let Some(result) = cursor.next().await {
        let doc = result.map_err(|e| format!("MongoDB cursor error: {}", e))?;
        let json_str = serde_json::to_string(&mongodb::bson::to_document(&doc).unwrap_or_default())
            .map_err(|e| e.to_string())?;
        docs.push(serde_json::from_str(&json_str).unwrap_or(serde_json::Value::Null));
    }
    let content = serde_json::to_string_pretty(&docs).map_err(|e| e.to_string())?;
    std::fs::write(output_path, content).map_err(|e| e.to_string())?;
    Ok(())
}

/// List indexes on a MongoDB collection.
pub async fn mongo_get_table_indexes(
    app: &AppHandle,
    state: &AppState,
    connection_id: &str,
    database: &str,
    collection: &str,
) -> Result<TableIndexesResult, String> {
    use crate::models::IndexInfo;
    let client = crate::db::get_or_create_mongo_client(app, state, connection_id).await?;
    let db = client.database(database);
    let coll = db.collection::<Document>(collection);

    let mut cursor = coll.list_indexes().await
        .map_err(|e| format!("MongoDB index listing failed: {}", e))?;

    let mut indexes = Vec::new();
    while let Some(result) = cursor.next().await {
        let idx = result.map_err(|e| format!("MongoDB index cursor error: {}", e))?;
        let name = idx.options.as_ref()
            .and_then(|o| o.name.clone())
            .unwrap_or_else(|| {
                idx.keys.iter()
                    .map(|(k, _)| k.clone())
                    .collect::<Vec<_>>()
                    .join("_")
            });
        let keys_doc = idx.keys.clone();
        let keys: Vec<String> = keys_doc.iter()
            .map(|(k, v)| {
                let dir = match v.as_i32() { Some(1) => "asc", Some(-1) => "desc", _ => "?" };
                format!("{}({})", k, dir)
            })
            .collect();
        indexes.push(IndexInfo {
            index_schema: database.to_string(),
            index_name: name.clone(),
            table_schema: database.to_string(),
            table_name: collection.to_string(),
            is_unique: false,
            is_primary: name == "_id_",
            is_valid: true,
            is_partial: false,
            definition: format!("index {} ({})", name, keys.join(", ")),
            index_bytes: 0,
            idx_scan: 0,
            idx_tup_read: 0,
            idx_tup_fetch: 0,
        });
    }

    let truncated = indexes.len() > 500;
    Ok(TableIndexesResult {
        indexes: if truncated { indexes.into_iter().take(500).collect() } else { indexes },
        truncated,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use mongodb::bson::{oid::ObjectId, Bson, DateTime as BsonDateTime};

    #[test]
    fn parse_empty_filter() {
        let result = parse_mongo_filter("").unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn parse_whitespace_filter() {
        let result = parse_mongo_filter("   ").unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn parse_valid_json() {
        let result = parse_mongo_filter(r#"{"status": "active"}"#).unwrap();
        assert_eq!(result.get_str("status").unwrap(), "active");
    }

    #[test]
    fn parse_json_with_number() {
        let result = parse_mongo_filter(r#"{"age": 25}"#).unwrap();
        assert_eq!(result.get_i32("age").unwrap(), 25);
    }

    #[test]
    fn parse_json_with_boolean() {
        let result = parse_mongo_filter(r#"{"verified": true}"#).unwrap();
        assert!(result.get_bool("verified").unwrap());
    }

    #[test]
    fn parse_json_with_null() {
        let result = parse_mongo_filter(r#"{"deletedAt": null}"#).unwrap();
        assert!(result.get("deletedAt").unwrap().as_null().is_some());
    }

    #[test]
    fn parse_json_with_operator() {
        let result = parse_mongo_filter(r#"{"age": {"$gt": 18}}"#).unwrap();
        let age = result.get_document("age").unwrap();
        assert_eq!(age.get_i32("$gt").unwrap(), 18);
    }

    #[test]
    fn extract_shell_collection_name_from_db_prefix() {
        assert_eq!(extract_shell_collection_name("db.users"), "users");
    }

    #[test]
    fn extract_shell_collection_name_without_db_prefix() {
        assert_eq!(extract_shell_collection_name("users"), "users");
    }

    #[test]
    fn extract_shell_collection_name_from_nested_path() {
        assert_eq!(
            extract_shell_collection_name("db.getSiblingDB('other').orders"),
            "orders"
        );
    }

    #[test]
    fn resolve_mongo_export_target_from_shell_syntax() {
        let (db, coll) =
            resolve_mongo_export_target(r#"db.users.find({"status": "active"})"#, "mydb").unwrap();
        assert_eq!(db, "mydb");
        assert_eq!(coll, "users");
    }

    #[test]
    fn resolve_mongo_export_target_from_database_collection() {
        let (db, coll) = resolve_mongo_export_target("analytics.orders", "mydb").unwrap();
        assert_eq!(db, "analytics");
        assert_eq!(coll, "orders");
    }

    #[test]
    fn resolve_mongo_export_target_from_bare_collection() {
        let (db, coll) = resolve_mongo_export_target("users", "mydb").unwrap();
        assert_eq!(db, "mydb");
        assert_eq!(coll, "users");
    }

    #[test]
    fn parse_shell_syntax_find() {
        let result = parse_mongo_filter(r#"db.users.find({"status": "active"})"#).unwrap();
        assert_eq!(result.get_str("status").unwrap(), "active");
    }

    #[test]
    fn parse_shell_syntax_with_limit() {
        let result = parse_mongo_filter(r#"db.users.find({"role": "admin"}).limit(10)"#).unwrap();
        assert_eq!(result.get_str("role").unwrap(), "admin");
    }

    #[test]
    fn parse_relaxed_json_single_quotes() {
        let result = parse_mongo_filter("{'name': 'John'}").unwrap();
        assert_eq!(result.get_str("name").unwrap(), "John");
    }

    #[test]
    fn parse_invalid_json_returns_empty() {
        let result = parse_mongo_filter("not json at all").unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn extract_simple_braced_json() {
        let result = extract_braced_json(r#"{"key": "value"}"#);
        assert_eq!(result.unwrap(), r#"{"key": "value"}"#);
    }

    #[test]
    fn extract_nested_braced_json() {
        let result = extract_braced_json(r#"{"outer": {"inner": true}}"#);
        assert!(result.unwrap().contains("inner"));
    }

    #[test]
    fn extract_braced_json_not_starting_with_brace_returns_none() {
        let result = extract_braced_json("not a json");
        assert!(result.is_none());
    }

    #[test]
    fn bson_string_display() {
        let value = Bson::String("hello".to_string());
        assert_eq!(bson_to_display_string(&value).unwrap(), "hello");
    }

    #[test]
    fn bson_int32_display() {
        let value = Bson::Int32(42);
        assert_eq!(bson_to_display_string(&value).unwrap(), "42");
    }

    #[test]
    fn bson_int64_display() {
        let value = Bson::Int64(9007199254740991);
        assert_eq!(bson_to_display_string(&value).unwrap(), "9007199254740991");
    }

    #[test]
    #[allow(clippy::approx_constant)]
    fn bson_double_display() {
        let value = Bson::Double(3.14);
        assert_eq!(bson_to_display_string(&value).unwrap(), "3.14");
    }

    #[test]
    fn bson_bool_display() {
        assert_eq!(bson_to_display_string(&Bson::Boolean(true)).unwrap(), "true");
        assert_eq!(bson_to_display_string(&Bson::Boolean(false)).unwrap(), "false");
    }

    #[test]
    fn bson_objectid_display() {
        let oid = ObjectId::new();
        let value = Bson::ObjectId(oid);
        let displayed = bson_to_display_string(&value).unwrap();
        assert_eq!(displayed.len(), 24);
        assert!(displayed.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn bson_null_display() {
        assert!(bson_to_display_string(&Bson::Null).is_none());
    }

    #[test]
    fn bson_array_display() {
        let value = Bson::Array(vec![Bson::Int32(1), Bson::Int32(2), Bson::Int32(3)]);
        let result = bson_to_display_string(&value).unwrap();
        assert!(result.contains("3 items"));
    }

    #[test]
    fn bson_document_display() {
        let value = Bson::Document(doc! { "key": "val" });
        assert_eq!(bson_to_display_string(&value).unwrap(), "{...}");
    }

    #[test]
    fn bson_binary_display() {
        use mongodb::bson::Binary;
        let value = Bson::Binary(Binary {
            subtype: mongodb::bson::spec::BinarySubtype::Generic,
            bytes: vec![0, 1, 2],
        });
        assert_eq!(bson_to_display_string(&value).unwrap(), "<binary>");
    }

    #[test]
    fn bson_datetime_display() {
        use chrono::TimeZone;
        let dt = chrono::Utc.with_ymd_and_hms(2024, 3, 15, 10, 30, 45).unwrap();
        let bson_dt = BsonDateTime::from_millis(dt.timestamp_millis());
        let value = Bson::DateTime(bson_dt);
        let result = bson_to_display_string(&value).unwrap();
        assert!(result.contains("2024-03-15"));
    }

    #[test]
    fn infer_bson_type_string() {
        assert_eq!(infer_bson_type(&Bson::String("hello".to_string())), "string");
    }

    #[test]
    fn infer_bson_type_integer() {
        assert_eq!(infer_bson_type(&Bson::Int32(1)), "integer");
        assert_eq!(infer_bson_type(&Bson::Int64(1)), "integer");
    }

    #[test]
    fn infer_bson_type_double() {
        assert_eq!(infer_bson_type(&Bson::Double(1.0)), "double");
    }

    #[test]
    fn infer_bson_type_boolean() {
        assert_eq!(infer_bson_type(&Bson::Boolean(true)), "boolean");
    }

    #[test]
    fn infer_bson_type_objectid() {
        assert_eq!(infer_bson_type(&Bson::ObjectId(ObjectId::new())), "objectId");
    }

    #[test]
    fn infer_bson_type_date() {
        let dt = BsonDateTime::from_millis(0);
        assert_eq!(infer_bson_type(&Bson::DateTime(dt)), "date");
    }

    #[test]
    fn infer_bson_type_array() {
        assert_eq!(infer_bson_type(&Bson::Array(vec![])), "array");
    }

    #[test]
    fn infer_bson_type_document() {
        assert_eq!(infer_bson_type(&Bson::Document(doc! {})), "object");
    }

    #[test]
    fn infer_bson_type_null() {
        assert_eq!(infer_bson_type(&Bson::Null), "null");
    }

    #[test]
    fn infer_bson_type_regex() {
        use mongodb::bson::Regex;
        assert_eq!(infer_bson_type(&Bson::RegularExpression(Regex {
            pattern: ".*".to_string(),
            options: "".to_string(),
        })), "regex");
    }

    // ── Cross-engine QueryResult compatibility ──────────────────

    #[test]
    fn query_result_structure_is_consistent_across_engines() {
        use crate::models::QueryResult;
        use std::collections::BTreeMap;

        // Simulate a SQL result (Postgres/MySQL/SQLite format)
        let sql_result = QueryResult {
            columns: vec!["id".to_string(), "name".to_string()],
            rows: vec![
                BTreeMap::from([
                    ("id".to_string(), Some("1".to_string())),
                    ("name".to_string(), Some("Alice".to_string())),
                ]),
            ],
            row_count: 1,
            execution_ms: 15,
            truncated: false,
            command_tag: None,
        };

        // Simulate a MongoDB result (should match exactly the same shape)
        let mongo_result = QueryResult {
            columns: vec!["_id".to_string(), "name".to_string()],
            rows: vec![
                BTreeMap::from([
                    ("_id".to_string(), Some("507f1f77bcf86cd799439011".to_string())),
                    ("name".to_string(), Some("Alice".to_string())),
                ]),
            ],
            row_count: 1,
            execution_ms: 18,
            truncated: false,
            command_tag: None,
        };

        // Both have same shape (structurally identical)
        assert_eq!(sql_result.columns.len(), 2);
        assert_eq!(mongo_result.columns.len(), 2);
        assert_eq!(sql_result.rows.len(), 1);
        assert_eq!(mongo_result.rows.len(), 1);
        assert!(!sql_result.truncated);
        assert!(!mongo_result.truncated);

        // Both are serializable (Tauri IPC sends JSON)
        let sql_json = serde_json::to_string(&sql_result).unwrap();
        let mongo_json = serde_json::to_string(&mongo_result).unwrap();
        assert!(sql_json.contains("\"columns\""));
        assert!(mongo_json.contains("\"columns\""));
        assert!(sql_json.contains("\"rows\""));
        assert!(mongo_json.contains("\"rows\""));
    }

    #[test]
    fn empty_mongo_result_matches_sql_format() {
        use crate::models::QueryResult;

        let empty = QueryResult {
            columns: vec![],
            rows: vec![],
            row_count: 0,
            execution_ms: 0,
            truncated: false,
            command_tag: None,
        };

        // An empty query result should be structurally identical
        // regardless of engine — this is what the frontend expects.
        assert_eq!(empty.columns.len(), 0);
        assert_eq!(empty.rows.len(), 0);
        assert_eq!(empty.row_count, 0);
        assert!(!empty.truncated);
    }

    #[test]
    fn mongo_null_values_match_sql_null() {
        use std::collections::BTreeMap;

        // SQL NULL and MongoDB null/absent field both map to Option<String>::None
        // Both engines produce the same format for the frontend grid.

        let sql_row = BTreeMap::from([
            ("name".to_string(), Some("Alice".to_string())),
            ("email".to_string(), None), // SQL NULL
        ]);

        let mongo_row = BTreeMap::from([
            ("name".to_string(), Some("Bob".to_string())),
            ("email".to_string(), None), // MongoDB field missing or null
        ]);

        // Both use Option<String> for values — the frontend treats None as "NULL"
        assert_eq!(sql_row.get("email").unwrap(), &None);
        assert_eq!(mongo_row.get("email").unwrap(), &None);
        assert_eq!(sql_row.get("name").unwrap(), &Some("Alice".to_string()));
        assert_eq!(mongo_row.get("name").unwrap(), &Some("Bob".to_string()));
    }

    #[test]
    fn mongo_dynamic_columns_produces_tabular_rows() {
        use std::collections::BTreeMap;

        // When MongoDB documents have different fields, we union the keys
        // and fill missing columns with None (same as SQL NULL).

        let columns = vec!["name".to_string(), "extra".to_string()];
        let rows = vec![
            BTreeMap::from([
                ("name".to_string(), Some("doc1".to_string())),
                ("extra".to_string(), Some("value1".to_string())),
            ]),
            BTreeMap::from([
                ("name".to_string(), Some("doc2".to_string())),
                ("extra".to_string(), None), // this doc lacks the field
            ]),
        ];

        // Every row should have an entry for every column (even if None)
        for row in &rows {
            for col in &columns {
                assert!(row.contains_key(col), "row missing column: {}", col);
            }
        }
    }
}
