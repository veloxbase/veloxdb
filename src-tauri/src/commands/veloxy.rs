use std::ops::ControlFlow;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use sqlparser::ast::{
    Expr, ObjectName, ObjectNamePart, Query, SetExpr, Statement, TableFactor, Visit, Visitor,
};

use serde_json::Value;
use tauri::{AppHandle, State};

use crate::db::{
    load_connection, resolve_connection_engine, AppState, MAX_QUERY_ROWS,
};
use crate::engines;
use crate::models::{
    AskVeloxyChatRequest, AskVeloxyChatResponse, AskVeloxyConversationMessage,
    AskVeloxyConversationResponse, AskVeloxyRequest, AskVeloxyResponse,
    AskVeloxyTokenStats, QueryRequest, VeloxyStreamChunk,
};

use super::{
    ask_veloxy_context_cache_key, ask_veloxy_conversation_key,
    build_schema_context, classify_sql_intent, emit_veloxy_stream_chunk,
    estimate_tokens, extract_openrouter_message_content, now_epoch_seconds,
    normalize_openrouter_base, parse_ask_veloxy_chat_content,
    parse_ask_veloxy_json, parse_ask_veloxy_suggestions,
    stream_openrouter_chat_completion, truncate_on_char_boundary, validate_generated_sql,
    ASK_VELOXY_MAX_HISTORY_MESSAGES, ASK_VELOXY_PROMPT_CHAR_BUDGET,
};
use crate::models::DatabaseEngine;
use super::editor_meta::{
    fetch_foreign_keys_for_connection, fetch_query_editor_metadata_for_connection,
};
use crate::models::AskVeloxyDbContextCache;

pub(crate) async fn get_or_build_ask_veloxy_db_context(
    app: &AppHandle,
    state: &AppState,
    connection_id: &str,
    engine: DatabaseEngine,
) -> Result<AskVeloxyDbContextCache, String> {
    let stored_connection = load_connection(app, connection_id)?
        .ok_or_else(|| "Stored connection details were not found.".to_string())?;
    let cache_key = ask_veloxy_context_cache_key(connection_id, &stored_connection.database);
    if let Some(cached) = state.ask_veloxy_db_context_cache.read().await.get(&cache_key).cloned() {
        return Ok(cached);
    }

    let metadata = fetch_query_editor_metadata_for_connection(app, state, connection_id, engine).await?;
    let foreign_keys = fetch_foreign_keys_for_connection(app, state, connection_id, engine).await?;
    let cache = AskVeloxyDbContextCache {
        database_name: stored_connection.database,
        engine, metadata, foreign_keys,
    };
    state.ask_veloxy_db_context_cache.write().await.insert(cache_key, cache.clone());
    Ok(cache)
}

#[tauri::command]
pub async fn cancel_veloxy_request(state: State<'_, AppState>) -> Result<(), String> {
    if let Some(cancel) = state.veloxy_cancel.read().await.as_ref() {
        cancel.store(true, Ordering::Relaxed);
    }
    Ok(())
}

