use std::collections::BTreeMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;

use futures_util::StreamExt;
use serde_json::Value;
use tauri::{AppHandle, Emitter};
use sqlx::{Column, Decode, Row, Type};
use sqlx::mysql::{MySql, MySqlRow};
use sqlx::sqlite::{Sqlite, SqliteRow};

use crate::db::{
    get_or_create_mysql_pool, get_or_create_sqlite_pool, AppState,
};
use crate::models::{
    AskVeloxyDbContextCache, AskVeloxyTableRef, DatabaseEngine,
    ForeignKeyEdge, QueryEditorTable, QueryResult, VeloxyStreamChunk,
};
use crate::sql_split::split_sql_statements;

// --- Constants ---

pub(crate) const MAX_FOREIGN_KEY_ROWS: i64 = 5000;
pub(crate) const MAX_TABLE_INDEX_ROWS: i64 = 500;
pub(crate) const MAX_EDITOR_TABLES: i64 = 150;
pub(crate) const MAX_EDITOR_COLUMNS_PER_TABLE: i64 = 60;
pub(crate) const MAX_EDITOR_FUNCTIONS: i64 = 200;
pub(crate) const MAX_LINT_SQL_BYTES: usize = 65_536;
pub(crate) const ASK_VELOXY_MAX_CONTEXT_TABLES: usize = 8;
pub(crate) const ASK_VELOXY_MAX_CONTEXT_COLUMNS: usize = 18;
pub(crate) const ASK_VELOXY_MAX_CONTEXT_RELATIONSHIPS: usize = 36;
pub(crate) const ASK_VELOXY_SCHEMA_CHAR_BUDGET: usize = 6_000;
pub(crate) const ASK_VELOXY_PROMPT_CHAR_BUDGET: usize = 12_000;
pub(crate) const ASK_VELOXY_MAX_HISTORY_MESSAGES: usize = 30;
pub(crate) const ASK_VELOXY_MAX_CHAT_TOKENS: u32 = 10_000;

// --- MySQL / SQLite decode helpers ---

pub(crate) fn mysql_decode_error(context: &str, column_name: &str, index: Option<usize>, detail: &str) -> String {
    match index {
        Some(idx) => format!(
            "MySQL decode error in {} at column '{}' (index {}): {}",
            context, column_name, idx, detail
        ),
        None => format!(
            "MySQL decode error in {} at column '{}': {}",
            context, column_name, detail
        ),
    }
}

pub(crate) fn sqlite_decode_error(context: &str, column_name: &str, index: Option<usize>, detail: &str) -> String {
    match index {
        Some(idx) => format!(
            "SQLite decode error in {} at column '{}' (index {}): {}",
            context, column_name, idx, detail
        ),
        None => format!(
            "SQLite decode error in {} at column '{}': {}",
            context, column_name, detail
        ),
    }
}

pub(crate) fn mysql_get_idx<T>(row: &MySqlRow, index: usize, column_name: &str, context: &str) -> Result<T, String>
where
    for<'r> T: Decode<'r, MySql> + Type<MySql>,
{
    row.try_get::<T, _>(index)
        .map_err(|error| mysql_decode_error(context, column_name, Some(index), &error.to_string()))
}

pub(crate) fn sqlite_get_idx<T>(row: &SqliteRow, index: usize, column_name: &str, context: &str) -> Result<T, String>
where
    for<'r> T: Decode<'r, Sqlite> + Type<Sqlite>,
{
    row.try_get::<T, _>(index)
        .map_err(|error| sqlite_decode_error(context, column_name, Some(index), &error.to_string()))
}

pub(crate) fn sqlite_get_name<T>(row: &SqliteRow, column_name: &str, context: &str) -> Result<T, String>
where
    for<'r> T: Decode<'r, Sqlite> + Type<Sqlite>,
{
    row.try_get::<T, _>(column_name).map_err(|error| {
        format!(
            "SQLite decode error in {} at column '{}': {}",
            context, column_name, error
        )
    })
}

pub(crate) fn database_name_from_mysql_value(value: Option<String>, context: &str) -> Result<String, String> {
    let name = value
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("{context} returned an empty database name"))?;
    Ok(name)
}

pub(crate) fn mysql_database_name_from_row(row: &MySqlRow, context: &str) -> Result<String, String> {
    let value = mysql_value_to_string(row, 0, "Database", context)?;
    database_name_from_mysql_value(value, context)
}

