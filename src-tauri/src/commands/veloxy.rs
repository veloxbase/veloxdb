use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use serde_json::Value;
use tauri::{AppHandle, State};

use crate::db::{
    load_connection, resolve_connection_engine, AppState, MAX_QUERY_ROWS,
};
use crate::models::{
    AskVeloxyChatRequest, AskVeloxyChatResponse, AskVeloxyConversationMessage,
    AskVeloxyConversationResponse, AskVeloxyRequest, AskVeloxyResponse,
    AskVeloxyTokenStats, VeloxyStreamChunk,
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

async fn get_or_build_ask_veloxy_db_context(
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

    let intent = generated.get("intent").and_then(Value::as_str).map(str::to_string)
        .unwrap_or_else(|| classify_sql_intent(&sql));
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
        }).collect::<Vec<_>>();
        let tables = (0..20).map(|idx| QueryEditorTable {
            schema: "public".to_string(), name: format!("events_{}", idx), columns: columns.clone(),
        }).collect::<Vec<_>>();
        let metadata = QueryEditorMetadata {
            tables, functions: Vec::new(),
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
}