#[tauri::command]
pub async fn chat_with_db(
    app: AppHandle,
    state: State<'_, AppState>,
    input: AskVeloxyChatRequest,
) -> Result<AskVeloxyChatResponse, String> {
    let natural_prompt = input.natural_prompt.trim();
    if natural_prompt.is_empty() {
        return Err("Ask Veloxy prompt cannot be empty.".to_string());
    }
    if input.provider_config.api_key.trim().is_empty() {
        return Err("OpenRouter API key is required.".to_string());
    }
    if input.provider_config.model.trim().is_empty() {
        return Err("OpenRouter model is required.".to_string());
    }

    let (connection_id, engine) = resolve_connection_engine(&app, &state, input.connection_id.clone()).await?;
    let stored_connection = load_connection(&app, &connection_id)?
        .ok_or_else(|| "Stored connection details were not found.".to_string())?;
    let db_context = get_or_build_ask_veloxy_db_context(&app, &state, &connection_id, engine).await?;
    let schema_context = build_schema_context(&db_context, natural_prompt, input.target_table.as_ref());
    let conversation_key = ask_veloxy_conversation_key(&connection_id, &stored_connection.database);
    let history = state.ask_veloxy_conversations.read().await.get(&conversation_key).cloned().unwrap_or_default();

    let history_block = history.iter().rev().take(8).rev()
        .map(|message| format!("{}: {}", message.role, message.text))
        .collect::<Vec<_>>().join("\n");

    let mut user_prompt = format!(
        "Engine: {:?}\nDatabase: {}\nTask: {}\nMaxRows: {}\nRecentConversation:\n{}\nSchemaContext:\n{}\n",
        db_context.engine, db_context.database_name, natural_prompt,
        input.max_rows.unwrap_or(MAX_QUERY_ROWS), history_block, schema_context
    );
    truncate_on_char_boundary(&mut user_prompt, ASK_VELOXY_PROMPT_CHAR_BUDGET);

    let system_prompt = "You are Ask Veloxy chat mode. Return JSON when possible with keys: message (string), suggestions (array of strings), sqlDraft (string optional), needsSqlGeneration (boolean), needsClarification (boolean), warnings (array of strings). If JSON is not possible, return helpful plain text.";
    let base_url = normalize_openrouter_base(input.provider_config.base_url.as_deref());
    let endpoint = format!("{}/chat/completions", base_url);
    let client = state.openrouter_client.get_or_init(reqwest::Client::new);
    let request_id = input.request_id.clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| format!("req-{}", uuid::Uuid::new_v4()));

    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut guard = state.veloxy_cancel.write().await;
        *guard = Some(cancel.clone());
    }

    let (message_content, hit_token_limit) = stream_openrouter_chat_completion(
        &app, client, &endpoint,
        input.provider_config.api_key.trim(),
        input.provider_config.model.trim(),
        system_prompt, &user_prompt, &request_id, cancel.clone(),
    ).await?;

    {
        let mut guard = state.veloxy_cancel.write().await;
        *guard = None;
    }

    let (message, suggestions, mut warnings, sql_draft, needs_sql_generation, needs_clarification) =
        parse_ask_veloxy_chat_content(&message_content);

    if cancel.load(Ordering::Relaxed) { warnings.push("Stopped early.".to_string()); }
    if hit_token_limit {
        warnings.push(format!(
            "Response may be truncated (model output limit of {} tokens).",
            super::ASK_VELOXY_MAX_CHAT_TOKENS
        ));
    }

    emit_veloxy_stream_chunk(&app, VeloxyStreamChunk {
        request_id: request_id.clone(),
        delta: String::new(),
        done: true,
        message: Some(message.clone()),
        suggestions: suggestions.clone(),
        warnings: warnings.clone(),
        sql_draft: sql_draft.clone(),
        needs_sql_generation,
        needs_clarification,
    });

    {
        let mut conversations = state.ask_veloxy_conversations.write().await;
        let bucket = conversations.entry(conversation_key).or_default();
        bucket.push(AskVeloxyConversationMessage {
            id: format!("msg-{}", uuid::Uuid::new_v4()),
            role: "user".to_string(), mode: "chat".to_string(),
            text: natural_prompt.to_string(), created_at: now_epoch_seconds(),
            sql_draft: None,
        });
        bucket.push(AskVeloxyConversationMessage {
            id: format!("msg-{}", uuid::Uuid::new_v4()),
            role: "assistant".to_string(), mode: "chat".to_string(),
            text: message.clone(), created_at: now_epoch_seconds(),
            sql_draft: sql_draft.clone(),
        });
        if bucket.len() > ASK_VELOXY_MAX_HISTORY_MESSAGES {
            let remove_count = bucket.len() - ASK_VELOXY_MAX_HISTORY_MESSAGES;
            bucket.drain(0..remove_count);
        }
    }

    Ok(AskVeloxyChatResponse {
        message, suggestions, warnings, sql_draft, needs_sql_generation, needs_clarification,
    })
}

#[tauri::command]
pub async fn load_veloxy_conversation(
    app: AppHandle,
    state: State<'_, AppState>,
    connection_id: Option<String>,
) -> Result<AskVeloxyConversationResponse, String> {
    let (resolved_connection_id, _) = resolve_connection_engine(&app, &state, connection_id).await?;
    let stored_connection = load_connection(&app, &resolved_connection_id)?
        .ok_or_else(|| "Stored connection details were not found.".to_string())?;
    let key = ask_veloxy_conversation_key(&resolved_connection_id, &stored_connection.database);
    let messages = state.ask_veloxy_conversations.read().await.get(&key).cloned().unwrap_or_default();
    Ok(AskVeloxyConversationResponse { messages })
}

#[tauri::command]
pub async fn clear_veloxy_conversation(
    app: AppHandle,
    state: State<'_, AppState>,
    connection_id: Option<String>,
) -> Result<(), String> {
    let (resolved_connection_id, _) = resolve_connection_engine(&app, &state, connection_id).await?;
    let stored_connection = load_connection(&app, &resolved_connection_id)?
        .ok_or_else(|| "Stored connection details were not found.".to_string())?;
    let key = ask_veloxy_conversation_key(&resolved_connection_id, &stored_connection.database);
    state.ask_veloxy_conversations.write().await.remove(&key);
    Ok(())
}