pub(crate) fn mysql_value_to_string(row: &MySqlRow, index: usize, column_name: &str, context: &str) -> Result<Option<String>, String> {
    if let Ok(value) = row.try_get::<Option<String>, _>(index) {
        return Ok(value);
    }
    if let Ok(value) = row.try_get::<Option<i64>, _>(index) {
        return Ok(value.map(|v| v.to_string()));
    }
    if let Ok(value) = row.try_get::<Option<i32>, _>(index) {
        return Ok(value.map(|v| v.to_string()));
    }
    if let Ok(value) = row.try_get::<Option<u64>, _>(index) {
        return Ok(value.map(|v| v.to_string()));
    }
    if let Ok(value) = row.try_get::<Option<f64>, _>(index) {
        return Ok(value.map(|v| v.to_string()));
    }
    if let Ok(value) = row.try_get::<Option<f32>, _>(index) {
        return Ok(value.map(|v| v.to_string()));
    }
    if let Ok(value) = row.try_get::<Option<bool>, _>(index) {
        return Ok(value.map(|v| v.to_string()));
    }
    if let Ok(value) = row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>(index) {
        return Ok(value.map(|v| v.format("%Y-%m-%d %H:%M:%S").to_string()));
    }
    if let Ok(value) = row.try_get::<Option<chrono::NaiveDateTime>, _>(index) {
        return Ok(value.map(|v| v.format("%Y-%m-%d %H:%M:%S").to_string()));
    }
    if let Ok(value) = row.try_get::<Option<chrono::NaiveDate>, _>(index) {
        return Ok(value.map(|v| v.to_string()));
    }
    if let Ok(value) = row.try_get::<Option<chrono::NaiveTime>, _>(index) {
        return Ok(value.map(|v| v.to_string()));
    }
    if let Ok(value) = row.try_get::<Option<Vec<u8>>, _>(index) {
        return Ok(value.map(|v| decode_mysql_bytes_as_string(&v)));
    }
    Err(mysql_decode_error(context, column_name, Some(index), "unsupported value type"))
}

