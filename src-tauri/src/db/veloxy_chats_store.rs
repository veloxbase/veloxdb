use sqlx::{Row, SqlitePool};

use crate::error::VeloxError;
use crate::models::{now_epoch_millis, VeloxyThread, VeloxyThreadInput, VeloxyThreadSummary};

const MAX_TITLE_CHARS: usize = 80;

fn validate_input(input: &VeloxyThreadInput) -> Result<(), VeloxError> {
    if input.id.trim().is_empty() {
        return Err(VeloxError::Validation("Veloxy thread id is required.".to_string()));
    }
    if input.connection_id.trim().is_empty() {
        return Err(VeloxError::Validation(
            "Veloxy thread must reference a connection.".to_string(),
        ));
    }
    validate_state(&input.state)?;
    Ok(())
}

fn validate_state(state: &serde_json::Value) -> Result<(), VeloxError> {
    let messages = state
        .get("messages")
        .and_then(|value| value.as_array())
        .ok_or_else(|| VeloxError::Validation("Veloxy thread state must include messages.".to_string()))?;
    if messages.is_empty() {
        return Err(VeloxError::Validation(
            "Veloxy thread state must include at least one message.".to_string(),
        ));
    }
    Ok(())
}

pub(crate) fn title_from_state(state: &serde_json::Value) -> String {
    let Some(messages) = state.get("messages").and_then(|value| value.as_array()) else {
        return String::new();
    };
    for message in messages {
        let role = message.get("role").and_then(|value| value.as_str()).unwrap_or("");
        if !role.eq_ignore_ascii_case("user") {
            continue;
        }
        if let Some(parts) = message.get("parts").and_then(|value| value.as_array()) {
            for part in parts {
                let part_type = part.get("type").and_then(|value| value.as_str()).unwrap_or("");
                if part_type != "text" {
                    continue;
                }
                if let Some(content) = text_content(part.get("content")) {
                    return truncate_title(&content);
                }
            }
        }
        if let Some(content) = text_content(message.get("content")) {
            return truncate_title(&content);
        }
    }
    String::new()
}

fn text_content(value: Option<&serde_json::Value>) -> Option<String> {
    let value = value?;
    if let Some(text) = value.as_str() {
        let trimmed = text.trim();
        if trimmed.is_empty() {
            return None;
        }
        return Some(trimmed.to_string());
    }
    None
}

fn truncate_title(text: &str) -> String {
    let mut chars = text.chars();
    let truncated: String = chars.by_ref().take(MAX_TITLE_CHARS).collect();
    if chars.next().is_some() {
        format!("{truncated}…")
    } else {
        truncated
    }
}

fn resolve_title(existing_title: Option<&str>, input: &VeloxyThreadInput) -> String {
    if let Some(title) = existing_title.map(str::trim).filter(|value| !value.is_empty()) {
        return title.to_string();
    }
    if let Some(title) = input.title.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
        return truncate_title(title);
    }
    title_from_state(&input.state)
}

fn optional_database_name(value: Option<String>) -> Option<String> {
    value
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty())
}

fn summary_from_row(row: &sqlx::sqlite::SqliteRow) -> Result<VeloxyThreadSummary, VeloxError> {
    Ok(VeloxyThreadSummary {
        id: row.try_get("id")?,
        connection_id: row.try_get("connection_id")?,
        database_name: row.try_get("database_name")?,
        title: row.try_get("title")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
        opened_at: row.try_get("opened_at")?,
    })
}

fn thread_from_row(row: &sqlx::sqlite::SqliteRow) -> Result<VeloxyThread, VeloxError> {
    let summary = summary_from_row(row)?;
    let state_json: String = row.try_get("state")?;
    let state: serde_json::Value = serde_json::from_str(&state_json)?;
    Ok(VeloxyThread {
        id: summary.id,
        connection_id: summary.connection_id,
        database_name: summary.database_name,
        title: summary.title,
        created_at: summary.created_at,
        updated_at: summary.updated_at,
        opened_at: summary.opened_at,
        state,
    })
}