#[tauri::command]
pub async fn generate_sql_from_nl(
    app: AppHandle,
    state: State<'_, AppState>,
    input: AskVeloxyRequest,
) -> Result<AskVeloxyResponse, String> {
    let natural_prompt = input.natural_prompt.trim();
    if natural_prompt.is_empty() {
        return Err("Ask Veloxy prompt cannot be empty.".to_string());
    }
    if input.provider_config.api_key.trim().is_empty() {
        return Err("OpenRouter API key is required.".to_string());
    }
    if input.provider_config.model.trim().is_empty() {
        return Err("OpenRouter model is required.".to_string());
    }

    let (connection_id, engine) = resolve_connection_engine(&app, &state, input.connection_id.clone()).await?;
    let db_context = get_or_build_ask_veloxy_db_context(&app, &state, &connection_id, engine).await?;
    let schema_context = build_schema_context(&db_context, natural_prompt, input.target_table.as_ref());

    let mut user_prompt = format!(
        "Engine: {:?}\nDatabase: {}\nTask: {}\nMaxRows: {}\nSchemaContext:\n{}\n",
        db_context.engine, db_context.database_name, natural_prompt,
        input.max_rows.unwrap_or(MAX_QUERY_ROWS), schema_context
    );
    truncate_on_char_boundary(&mut user_prompt, ASK_VELOXY_PROMPT_CHAR_BUDGET);

    let system_prompt = "You are Ask Veloxy. Return JSON only with keys: sql (string), intent (string), confidence (number 0..1), explanation (string), suggestions (array of short strings), warnings (array of strings). Generate exactly one SQL statement, keep explanation concise, and never include markdown.";
    let base_url = normalize_openrouter_base(input.provider_config.base_url.as_deref());
    let endpoint = format!("{}/chat/completions", base_url);

    let client = state.openrouter_client.get_or_init(reqwest::Client::new);
    let response = client.post(&endpoint)
        .header("Authorization", format!("Bearer {}", input.provider_config.api_key.trim()))
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "model": input.provider_config.model.trim(),
            "temperature": 0.1,
            "max_tokens": 500,
            "messages": [
                { "role": "system", "content": system_prompt },
                { "role": "user", "content": user_prompt }
            ]
        }))
        .send().await.map_err(|error| format!("OpenRouter request failed: {}", error))?;

    let status = response.status();
    let payload = response.json::<Value>().await
        .map_err(|error| format!("Invalid OpenRouter JSON response: {}", error))?;
    if !status.is_success() {
        let message = payload.get("error").and_then(|error| error.get("message"))
            .and_then(Value::as_str).unwrap_or("Unknown OpenRouter error");
        return Err(format!("OpenRouter error ({}): {}", status.as_u16(), message));
    }

    let message_content = extract_openrouter_message_content(&payload)?;
    let generated = parse_ask_veloxy_json(&message_content)?;
    let sql = generated.get("sql").and_then(Value::as_str).unwrap_or_default().trim().to_string();
    validate_generated_sql(&sql)?;

    let mut warnings = generated.get("warnings").and_then(Value::as_array)
        .map(|items| items.iter().filter_map(Value::as_str).map(str::to_string).collect::<Vec<_>>())
        .unwrap_or_default();

    // Derive the intent from the SQL itself. The model's own `intent` field is
    // untrusted: the frontend auto-runs read intents, so a write labelled
    // "select" would otherwise run without confirmation.
    let intent = classify_sql_intent(&sql);
    let confidence = generated.get("confidence").and_then(Value::as_f64).unwrap_or(0.6).clamp(0.0, 1.0);
    let explanation = generated.get("explanation").and_then(Value::as_str).map(str::trim)
        .filter(|value| !value.is_empty()).map(|value| {
            let mut truncated = value.to_string();
            truncate_on_char_boundary(&mut truncated, 350);
            truncated
        });
    let suggestions = parse_ask_veloxy_suggestions(&generated);

    if intent != "select" {
        warnings.push("Generated SQL is not read-only. Review before execution.".to_string());
    }
    if confidence < 0.5 {
        warnings.push("Low confidence result. Review SQL carefully.".to_string());
    }

    let token_stats = AskVeloxyTokenStats {
        schema_chars: schema_context.len(),
        schema_tokens_estimate: estimate_tokens(schema_context.len()),
        prompt_chars: user_prompt.len() + system_prompt.len(),
        prompt_tokens_estimate: estimate_tokens(user_prompt.len() + system_prompt.len()),
    };

    Ok(AskVeloxyResponse {
        sql, intent, confidence, explanation, suggestions, warnings, token_stats,
    })
}

pub(crate) const VELOXY_MAX_READONLY_ROWS: usize = 50;
/// Higher cap for chart-backing queries so charts bind to (near-)complete
/// aggregates instead of a 50-row sample.
pub(crate) const VELOXY_MAX_CHART_ROWS: usize = 500;
/// Bound agent SELECTs. DeepSeek often emits `information_schema` FK dumps
/// (`SELECT tc.table_schema…`) that Postgres can run for many minutes; the
/// 50-row cap is applied only after `simple_query` finishes, so it does not
/// protect the pool client.
pub(crate) const VELOXY_READONLY_TIMEOUT_MS: u64 = 15_000;

pub(crate) fn map_veloxy_query_error(error: impl std::fmt::Display, timeout_ms: u64) -> String {
    let message = error.to_string();
    let lower = message.to_lowercase();
    if lower.contains("statement timeout") || lower.contains("canceling statement") {
        format!(
            "Query timed out after {}s. For foreign keys and schema, use search_schema instead of querying information_schema.",
            timeout_ms / 1000
        )
    } else {
        message
    }
}