pub(crate) fn decode_mysql_bytes_as_string(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

pub(crate) fn mysql_value_to_display_string(
    row: &MySqlRow,
    index: usize,
    column_name: &str,
    context: &str,
) -> Result<Option<String>, String> {
    if let Ok(value) = row.try_get::<Option<String>, _>(index) {
        return Ok(value);
    }
    if let Ok(value) = row.try_get::<Option<i64>, _>(index) {
        return Ok(value.map(|v| v.to_string()));
    }
    if let Ok(value) = row.try_get::<Option<i32>, _>(index) {
        return Ok(value.map(|v| v.to_string()));
    }
    if let Ok(value) = row.try_get::<Option<u64>, _>(index) {
        return Ok(value.map(|v| v.to_string()));
    }
    if let Ok(value) = row.try_get::<Option<f64>, _>(index) {
        return Ok(value.map(|v| v.to_string()));
    }
    if let Ok(value) = row.try_get::<Option<f32>, _>(index) {
        return Ok(value.map(|v| v.to_string()));
    }
    if let Ok(value) = row.try_get::<Option<bool>, _>(index) {
        return Ok(value.map(|v| v.to_string()));
    }
    if let Ok(value) = row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>(index) {
        return Ok(value.map(|v| v.format("%Y-%m-%d %H:%M:%S").to_string()));
    }
    if let Ok(value) = row.try_get::<Option<chrono::NaiveDateTime>, _>(index) {
        return Ok(value.map(|v| v.format("%Y-%m-%d %H:%M:%S").to_string()));
    }
    if let Ok(value) = row.try_get::<Option<chrono::NaiveDate>, _>(index) {
        return Ok(value.map(|v| v.to_string()));
    }
    if let Ok(value) = row.try_get::<Option<chrono::NaiveTime>, _>(index) {
        return Ok(value.map(|v| v.to_string()));
    }
    if let Ok(value) = row.try_get::<Option<Vec<u8>>, _>(index) {
        return Ok(value.map(|v| format!("0x{}", hex::encode(v))));
    }
    Err(mysql_decode_error(context, column_name, Some(index), "unsupported value type"))
}

pub(crate) fn mysql_get_string(row: &MySqlRow, index: usize, column_name: &str, context: &str) -> Result<String, String> {
    let value = mysql_value_to_string(row, index, column_name, context)?;
    value.ok_or_else(|| mysql_decode_error(context, column_name, Some(index), "unexpected null value"))
}

pub(crate) fn mysql_get_optional_string(
    row: &MySqlRow,
    index: usize,
    column_name: &str,
    context: &str,
) -> Result<Option<String>, String> {
    mysql_value_to_string(row, index, column_name, context)
}

pub(crate) fn sqlite_value_to_string(row: &SqliteRow, index: usize, column_name: &str, context: &str) -> Result<Option<String>, String> {
    if let Ok(value) = row.try_get::<Option<String>, _>(index) {
        return Ok(value);
    }
    if let Ok(value) = row.try_get::<Option<i64>, _>(index) {
        return Ok(value.map(|v| v.to_string()));
    }
    if let Ok(value) = row.try_get::<Option<f64>, _>(index) {
        return Ok(value.map(|v| v.to_string()));
    }
    if let Ok(value) = row.try_get::<Option<bool>, _>(index) {
        return Ok(value.map(|v| v.to_string()));
    }
    if let Ok(value) = row.try_get::<Option<Vec<u8>>, _>(index) {
        return Ok(value.map(|v| format!("0x{}", hex::encode(v))));
    }
    Err(sqlite_decode_error(context, column_name, Some(index), "unsupported value type"))
}

// --- SQL helpers ---

pub(crate) fn is_row_returning_sql(sql: &str) -> bool {
    let trimmed = sql.trim_start();
    let upper = trimmed.to_uppercase();
    upper.starts_with("SELECT")
        || upper.starts_with("WITH")
        || upper.starts_with("SHOW")
        || upper.starts_with("EXPLAIN")
        || upper.starts_with("DESCRIBE")
        || upper.starts_with("DESC")
        || upper.starts_with("PRAGMA")
        || upper.starts_with("VALUES")
        || upper.starts_with("TABLE ")
}

pub(crate) fn classify_sql_intent(sql: &str) -> String {
    let normalized = sql.trim_start().to_ascii_lowercase();
    if normalized.starts_with("select") || normalized.starts_with("with") {
        return "select".to_string();
    }
    if normalized.starts_with("insert") {
        return "insert".to_string();
    }
    if normalized.starts_with("update") {
        return "update".to_string();
    }
    if normalized.starts_with("delete") {
        return "delete".to_string();
    }
    if normalized.starts_with("explain") {
        return "explain".to_string();
    }
    "unknown".to_string()
}

pub(crate) fn is_read_only_sql(sql: &str) -> bool {
    let mut saw_statement = false;
    for statement in sql.split(';').map(str::trim).filter(|s| !s.is_empty()) {
        let normalized = statement.to_ascii_lowercase();
        let is_transaction_control = ["begin", "commit", "rollback", "start", "savepoint", "release"]
            .iter()
            .any(|kw| normalized.starts_with(kw));
        if is_transaction_control {
            continue;
        }
        saw_statement = true;
        match classify_sql_intent(statement).as_str() {
            "select" | "explain" => {}
            _ => return false,
        }
    }
    saw_statement
}

pub(crate) fn has_multiple_statements(sql: &str) -> bool {
    sql.split(';')
        .map(str::trim)
        .filter(|segment| !segment.is_empty())
        .count() > 1
}

pub(crate) fn validate_generated_sql(sql: &str) -> Result<(), String> {
    let trimmed = sql.trim();
    if trimmed.is_empty() {
        return Err("Ask Veloxy returned an empty SQL statement.".to_string());
    }
    if has_multiple_statements(trimmed) {
        return Err("Ask Veloxy generated multiple SQL statements. Please ask for a single statement.".to_string());
    }
    Ok(())
}

// --- Row mapping ---

pub(crate) fn map_mysql_rows(
    rows: Vec<MySqlRow>,
    max_query_rows: usize,
) -> Result<(Vec<String>, Vec<BTreeMap<String, Option<String>>>, usize, bool), String> {
    let mut columns: Vec<String> = Vec::new();
    if let Some(first) = rows.first() {
        columns = first.columns().iter().map(|column| column.name().to_string()).collect();
    }
    let total_rows = rows.len();
    let mut mapped_rows = Vec::new();
    for row in rows.into_iter().take(max_query_rows) {
        let mut mapped_row = BTreeMap::new();
        for (index, column_name) in columns.iter().enumerate() {
            let value = mysql_value_to_display_string(&row, index, column_name, "run_query")?;
            mapped_row.insert(column_name.clone(), value);
        }
        mapped_rows.push(mapped_row);
    }
    Ok((columns, mapped_rows, total_rows, total_rows > max_query_rows))
}

pub(crate) fn map_sqlite_rows(
    rows: Vec<SqliteRow>,
    max_query_rows: usize,
) -> Result<(Vec<String>, Vec<BTreeMap<String, Option<String>>>, usize, bool), String> {
    let mut columns: Vec<String> = Vec::new();
    if let Some(first) = rows.first() {
        columns = first.columns().iter().map(|column| column.name().to_string()).collect();
    }
    let total_rows = rows.len();
    let mut mapped_rows = Vec::new();
    for row in rows.into_iter().take(max_query_rows) {
        let mut mapped_row = BTreeMap::new();
        for (index, column_name) in columns.iter().enumerate() {
            let value = sqlite_value_to_string(&row, index, column_name, "run_query")?;
            mapped_row.insert(column_name.clone(), value);
        }
        mapped_rows.push(mapped_row);
    }
    Ok((columns, mapped_rows, total_rows, total_rows > max_query_rows))
}

pub(crate) async fn run_query_mysql_or_sqlite(
    app: &AppHandle,
    state: &AppState,
    connection_id: &str,
    sql: &str,
    max_query_rows: usize,
    engine: DatabaseEngine,
) -> Result<QueryResult, String> {
    let started_at = Instant::now();
    let statements = split_sql_statements(sql);
    if statements.is_empty() {
        return Err("Enter a SQL statement before running the query.".to_string());
    }

    let mut columns = Vec::new();
    let mut rows = Vec::new();
    let mut total_rows = 0usize;
    let mut truncated = false;
    let mut command_tag: Option<u64> = None;

    match engine {
        DatabaseEngine::Mysql => {
            let pool = get_or_create_mysql_pool(app, state, connection_id).await?;
            let mut conn = pool.acquire().await.map_err(|error| error.to_string())?;
            for statement in statements {
                if is_row_returning_sql(&statement) {
                    let fetched = sqlx::query(&statement)
                        .fetch_all(&mut *conn)
                        .await
                        .map_err(|error| error.to_string())?;
                    let mapped = map_mysql_rows(fetched, max_query_rows)?;
                    columns = mapped.0;
                    rows = mapped.1;
                    total_rows = mapped.2;
                    truncated = mapped.3;
                    command_tag = None;
                } else {
                    let result = sqlx::query(&statement)
                        .execute(&mut *conn)
                        .await
                        .map_err(|error| error.to_string())?;
                    let affected = result.rows_affected();
                    command_tag = Some(affected);
                    if rows.is_empty() {
                        total_rows = affected as usize;
                    }
                }
            }
        }
        DatabaseEngine::Sqlite => {
            let pool = get_or_create_sqlite_pool(app, state, connection_id).await?;
            let mut conn = pool.acquire().await.map_err(|error| error.to_string())?;
            for statement in statements {
                if is_row_returning_sql(&statement) {
                    let fetched = sqlx::query(&statement)
                        .fetch_all(&mut *conn)
                        .await
                        .map_err(|error| error.to_string())?;
                    let mapped = map_sqlite_rows(fetched, max_query_rows)?;
                    columns = mapped.0;
                    rows = mapped.1;
                    total_rows = mapped.2;
                    truncated = mapped.3;
                    command_tag = None;
                } else {
                    let result = sqlx::query(&statement)
                        .execute(&mut *conn)
                        .await
                        .map_err(|error| error.to_string())?;
                    let affected = result.rows_affected();
                    command_tag = Some(affected);
                    if rows.is_empty() {
                        total_rows = affected as usize;
                    }
                }
            }
        }
        DatabaseEngine::Mongo => {
            return Err("Internal engine routing error (MongoDB uses its own query path).".to_string());
        }
        DatabaseEngine::Duckdb => {
            return Err("Internal engine routing error (DuckDB uses its own query path).".to_string());
        }
        DatabaseEngine::Redis => {
            return Err("Internal engine routing error (Redis uses its own command path).".to_string());
        }
        DatabaseEngine::Postgres => {
            return Err("Internal engine routing error.".to_string());
        }
    }

    Ok(QueryResult {
        columns,
        row_count: if rows.is_empty() { total_rows } else { rows.len() },
        rows,
        execution_ms: started_at.elapsed().as_millis(),
        truncated,
        command_tag,
    })
}

// --- Veloxy helpers ---

pub(crate) fn estimate_tokens(chars: usize) -> usize {
    (chars / 4).max(1)
}

pub(crate) fn normalize_openrouter_base(base: Option<&str>) -> String {
    let trimmed = base.unwrap_or("https://openrouter.ai/api/v1").trim();
    let value = if trimmed.is_empty() { "https://openrouter.ai/api/v1" } else { trimmed };
    value.trim_end_matches('/').to_string()
}

pub(crate) fn truncate_on_char_boundary(value: &mut String, max_bytes: usize) {
    if value.len() <= max_bytes {
        return;
    }
    let mut truncate_at = max_bytes;
    while !value.is_char_boundary(truncate_at) && truncate_at > 0 {
        truncate_at -= 1;
    }
    value.truncate(truncate_at);
}

pub(crate) fn ask_veloxy_context_cache_key(connection_id: &str, database_name: &str) -> String {
    format!("{}::{}", connection_id, database_name)
}

pub(crate) fn ask_veloxy_conversation_key(connection_id: &str, database_name: &str) -> String {
    format!("{}::{}", connection_id, database_name)
}

pub(crate) fn now_epoch_seconds() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()
}