pub async fn list_veloxy_threads(
    pool: &SqlitePool,
    connection_id: &str,
) -> Result<Vec<VeloxyThreadSummary>, VeloxError> {
    let rows = sqlx::query(
        "SELECT id, connection_id, database_name, title, created_at, updated_at, opened_at
         FROM veloxy_threads
         WHERE connection_id = ?
         ORDER BY opened_at DESC, updated_at DESC, id DESC",
    )
    .bind(connection_id)
    .fetch_all(pool)
    .await?;

    rows.iter().map(summary_from_row).collect()
}

pub async fn load_veloxy_thread(pool: &SqlitePool, id: &str) -> Result<Option<VeloxyThread>, VeloxError> {
    let row = sqlx::query(
        "SELECT id, connection_id, database_name, title, created_at, updated_at, opened_at, state
         FROM veloxy_threads
         WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;

    row.as_ref().map(thread_from_row).transpose()
}

pub async fn save_veloxy_thread(
    pool: &SqlitePool,
    input: VeloxyThreadInput,
) -> Result<VeloxyThread, VeloxError> {
    validate_input(&input)?;

    let now = now_epoch_millis();
    let existing = load_veloxy_thread(pool, &input.id).await?;
    let title = resolve_title(existing.as_ref().map(|thread| thread.title.as_str()), &input);
    let created_at = existing.as_ref().map(|thread| thread.created_at).unwrap_or(now);
    let database_name = optional_database_name(input.database_name.clone());
    let state_json = serde_json::to_string(&input.state)?;

    sqlx::query(
        "INSERT INTO veloxy_threads
            (id, connection_id, database_name, title, created_at, updated_at, opened_at, state)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
            connection_id = excluded.connection_id,
            database_name = excluded.database_name,
            title = excluded.title,
            updated_at = excluded.updated_at,
            opened_at = excluded.opened_at,
            state = excluded.state",
    )
    .bind(&input.id)
    .bind(&input.connection_id)
    .bind(&database_name)
    .bind(&title)
    .bind(created_at)
    .bind(now)
    .bind(now)
    .bind(&state_json)
    .execute(pool)
    .await?;

    Ok(VeloxyThread {
        id: input.id,
        connection_id: input.connection_id,
        database_name,
        title,
        created_at,
        updated_at: now,
        opened_at: now,
        state: input.state,
    })
}

pub async fn touch_veloxy_thread(pool: &SqlitePool, id: &str) -> Result<(), VeloxError> {
    if id.trim().is_empty() {
        return Err(VeloxError::Validation("Veloxy thread id is required.".to_string()));
    }
    let now = now_epoch_millis();
    sqlx::query("UPDATE veloxy_threads SET opened_at = ? WHERE id = ?")
        .bind(now)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn delete_veloxy_thread(pool: &SqlitePool, id: &str) -> Result<(), VeloxError> {
    sqlx::query("DELETE FROM veloxy_threads WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn delete_veloxy_threads_for_connection(
    pool: &SqlitePool,
    connection_id: &str,
) -> Result<(), VeloxError> {
    sqlx::query("DELETE FROM veloxy_threads WHERE connection_id = ?")
        .bind(connection_id)
        .execute(pool)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        delete_veloxy_thread, delete_veloxy_threads_for_connection, list_veloxy_threads, load_veloxy_thread,
        save_veloxy_thread, title_from_state, touch_veloxy_thread,
    };
    use crate::db::open_memory_app_meta_db;
    use crate::models::VeloxyThreadInput;

    fn user_state(text: &str) -> serde_json::Value {
        serde_json::json!({
            "messages": [{
                "id": "m1",
                "role": "user",
                "parts": [{ "type": "text", "content": text }]
            }]
        })
    }

    fn valid_input() -> VeloxyThreadInput {
        VeloxyThreadInput {
            id: "thread-1".to_string(),
            connection_id: "conn-1".to_string(),
            database_name: Some("app".to_string()),
            title: None,
            state: user_state("Show top customers"),
        }
    }

    #[test]
    fn derives_title_from_first_user_text_part() {
        let title = title_from_state(&user_state("  List unpaid invoices  "));
        assert_eq!(title, "List unpaid invoices");
    }

    #[test]
    fn truncates_long_titles() {
        let long = "a".repeat(90);
        let title = title_from_state(&user_state(&long));
        assert_eq!(title.chars().count(), 81);
        assert!(title.ends_with('…'));
    }

    #[tokio::test]
    async fn save_list_load_delete_roundtrip() {
        let db = open_memory_app_meta_db().await.expect("memory db");
        let pool = db.pool();

        let saved = save_veloxy_thread(pool, valid_input()).await.expect("save");
        assert_eq!(saved.title, "Show top customers");
        assert_eq!(list_veloxy_threads(pool, "conn-1").await.expect("list").len(), 1);
        assert!(list_veloxy_threads(pool, "other").await.expect("empty").is_empty());

        let loaded = load_veloxy_thread(pool, &saved.id).await.expect("load").expect("exists");
        assert_eq!(loaded.state["messages"][0]["role"], "user");

        delete_veloxy_thread(pool, &saved.id).await.expect("delete");
        assert!(load_veloxy_thread(pool, &saved.id).await.expect("load after delete").is_none());
    }

    #[tokio::test]
    async fn keeps_title_on_later_saves() {
        let db = open_memory_app_meta_db().await.expect("memory db");
        let pool = db.pool();
        save_veloxy_thread(pool, valid_input()).await.expect("save");

        let updated = save_veloxy_thread(
            pool,
            VeloxyThreadInput {
                state: user_state("A later prompt that should not rename"),
                ..valid_input()
            },
        )
        .await
        .expect("update");
        assert_eq!(updated.title, "Show top customers");
    }

    #[tokio::test]
    async fn rejects_empty_messages() {
        let db = open_memory_app_meta_db().await.expect("memory db");
        let result = save_veloxy_thread(
            db.pool(),
            VeloxyThreadInput {
                state: serde_json::json!({ "messages": [] }),
                ..valid_input()
            },
        )
        .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn touch_moves_thread_to_front() {
        let db = open_memory_app_meta_db().await.expect("memory db");
        let pool = db.pool();
        save_veloxy_thread(pool, valid_input()).await.expect("save first");
        tokio::time::sleep(std::time::Duration::from_millis(2)).await;
        save_veloxy_thread(
            pool,
            VeloxyThreadInput {
                id: "thread-2".to_string(),
                state: user_state("Second chat"),
                ..valid_input()
            },
        )
        .await
        .expect("save second");

        let listed = list_veloxy_threads(pool, "conn-1").await.expect("list");
        assert_eq!(listed[0].id, "thread-2");

        tokio::time::sleep(std::time::Duration::from_millis(2)).await;
        touch_veloxy_thread(pool, "thread-1").await.expect("touch");
        let listed = list_veloxy_threads(pool, "conn-1").await.expect("list after touch");
        assert_eq!(listed[0].id, "thread-1");
    }

    #[tokio::test]
    async fn cascade_deletes_threads_for_connection() {
        let db = open_memory_app_meta_db().await.expect("memory db");
        let pool = db.pool();
        save_veloxy_thread(pool, valid_input()).await.expect("save");
        save_veloxy_thread(
            pool,
            VeloxyThreadInput {
                id: "thread-other".to_string(),
                connection_id: "conn-2".to_string(),
                state: user_state("Other connection"),
                ..valid_input()
            },
        )
        .await
        .expect("save other");

        delete_veloxy_threads_for_connection(pool, "conn-1")
            .await
            .expect("cascade");
        assert!(list_veloxy_threads(pool, "conn-1").await.expect("list conn-1").is_empty());
        assert_eq!(list_veloxy_threads(pool, "conn-2").await.expect("list conn-2").len(), 1);
    }
}