pub(crate) fn veloxy_sql_dialect(engine: DatabaseEngine) -> Result<Box<dyn sqlparser::dialect::Dialect>, String> {
    match engine {
        DatabaseEngine::Postgres | DatabaseEngine::Duckdb => {
            Ok(Box::new(sqlparser::dialect::PostgreSqlDialect {}))
        }
        DatabaseEngine::Mysql => Ok(Box::new(sqlparser::dialect::MySqlDialect {})),
        DatabaseEngine::Sqlite | DatabaseEngine::Libsql | DatabaseEngine::Turso => {
            Ok(Box::new(sqlparser::dialect::SQLiteDialect {}))
        }
        DatabaseEngine::Clickhouse => Ok(Box::new(sqlparser::dialect::ClickHouseDialect {})),
        DatabaseEngine::Mssql | DatabaseEngine::Azuresql => {
            Ok(Box::new(sqlparser::dialect::MsSqlDialect {}))
        }
        DatabaseEngine::Mongo
        | DatabaseEngine::Redis
        | DatabaseEngine::Cassandra
        | DatabaseEngine::Scylladb => {
            Err("Veloxy read-only queries require a SQL database (Postgres, MySQL, SQLite, DuckDB, ClickHouse, LibSQL, or MSSQL).".to_string())
        }
    }
}

/// Functions that change data or server state, touch files on the server, or
/// run SQL text the parser cannot see, even when called from a SELECT. The
/// database-level read-only transaction (see `engines::readonly`) refuses table
/// writes, but not these: killing other sessions, session advisory locks,
/// large-object and file I/O, dblink to another database, reloading config,
/// or `query_to_xml('DELETE ...')`. Matched on the unqualified, lowercased
/// name, so `pg_catalog.set_config` is caught too. A user-defined function
/// with the same name is rejected as well, which only costs a refusal.
const SIDE_EFFECT_FUNCTIONS: &[&str] = &[
    // PostgreSQL: sequences and settings
    "nextval", "setval", "set_config",
    // PostgreSQL: other sessions, server control, notifications
    "pg_terminate_backend", "pg_cancel_backend", "pg_reload_conf", "pg_rotate_logfile",
    "pg_switch_wal", "pg_promote", "pg_create_restore_point", "pg_wal_replay_pause",
    "pg_wal_replay_resume", "pg_backup_start", "pg_backup_stop", "pg_start_backup",
    "pg_stop_backup", "pg_notify", "pg_logical_emit_message", "pg_import_system_collations",
    "pg_create_physical_replication_slot", "pg_create_logical_replication_slot",
    "pg_drop_replication_slot", "pg_copy_physical_replication_slot",
    "pg_copy_logical_replication_slot", "pg_replication_slot_advance",
    "pg_logical_slot_get_changes", "pg_logical_slot_get_binary_changes",
    "pg_stat_reset", "pg_stat_reset_shared", "pg_stat_reset_single_table_counters",
    "pg_stat_reset_single_function_counters", "pg_stat_reset_slru",
    "pg_stat_reset_replication_slot", "pg_stat_statements_reset",
    // PostgreSQL: session-level advisory locks outlive the rolled-back transaction
    "pg_advisory_lock", "pg_advisory_lock_shared", "pg_try_advisory_lock",
    "pg_try_advisory_lock_shared", "pg_advisory_unlock", "pg_advisory_unlock_shared",
    "pg_advisory_unlock_all",
    // PostgreSQL: server files and large objects
    "pg_read_file", "pg_read_binary_file", "pg_ls_dir", "pg_stat_file", "pg_ls_logdir",
    "pg_ls_waldir", "pg_ls_tmpdir", "pg_ls_archive_statusdir", "pg_ls_logicalsnapdir",
    "pg_ls_logicalmapdir", "pg_ls_replslotdir", "pg_file_write", "pg_file_rename",
    "pg_file_unlink", "pg_file_sync", "pg_logdir_ls",
    "lo_import", "lo_export", "lo_unlink", "lo_create", "lo_creat", "lo_from_bytea", "lo_put",
    "lowrite", "lo_truncate", "lo_truncate64",
    // PostgreSQL: run a SQL string the parser never sees
    "query_to_xml", "query_to_xml_and_xmlschema", "query_to_xmlschema", "cursor_to_xml",
    "cursor_to_xmlschema", "ts_stat",
    // MySQL / MariaDB
    "load_file", "get_lock", "release_lock", "release_all_locks", "sys_exec", "sys_eval",
    "master_pos_wait", "source_pos_wait",
    // SQLite
    "load_extension", "readfile", "writefile", "edit", "fts3_tokenizer",
    // SQL Server
    "openrowset", "openquery", "opendatasource",
];

/// Name of a side-effect function, if `name` is one. Every `dblink*`
/// function counts: they connect to, and can write to, another database.
fn side_effect_function(name: &ObjectName) -> Option<String> {
    let last = match name.0.last()? {
        ObjectNamePart::Identifier(ident) => ident.value.to_ascii_lowercase(),
        ObjectNamePart::Function(function) => function.name.value.to_ascii_lowercase(),
    };
    (SIDE_EFFECT_FUNCTIONS.contains(&last.as_str()) || last.starts_with("dblink")).then_some(last)
}

fn side_effect_error(function: &str) -> String {
    format!(
        "{}() can change data or server state, so it is not allowed in read-only queries.",
        function
    )
}