pub(crate) fn table_matches_target(table: &QueryEditorTable, target: Option<&AskVeloxyTableRef>) -> bool {
    let Some(target) = target else { return false };
    table.schema.eq_ignore_ascii_case(&target.schema) && table.name.eq_ignore_ascii_case(&target.name)
}

pub(crate) fn table_relevance_score(table: &QueryEditorTable, prompt_lower: &str) -> usize {
    let mut score = 0usize;
    let full_name = format!("{}.{}", table.schema.to_lowercase(), table.name.to_lowercase());
    if prompt_lower.contains(&table.name.to_lowercase()) { score += 3; }
    if prompt_lower.contains(&table.schema.to_lowercase()) { score += 2; }
    if prompt_lower.contains(&full_name) { score += 4; }
    score
}

pub(crate) fn relationship_relevance_score(edge: &ForeignKeyEdge, prompt_lower: &str) -> usize {
    let from_name = format!("{}.{}", edge.from_schema.to_lowercase(), edge.from_table.to_lowercase());
    let to_name = format!("{}.{}", edge.to_schema.to_lowercase(), edge.to_table.to_lowercase());
    let mut score = 0usize;
    if prompt_lower.contains(&edge.from_table.to_lowercase()) || prompt_lower.contains(&from_name) {
        score += 2;
    }
    if prompt_lower.contains(&edge.to_table.to_lowercase()) || prompt_lower.contains(&to_name) {
        score += 2;
    }
    score
}