/// Rejects anything in a parsed statement that can write or take locks. The
/// visitor reaches every nested statement and query, including CTE bodies,
/// subqueries, set operations and the target of EXPLAIN.
struct ReadOnlyGuard;

impl Visitor for ReadOnlyGuard {
    type Break = String;

    fn pre_visit_statement(&mut self, statement: &Statement) -> ControlFlow<Self::Break> {
        match statement {
            Statement::Query(_) | Statement::Explain { .. } => ControlFlow::Continue(()),
            other => ControlFlow::Break(format!(
                "Only read-only SELECT or EXPLAIN statements are allowed. Found {}.",
                statement_label(other)
            )),
        }
    }

    fn pre_visit_expr(&mut self, expr: &Expr) -> ControlFlow<Self::Break> {
        if let Expr::Function(function) = expr {
            if let Some(name) = side_effect_function(&function.name) {
                return ControlFlow::Break(side_effect_error(&name));
            }
        }
        ControlFlow::Continue(())
    }

    /// Table functions in FROM, e.g. `SELECT * FROM dblink(...)`.
    fn pre_visit_table_factor(&mut self, factor: &TableFactor) -> ControlFlow<Self::Break> {
        let name = match factor {
            TableFactor::Table { name, args: Some(_), .. } => Some(name),
            TableFactor::Function { name, .. } => Some(name),
            _ => None,
        };
        if let Some(function) = name.and_then(side_effect_function) {
            return ControlFlow::Break(side_effect_error(&function));
        }
        ControlFlow::Continue(())
    }

    fn pre_visit_query(&mut self, query: &Query) -> ControlFlow<Self::Break> {
        if !query.locks.is_empty() {
            return ControlFlow::Break(
                "Row-locking clauses (FOR UPDATE / FOR SHARE) are not allowed in read-only queries.".to_string(),
            );
        }
        if set_expr_has_select_into(&query.body) {
            return ControlFlow::Break(
                "SELECT ... INTO creates a table and is not allowed in read-only queries.".to_string(),
            );
        }
        ControlFlow::Continue(())
    }
}

fn set_expr_has_select_into(expr: &SetExpr) -> bool {
    match expr {
        SetExpr::Select(select) => select.into.is_some(),
        SetExpr::SetOperation { left, right, .. } => {
            set_expr_has_select_into(left) || set_expr_has_select_into(right)
        }
        // Nested queries are checked by `pre_visit_query` when the visitor
        // reaches them.
        _ => false,
    }
}

/// Short label for error messages, e.g. "DELETE", so the whole statement is
/// not echoed back to the model.
fn statement_label(statement: &Statement) -> String {
    statement
        .to_string()
        .split_whitespace()
        .next()
        .unwrap_or("statement")
        .to_ascii_uppercase()
}

/// Rejects agent SQL that is not a single read-only SELECT or EXPLAIN, and
/// says which of the two it is: the read-only runners execute them
/// differently. Callers then run it with `engines::run_agent_readonly`, which
/// makes the database itself refuse writes where the engine allows it.
pub(crate) fn check_agent_readonly_sql(
    sql: &str,
    engine: DatabaseEngine,
) -> Result<engines::AgentStatement, String> {
    let trimmed = sql.trim();
    if trimmed.is_empty() {
        return Err("Ask Veloxy returned an empty SQL statement.".to_string());
    }
    let dialect = veloxy_sql_dialect(engine)?;
    let statements = sqlparser::parser::Parser::parse_sql(dialect.as_ref(), trimmed)
        .map_err(|error| format!("Could not parse SQL: {}", error))?;
    if statements.is_empty() {
        return Err("Ask Veloxy returned an empty SQL statement.".to_string());
    }
    if statements.len() > 1 {
        return Err("Ask Veloxy generated multiple SQL statements. Please ask for a single statement.".to_string());
    }
    // Walk the whole AST, not just the top-level statement. A top-level
    // SELECT or EXPLAIN can still wrap a write: `EXPLAIN ANALYZE DELETE ...`
    // executes the DELETE, and Postgres runs data-modifying CTEs such as
    // `WITH d AS (DELETE ... RETURNING *) SELECT * FROM d`.
    if let ControlFlow::Break(reason) = statements[0].visit(&mut ReadOnlyGuard) {
        return Err(reason);
    }
    if !super::is_read_only_sql(trimmed) {
        return Err("This statement is not read-only. Veloxy will not execute writes.".to_string());
    }
    Ok(match statements[0] {
        Statement::Explain { .. } => engines::AgentStatement::Explain,
        _ => engines::AgentStatement::Query,
    })
}

#[tauri::command]
pub async fn veloxy_run_readonly(
    app: AppHandle,
    state: State<'_, AppState>,
    input: QueryRequest,
) -> Result<crate::models::QueryResult, String> {
    let (connection_id, engine) = resolve_connection_engine(&app, &state, input.connection_id.clone()).await?;
    let sql = input.sql.trim().to_string();
    let kind = check_agent_readonly_sql(&sql, engine)?;
    let max_query_rows = input
        .max_rows
        .unwrap_or(VELOXY_MAX_READONLY_ROWS)
        .min(VELOXY_MAX_CHART_ROWS);
    engines::run_agent_readonly(
        &app,
        &state,
        &connection_id,
        engine,
        &sql,
        kind,
        max_query_rows,
        VELOXY_READONLY_TIMEOUT_MS,
    )
    .await
    .map_err(|error| map_veloxy_query_error(error, VELOXY_READONLY_TIMEOUT_MS))
}