pub(crate) fn build_schema_context(
    db_context: &AskVeloxyDbContextCache,
    prompt: &str,
    target_table: Option<&AskVeloxyTableRef>,
) -> String {
    let prompt_lower = prompt.to_lowercase();
    let mut ranked: Vec<(&QueryEditorTable, usize, bool)> = db_context
        .metadata
        .tables
        .iter()
        .map(|table| {
            (table, table_relevance_score(table, &prompt_lower), table_matches_target(table, target_table))
        })
        .collect();

    ranked.sort_by(|a, b| b.2.cmp(&a.2).then_with(|| b.1.cmp(&a.1)));

    let mut schema_context = String::new();
    schema_context.push_str(&format!(
        "database {} engine {:?}\n", db_context.database_name, db_context.engine
    ));
    for (table, _score, _is_target) in ranked.into_iter().take(ASK_VELOXY_MAX_CONTEXT_TABLES) {
        let columns = table
            .columns
            .iter()
            .take(ASK_VELOXY_MAX_CONTEXT_COLUMNS)
            .map(|column| format!("{}:{}", column.name, column.data_type))
            .collect::<Vec<_>>()
            .join(", ");
        schema_context.push_str(&format!(
            "table {}.{} columns [{}]\n", table.schema, table.name, columns
        ));
        if schema_context.len() >= ASK_VELOXY_SCHEMA_CHAR_BUDGET {
            truncate_on_char_boundary(&mut schema_context, ASK_VELOXY_SCHEMA_CHAR_BUDGET);
            break;
        }
    }

    let mut ranked_relationships = db_context
        .foreign_keys
        .iter()
        .map(|edge| (edge, relationship_relevance_score(edge, &prompt_lower)))
        .collect::<Vec<_>>();
    ranked_relationships.sort_by(|a, b| b.1.cmp(&a.1));
    for (edge, _score) in ranked_relationships
        .into_iter()
        .take(ASK_VELOXY_MAX_CONTEXT_RELATIONSHIPS)
    {
        schema_context.push_str(&format!(
            "relationship {}.{}({}) -> {}.{}({})\n",
            edge.from_schema, edge.from_table, edge.from_column,
            edge.to_schema, edge.to_table, edge.to_column
        ));
        if schema_context.len() >= ASK_VELOXY_SCHEMA_CHAR_BUDGET {
            truncate_on_char_boundary(&mut schema_context, ASK_VELOXY_SCHEMA_CHAR_BUDGET);
            break;
        }
    }
    schema_context
}

pub(crate) fn extract_sql_draft_from_text(message: &str) -> Option<String> {
    let lowered = message.to_lowercase();
    let markers = ["select ", "with ", "insert ", "update ", "delete ", "explain "];
    let start = markers.iter().filter_map(|marker| lowered.find(marker)).min()?;
    let mut sql = message[start..].trim().to_string();
    if let Some(idx) = sql.find("```") { sql.truncate(idx); }
    if sql.ends_with('.') { sql.pop(); }
    if sql.is_empty() { None } else { Some(sql) }
}

pub(crate) fn parse_bool_field(value: &Value, field: &str, default: bool) -> bool {
    value.get(field).and_then(Value::as_bool).unwrap_or(default)
}

pub(crate) fn extract_openrouter_message_content(payload: &Value) -> Result<String, String> {
    let content_value = payload
        .get("choices")
        .and_then(|choices| choices.get(0))
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("content"))
        .ok_or_else(|| "OpenRouter response missing choices[0].message.content".to_string())?;

    if let Some(content) = content_value.as_str() {
        return Ok(content.to_string());
    }

    if let Some(items) = content_value.as_array() {
        let mut merged = String::new();
        for item in items {
            if let Some(text) = item.get("text").and_then(Value::as_str) {
                merged.push_str(text);
            }
        }
        if !merged.trim().is_empty() {
            return Ok(merged);
        }
    }

    Err("OpenRouter returned an unsupported message format.".to_string())
}

pub(crate) fn parse_ask_veloxy_json(content: &str) -> Result<Value, String> {
    if let Ok(value) = serde_json::from_str::<Value>(content) {
        return Ok(value);
    }
    let start = content.find('{');
    let end = content.rfind('}');
    match (start, end) {
        (Some(start_idx), Some(end_idx)) if end_idx > start_idx => {
            serde_json::from_str::<Value>(&content[start_idx..=end_idx])
                .map_err(|error| format!("Ask Veloxy response was not valid JSON: {}", error))
        }
        _ => Err("Ask Veloxy response did not contain JSON.".to_string()),
    }
}