#[cfg(test)]
mod tests {
    use super::super::{
        build_schema_context, classify_sql_intent, database_name_from_mysql_value,
        decode_mysql_bytes_as_string, extract_openrouter_stream_delta, mysql_decode_error,
        parse_ask_veloxy_json, sqlite_decode_error, streaming_display_text,
        validate_generated_sql, is_read_only_sql,
    };
    use crate::models::{
        AskVeloxyDbContextCache, DatabaseEngine, QueryEditorColumn, QueryEditorMetadata,
        QueryEditorTable,
    };

    #[test]
    fn streaming_display_text_extracts_partial_json_message() {
        let partial = r#"{ "message": "The messages table has relationships with:\n- delivery_reports"#;
        let display = streaming_display_text(partial);
        assert!(display.contains("messages table"));
        assert!(display.contains("delivery_reports"));
    }

    #[test]
    fn streaming_display_text_returns_plain_text_directly() {
        assert_eq!(streaming_display_text("Hello from Veloxy"), "Hello from Veloxy");
    }

    #[test]
    fn extract_openrouter_stream_delta_reads_content() {
        let data = r#"{"choices":[{"delta":{"content":"Hello"}}]}"#;
        assert_eq!(extract_openrouter_stream_delta(data).as_deref(), Some("Hello"));
    }

    #[test]
    fn database_name_from_mysql_value_rejects_empty() {
        assert!(database_name_from_mysql_value(None, "list_databases").is_err());
        assert!(database_name_from_mysql_value(Some(String::new()), "list_databases").is_err());
    }

    #[test]
    fn database_name_from_mysql_value_accepts_non_empty() {
        let name = database_name_from_mysql_value(Some("my_app".to_string()), "list_databases").expect("name");
        assert_eq!(name, "my_app");
    }

    #[test]
    fn decode_mysql_bytes_as_string_uses_utf8_text() {
        assert_eq!(decode_mysql_bytes_as_string(b"my_schema"), "my_schema");
    }

    #[test]
    fn mysql_decode_error_is_explicit() {
        let message = mysql_decode_error("get_tables", "table_schema", Some(0), "mismatched types");
        assert!(message.contains("MySQL decode error"));
        assert!(message.contains("get_tables"));
        assert!(message.contains("table_schema"));
    }

    #[test]
    fn sqlite_decode_error_is_explicit() {
        let message = sqlite_decode_error("get_schema", "name", Some(0), "unsupported value type");
        assert!(message.contains("SQLite decode error"));
        assert!(message.contains("get_schema"));
        assert!(message.contains("name"));
    }

    #[test]
    fn schema_context_is_bounded() {
        let columns = (0..40).map(|idx| QueryEditorColumn {
            name: format!("column_{}", idx), data_type: "text".to_string(),
            comment: None, is_nullable: None, is_primary_key: None,
        }).collect::<Vec<_>>();
        let tables = (0..20).map(|idx| QueryEditorTable {
            schema: "public".to_string(), name: format!("events_{}", idx), columns: columns.clone(),
            estimated_rows: None, comment: None,
        }).collect::<Vec<_>>();
        let metadata = QueryEditorMetadata {
            tables, functions: Vec::new(), enums: Vec::new(),
            truncated_tables: false, truncated_columns: false, truncated_functions: false,
        };
        let db_context = AskVeloxyDbContextCache {
            database_name: "test".to_string(), engine: DatabaseEngine::Postgres,
            metadata, foreign_keys: Vec::new(),
        };
        let context = build_schema_context(&db_context, "show events", None);
        assert!(!context.is_empty());
        assert!(context.len() <= super::super::ASK_VELOXY_SCHEMA_CHAR_BUDGET);
    }

    #[test]
    fn ask_veloxy_json_parser_handles_embedded_block() {
        let content = "Here is the output {\"sql\":\"select 1\",\"intent\":\"select\",\"confidence\":0.9,\"warnings\":[]}";
        let parsed = parse_ask_veloxy_json(content).expect("json should parse");
        assert_eq!(parsed.get("sql").and_then(|v| v.as_str()), Some("select 1"));
    }

    #[test]
    fn sql_validation_rejects_multi_statement() {
        assert!(validate_generated_sql("select 1; select 2;").is_err());
    }

    #[test]
    fn sql_intent_classifier_recognizes_update() {
        assert_eq!(classify_sql_intent("UPDATE foo SET bar = 1"), "update");
    }

    #[test]
    fn read_only_check_allows_selects_and_explain() {
        assert!(is_read_only_sql("SELECT 1"));
        assert!(is_read_only_sql("EXPLAIN ANALYZE SELECT * FROM t"));
        assert!(is_read_only_sql("WITH x AS (SELECT 1) SELECT * FROM x"));
        assert!(is_read_only_sql("BEGIN; SELECT 1; COMMIT;"));
    }