pub(crate) fn parse_ask_veloxy_suggestions(generated: &Value) -> Vec<String> {
    generated
        .get("suggestions")
        .and_then(Value::as_array)
        .map(|items| {
            items.iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|item| !item.is_empty())
                .take(5)
                .map(|item| {
                    let mut value = item.to_string();
                    truncate_on_char_boundary(&mut value, 200);
                    value
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

pub(crate) fn parse_ask_veloxy_chat_json(content: &str) -> Result<Value, String> {
    if let Ok(value) = serde_json::from_str::<Value>(content) {
        return Ok(value);
    }
    let start = content.find('{');
    let end = content.rfind('}');
    match (start, end) {
        (Some(start_idx), Some(end_idx)) if end_idx > start_idx => {
            serde_json::from_str::<Value>(&content[start_idx..=end_idx])
                .map_err(|error| format!("Ask Veloxy chat JSON was invalid: {}", error))
        }
        _ => Err("Ask Veloxy chat response did not contain JSON.".to_string()),
    }
}

fn decode_json_quoted_string(value: &str) -> Option<String> {
    serde_json::from_str::<String>(&format!("\"{}\"", value)).ok()
}

fn unescape_json_string_fragment(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut chars = raw.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\\' {
            match chars.next() {
                Some('n') => out.push('\n'),
                Some('t') => out.push('\t'),
                Some('r') => out.push('\r'),
                Some('"') => out.push('"'),
                Some('\\') => out.push('\\'),
                Some(other) => { out.push('\\'); out.push(other); }
                None => out.push('\\'),
            }
        } else {
            out.push(ch);
        }
    }
    out
}

fn extract_json_string_field(content: &str, key: &str, allow_partial: bool) -> Option<String> {
    let marker = format!("\"{}\"", key);
    let marker_idx = content.find(&marker)?;
    let mut idx = marker_idx + marker.len();
    let bytes = content.as_bytes();

    while idx < bytes.len() && bytes[idx].is_ascii_whitespace() { idx += 1; }
    if idx >= bytes.len() || bytes[idx] != b':' { return None; }
    idx += 1;
    while idx < bytes.len() && bytes[idx].is_ascii_whitespace() { idx += 1; }
    if idx >= bytes.len() || bytes[idx] != b'"' { return None; }
    idx += 1;
    let start = idx;
    let mut escaped = false;
    while idx < bytes.len() {
        let byte = bytes[idx];
        if escaped { escaped = false; idx += 1; continue; }
        if byte == b'\\' { escaped = true; idx += 1; continue; }
        if byte == b'"' {
            let raw = &content[start..idx];
            return decode_json_quoted_string(raw)
                .or_else(|| Some(unescape_json_string_fragment(raw)))
                .map(|text| text.trim().to_string())
                .filter(|text| !text.is_empty());
        }
        idx += 1;
    }

    if allow_partial && start < bytes.len() {
        let raw = &content[start..];
        let text = unescape_json_string_fragment(raw).trim().to_string();
        if !text.is_empty() { return Some(text); }
    }
    None
}

pub(crate) fn extract_message_from_loose_json(content: &str) -> Option<String> {
    let trimmed = content.trim();
    if trimmed.is_empty() { return None; }
    let unwrapped = trimmed
        .strip_prefix("```json")
        .or_else(|| trimmed.strip_prefix("```JSON"))
        .map(str::trim_start)
        .unwrap_or(trimmed);
    let unwrapped = unwrapped.strip_suffix("```").unwrap_or(unwrapped).trim();

    ["message", "reply", "content"]
        .iter()
        .find_map(|key| extract_json_string_field(unwrapped, key, false))
        .or_else(|| {
            ["message", "reply", "content"]
                .iter()
                .find_map(|key| extract_json_string_field(unwrapped, key, true))
        })
}

pub(crate) fn looks_like_json_response(content: &str) -> bool {
    let trimmed = content.trim_start();
    trimmed.starts_with('{') || trimmed.starts_with("```")
}

pub(crate) fn streaming_display_text(accumulated: &str) -> String {
    let trimmed = accumulated.trim();
    if trimmed.is_empty() { return String::new(); }
    if let Some(text) = extract_message_from_loose_json(trimmed) { return text; }
    if !looks_like_json_response(trimmed) { return trimmed.to_string(); }
    String::new()
}

fn parse_chat_message(value: &Value) -> Option<String> {
    if let Some(text) = value.as_str().map(str::trim).filter(|text| !text.is_empty()).map(str::to_string) {
        return Some(text);
    }
    value.get("message").and_then(Value::as_str)
        .or_else(|| value.get("reply").and_then(Value::as_str))
        .map(str::trim).filter(|text| !text.is_empty()).map(str::to_string)
}

pub(crate) type ParsedAskVeloxyChat = (
    String, Vec<String>, Vec<String>, Option<String>, bool, bool,
);

pub(crate) fn parse_ask_veloxy_chat_content(message_content: &str) -> ParsedAskVeloxyChat {
    match parse_ask_veloxy_chat_json(message_content) {
        Ok(value) => {
            let message = parse_chat_message(&value).unwrap_or_else(|| message_content.trim().to_string());
            let mut draft = value.get("sqlDraft").and_then(Value::as_str)
                .or_else(|| value.get("sql_draft").and_then(Value::as_str))
                .map(str::trim).filter(|text| !text.is_empty()).map(str::to_string);
            if draft.is_none() { draft = extract_sql_draft_from_text(&message); }
            let suggestions = value.get("suggestions").and_then(Value::as_array)
                .map(|items| items.iter().filter_map(Value::as_str).map(str::trim)
                    .filter(|text| !text.is_empty()).take(5).map(str::to_string).collect::<Vec<_>>())
                .unwrap_or_default();
            let warnings = value.get("warnings").and_then(Value::as_array)
                .map(|items| items.iter().filter_map(Value::as_str).map(str::to_string).collect::<Vec<_>>())
                .unwrap_or_default();
            let needs_sql_generation = parse_bool_field(&value, "needsSqlGeneration", draft.is_some());
            let needs_clarification = parse_bool_field(&value, "needsClarification", false);
            (message, suggestions, warnings, draft, needs_sql_generation, needs_clarification)
        }
        Err(_) => {
            let normalized_message = extract_message_from_loose_json(message_content).unwrap_or_else(|| {
                if looks_like_json_response(message_content) { String::new() }
                else { message_content.trim().to_string() }
            });
            let mut warnings = vec!["Model returned non-JSON chat output. Parsed in tolerant mode.".to_string()];
            if normalized_message.is_empty() && looks_like_json_response(message_content) {
                warnings.push("Response JSON could not be parsed. Try asking again.".to_string());
            }
            let draft = extract_sql_draft_from_text(&normalized_message);
            let needs_sql_generation = draft.is_some();
            (normalized_message, Vec::new(), warnings, draft, needs_sql_generation, false)
        }
    }
}

pub(crate) fn extract_openrouter_stream_delta(data: &str) -> Option<String> {
    let payload: Value = serde_json::from_str(data).ok()?;
    payload.get("choices").and_then(|choices| choices.get(0))
        .and_then(|choice| choice.get("delta"))
        .and_then(|delta| delta.get("content"))
        .and_then(Value::as_str).filter(|text| !text.is_empty()).map(str::to_string)
}

pub(crate) fn extract_openrouter_finish_reason(data: &str) -> Option<String> {
    let payload: Value = serde_json::from_str(data).ok()?;
    payload.get("choices").and_then(|choices| choices.get(0))
        .and_then(|choice| choice.get("finish_reason"))
        .and_then(Value::as_str).map(str::to_string)
}

pub(crate) fn emit_veloxy_stream_chunk(app: &AppHandle, chunk: VeloxyStreamChunk) {
    let _ = app.emit("veloxy-stream-chunk", chunk);
}

pub(crate) async fn stream_openrouter_chat_completion(
    app: &AppHandle,
    client: &reqwest::Client,
    endpoint: &str,
    api_key: &str,
    model: &str,
    system_prompt: &str,
    user_prompt: &str,
    request_id: &str,
    cancel: Arc<AtomicBool>,
) -> Result<(String, bool), String> {
    let response = client
        .post(endpoint)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "model": model,
            "temperature": 0.2,
            "max_tokens": ASK_VELOXY_MAX_CHAT_TOKENS,
            "stream": true,
            "messages": [
                { "role": "system", "content": system_prompt },
                { "role": "user", "content": user_prompt }
            ]
        }))
        .send()
        .await
        .map_err(|error| format!("OpenRouter request failed: {}", error))?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_else(|_| "Unknown OpenRouter error".to_string());
        if let Ok(payload) = serde_json::from_str::<Value>(&body) {
            let message = payload.get("error").and_then(|error| error.get("message"))
                .and_then(Value::as_str).unwrap_or("Unknown OpenRouter error");
            return Err(format!("OpenRouter error ({}): {}", status.as_u16(), message));
        }
        return Err(format!("OpenRouter error ({}): {}", status.as_u16(), body));
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut accumulated = String::new();
    let mut last_display_len = 0usize;
    let mut hit_token_limit = false;

    while let Some(chunk) = stream.next().await {
        if cancel.load(Ordering::Relaxed) {
            return Ok((accumulated, hit_token_limit));
        }
        let bytes = chunk.map_err(|error| format!("OpenRouter stream read failed: {}", error))?;
        buffer.push_str(&String::from_utf8_lossy(&bytes));

        while let Some(line_end) = buffer.find('\n') {
            let line = buffer[..line_end].trim_end_matches('\r').to_string();
            buffer.drain(..=line_end);

            if !line.starts_with("data: ") { continue; }
            let data = line["data: ".len()..].trim();
            if data == "[DONE]" { continue; }
            if extract_openrouter_finish_reason(data).as_deref() == Some("length") {
                hit_token_limit = true;
            }
            if let Some(delta) = extract_openrouter_stream_delta(data) {
                accumulated.push_str(&delta);
                let display = streaming_display_text(&accumulated);
                let display_delta = if display.len() > last_display_len {
                    display[last_display_len..].to_string()
                } else {
                    String::new()
                };
                last_display_len = display.len();
                if !display_delta.is_empty() {
                    emit_veloxy_stream_chunk(app, VeloxyStreamChunk {
                        request_id: request_id.to_string(),
                        delta: display_delta,
                        done: false,
                        message: None,
                        suggestions: Vec::new(),
                        warnings: Vec::new(),
                        sql_draft: None,
                        needs_sql_generation: false,
                        needs_clarification: false,
                    });
                }
            }
        }
    }

    Ok((accumulated, hit_token_limit))
}

pub(crate) fn veloxdb_unique_constraint_name(table_name: &str, column_name: &str) -> String {
    let suffix = "_uniq";
    let max_base_len = 63usize.saturating_sub(suffix.len());
    let mut base = format!("veloxdb_{}_{}", table_name, column_name);
    base.truncate(max_base_len);
    format!("{}{}", base, suffix)
}

// --- Sub-modules ---

mod connections;
mod query;
mod table_props;
mod ddl;
mod editor_meta;
mod veloxy;
mod lint;
pub(crate) mod mongo;
pub(crate) mod duckdb;
mod export_cmds;
pub(crate) mod redis;

// --- Re-exports ---

pub use connections::{
    connect_db, list_connections_command, set_active_connection, ping_connection,
    refresh_connection, disconnect_db, rename_connection, delete_connection,
    list_databases, switch_database,
};
pub use query::{
    run_query, get_tables, get_schema,
};
pub use table_props::{
    get_table_properties, apply_table_properties, get_foreign_keys, get_table_indexes,
};
pub use ddl::{
    execute_ddl_transaction, execute_ddl_statement,
};
pub use editor_meta::{
    get_query_editor_metadata,
};
pub use veloxy::{
    cancel_veloxy_request, chat_with_db, clear_veloxy_conversation, generate_sql_from_nl,
    load_veloxy_conversation,
};
pub use lint::{
    lint_sql,
};
pub use export_cmds::{
    export_diagram_png, export_results_csv_command, export_results_json_command,
    save_base64_png, save_text_file, store_openrouter_api_key, get_openrouter_api_key,
    delete_openrouter_api_key,
};
pub use mongo::{
    mongo_run_query, mongo_get_collections, mongo_get_schema,
};
pub use duckdb::{
    duckdb_run_query, duckdb_get_tables, duckdb_get_schema,
};
pub use redis::{
    redis_run_query, redis_get_keys, redis_get_schema,
};