    #[test]
    fn read_only_check_blocks_writes() {
        assert!(!is_read_only_sql("DELETE FROM t"));
        assert!(!is_read_only_sql("DROP TABLE t"));
        assert!(!is_read_only_sql("BEGIN; UPDATE t SET a = 1; COMMIT;"));
        assert!(!is_read_only_sql("SELECT 1; DELETE FROM t"));
        assert!(!is_read_only_sql(""));
    }

    #[test]
    fn mysql_timestamp_formats_as_datetime_string() {
        let dt = chrono::DateTime::parse_from_rfc3339("2024-03-15T10:30:45Z").unwrap()
            .with_timezone(&chrono::Utc);
        assert_eq!(dt.format("%Y-%m-%d %H:%M:%S").to_string(), "2024-03-15 10:30:45");
    }

    #[test]
    fn mysql_datetime_formats_as_naive_datetime_string() {
        let dt = chrono::NaiveDateTime::parse_from_str("2024-03-15 10:30:45", "%Y-%m-%d %H:%M:%S").unwrap();
        assert_eq!(dt.format("%Y-%m-%d %H:%M:%S").to_string(), "2024-03-15 10:30:45");
    }

    #[test]
    fn mysql_date_formats_as_iso_date() {
        let d = chrono::NaiveDate::from_ymd_opt(2024, 3, 15).unwrap();
        assert_eq!(d.to_string(), "2024-03-15");
    }

    #[test]
    fn mysql_time_formats_as_iso_time() {
        let t = chrono::NaiveTime::from_hms_opt(10, 30, 45).unwrap();
        assert_eq!(t.to_string(), "10:30:45");
    }

    #[test]
    fn veloxy_readonly_allows_select() {
        super::check_agent_readonly_sql("SELECT 1", DatabaseEngine::Postgres).expect("select");
        super::check_agent_readonly_sql(
            "WITH x AS (SELECT 1) SELECT * FROM x",
            DatabaseEngine::Postgres,
        )
        .expect("cte");
    }

    #[test]
    fn veloxy_readonly_allows_explain() {
        super::check_agent_readonly_sql("EXPLAIN SELECT 1", DatabaseEngine::Postgres)
            .expect("explain");
    }

    #[test]
    fn veloxy_readonly_rejects_delete() {
        assert!(super::check_agent_readonly_sql("DELETE FROM t", DatabaseEngine::Postgres).is_err());
    }

    #[test]
    fn veloxy_readonly_rejects_multi_statement() {
        assert!(
            super::check_agent_readonly_sql("SELECT 1; DELETE FROM t", DatabaseEngine::Postgres)
                .is_err()
        );
    }

    #[test]
    fn veloxy_readonly_rejects_explain_wrapping_a_write() {
        // EXPLAIN ANALYZE executes its target on Postgres.
        for sql in [
            "EXPLAIN ANALYZE DELETE FROM t",
            "EXPLAIN (ANALYZE) UPDATE t SET a = 1",
            "EXPLAIN INSERT INTO t VALUES (1)",
        ] {
            assert!(
                super::check_agent_readonly_sql(sql, DatabaseEngine::Postgres).is_err(),
                "should reject: {sql}"
            );
        }
    }

    #[test]
    fn veloxy_readonly_allows_explain_analyze_select() {
        super::check_agent_readonly_sql("EXPLAIN ANALYZE SELECT * FROM t", DatabaseEngine::Postgres)
            .expect("explain analyze select");
    }

    #[test]
    fn veloxy_readonly_rejects_data_modifying_cte() {
        for sql in [
            "WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d",
            "WITH u AS (UPDATE t SET a = 1 RETURNING *) SELECT * FROM u",
            "WITH i AS (INSERT INTO t VALUES (1) RETURNING *) SELECT * FROM i",
            "WITH ok AS (SELECT 1), d AS (DELETE FROM t RETURNING *) SELECT * FROM ok",
        ] {
            assert!(
                super::check_agent_readonly_sql(sql, DatabaseEngine::Postgres).is_err(),
                "should reject: {sql}"
            );
        }
    }

    #[test]
    fn veloxy_readonly_rejects_select_into_and_locks() {
        for (sql, engine) in [
            ("SELECT * INTO new_t FROM t", DatabaseEngine::Postgres),
            ("SELECT 1 UNION SELECT * INTO new_t FROM t", DatabaseEngine::Postgres),
            ("SELECT * INTO #tmp FROM t", DatabaseEngine::Mssql),
            ("SELECT * FROM t FOR UPDATE", DatabaseEngine::Postgres),
            ("SELECT * FROM t FOR SHARE", DatabaseEngine::Postgres),
            ("SELECT * FROM (SELECT * FROM t FOR UPDATE) s", DatabaseEngine::Postgres),
            ("SELECT * FROM t FOR UPDATE", DatabaseEngine::Mysql),
        ] {
            assert!(
                super::check_agent_readonly_sql(sql, engine).is_err(),
                "should reject: {sql}"
            );
        }
    }

    #[test]
    fn veloxy_readonly_allows_common_read_shapes() {
        for sql in [
            "SELECT a, count(*) FROM t GROUP BY a ORDER BY 2 DESC LIMIT 10",
            "SELECT * FROM t WHERE id IN (SELECT id FROM u)",
            "SELECT 1 UNION ALL SELECT 2",
            "WITH RECURSIVE r AS (SELECT 1 AS n UNION ALL SELECT n + 1 FROM r WHERE n < 5) SELECT * FROM r",
        ] {
            super::check_agent_readonly_sql(sql, DatabaseEngine::Postgres)
                .unwrap_or_else(|error| panic!("should allow {sql}: {error}"));
        }
    }

    #[test]
    fn veloxy_readonly_rejects_side_effect_functions() {
        for (sql, engine) in [
            ("SELECT pg_terminate_backend(pid) FROM pg_stat_activity", DatabaseEngine::Postgres),
            ("SELECT pg_catalog.set_config('default_transaction_read_only', 'off', false)", DatabaseEngine::Postgres),
            ("SELECT nextval('orders_id_seq')", DatabaseEngine::Postgres),
            ("SELECT lo_export(lo_from_bytea(0, 'x'), '/tmp/x')", DatabaseEngine::Postgres),
            ("SELECT pg_advisory_lock(1)", DatabaseEngine::Postgres),
            ("SELECT query_to_xml('DELETE FROM t RETURNING *', true, false, '')", DatabaseEngine::Postgres),
            ("SELECT * FROM t WHERE id = (SELECT nextval('s'))", DatabaseEngine::Postgres),
            ("SELECT * FROM dblink('dbname=x', 'DELETE FROM t') AS r(a int)", DatabaseEngine::Postgres),
            ("SELECT * FROM pg_ls_dir('.')", DatabaseEngine::Postgres),
            ("SELECT dblink_exec('dbname=x', 'DELETE FROM t')", DatabaseEngine::Postgres),
            ("WITH x AS (SELECT pg_reload_conf()) SELECT * FROM x", DatabaseEngine::Postgres),
            ("EXPLAIN ANALYZE SELECT pg_cancel_backend(1)", DatabaseEngine::Postgres),
            ("SELECT LOAD_FILE('/etc/passwd')", DatabaseEngine::Mysql),
            ("SELECT GET_LOCK('x', 10)", DatabaseEngine::Mysql),
            ("SELECT load_extension('evil')", DatabaseEngine::Sqlite),
            ("SELECT writefile('/tmp/x', 'y')", DatabaseEngine::Sqlite),
        ] {
            let error = super::check_agent_readonly_sql(sql, engine)
                .expect_err(&format!("should reject: {sql}"));
            assert!(error.contains("not allowed"), "unexpected message for {sql}: {error}");
        }
    }

    #[test]
    fn veloxy_readonly_allows_ordinary_functions() {
        for sql in [
            "SELECT count(*), max(created_at), coalesce(name, 'n/a') FROM t GROUP BY name",
            "SELECT * FROM generate_series(1, 10) AS g(n)",
            "SELECT now(), current_setting('TimeZone'), pg_size_pretty(pg_database_size(current_database()))",
            "SELECT lower(name) FROM users WHERE name ILIKE '%nextval%'",
        ] {
            super::check_agent_readonly_sql(sql, DatabaseEngine::Postgres)
                .unwrap_or_else(|error| panic!("should allow {sql}: {error}"));
        }
    }

    #[test]
    fn agent_readonly_reports_statement_kind() {
        use crate::engines::AgentStatement;
        assert_eq!(
            super::check_agent_readonly_sql("SELECT 1", DatabaseEngine::Postgres),
            Ok(AgentStatement::Query)
        );
        assert_eq!(
            super::check_agent_readonly_sql("WITH x AS (SELECT 1) SELECT * FROM x", DatabaseEngine::Sqlite),
            Ok(AgentStatement::Query)
        );
        assert_eq!(
            super::check_agent_readonly_sql("EXPLAIN SELECT 1", DatabaseEngine::Mysql),
            Ok(AgentStatement::Explain)
        );
    }

    #[test]
    fn veloxy_readonly_rejects_non_sql_engines() {
        assert!(super::check_agent_readonly_sql("SELECT 1", DatabaseEngine::Mongo).is_err());
        assert!(super::check_agent_readonly_sql("SELECT 1", DatabaseEngine::Redis).is_err());
    }

    #[test]
    fn veloxy_query_error_rewrites_statement_timeout() {
        let message = super::map_veloxy_query_error(
            "ERROR: canceling statement due to statement timeout",
            15_000,
        );
        assert!(message.contains("timed out after 15s"));
        assert!(message.contains("search_schema"));
        assert!(!message.to_lowercase().contains("canceling statement"));
    }

    #[test]
    fn veloxy_query_error_passes_through_other_failures() {
        assert_eq!(
            super::map_veloxy_query_error("relation \"missing\" does not exist", 15_000),
            "relation \"missing\" does not exist"
        );
    }
}
