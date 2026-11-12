use sqlx::{Row, Sqlite, SqlitePool, Transaction};
use uuid::Uuid;

use crate::error::VeloxError;
use crate::models::{now_epoch_millis, SavedQuery, SavedQueryInput};

pub(crate) fn saved_queries_from_entries(
    entries: impl IntoIterator<Item = (String, serde_json::Value)>,
) -> Vec<SavedQuery> {
    let mut items = Vec::new();
    for (key, value) in entries {
        match serde_json::from_value::<SavedQuery>(value) {
            Ok(mut item) => {
                if item.id.trim().is_empty() {
                    item.id = key.clone();
                }
                items.push(item);
            }
            Err(error) => {
                log::warn!("Skipping invalid saved query {key}: {error}");
            }
        }
    }
    items
}

fn validate_saved_query_input(input: &SavedQueryInput) -> Result<(), VeloxError> {
    if input.name.trim().is_empty() {
        return Err(VeloxError::Validation("Saved query name is required.".to_string()));
    }
    if input.sql.trim().is_empty() {
        return Err(VeloxError::Validation("Saved query SQL is required.".to_string()));
    }
    if input.connection_id.trim().is_empty() {
        return Err(VeloxError::Validation("Saved query must reference a connection.".to_string()));
    }
    Ok(())
}

fn saved_query_from_row(row: &sqlx::sqlite::SqliteRow) -> Result<SavedQuery, VeloxError> {
    Ok(SavedQuery {
        id: row.try_get("id")?,
        name: row.try_get("name")?,
        description: row.try_get("description")?,
        connection_id: row.try_get("connection_id")?,
        sql: row.try_get("sql")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

pub(crate) async fn insert_saved_query_row(
    tx: &mut Transaction<'_, Sqlite>,
    saved_query: &SavedQuery,
) -> Result<(), VeloxError> {
    sqlx::query(
        "INSERT OR REPLACE INTO saved_queries
         (id, name, description, connection_id, sql, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&saved_query.id)
    .bind(&saved_query.name)
    .bind(&saved_query.description)
    .bind(&saved_query.connection_id)
    .bind(&saved_query.sql)
    .bind(saved_query.created_at)
    .bind(saved_query.updated_at)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

pub async fn list_saved_queries(
    pool: &SqlitePool,
    connection_id: Option<&str>,
) -> Result<Vec<SavedQuery>, VeloxError> {
    let rows = if let Some(connection_id) = connection_id {
        sqlx::query(
            "SELECT id, name, description, connection_id, sql, created_at, updated_at
             FROM saved_queries
             WHERE connection_id = ?
             ORDER BY updated_at DESC",
        )
        .bind(connection_id)
        .fetch_all(pool)
        .await?
    } else {
        sqlx::query(
            "SELECT id, name, description, connection_id, sql, created_at, updated_at
             FROM saved_queries
             ORDER BY updated_at DESC",
        )
        .fetch_all(pool)
        .await?
    };

    rows.iter().map(saved_query_from_row).collect()
}

pub async fn get_saved_query(pool: &SqlitePool, id: &str) -> Result<Option<SavedQuery>, VeloxError> {
    let row = sqlx::query(
        "SELECT id, name, description, connection_id, sql, created_at, updated_at
         FROM saved_queries
         WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;

    row.as_ref().map(saved_query_from_row).transpose()
}

pub async fn save_saved_query(pool: &SqlitePool, input: SavedQueryInput) -> Result<SavedQuery, VeloxError> {
    validate_saved_query_input(&input)?;

    let now = now_epoch_millis();
    let existing = match input.id.as_ref() {
        Some(id) => get_saved_query(pool, id).await?,
        None => None,
    };

    let saved_query = SavedQuery {
        id: input.id.unwrap_or_else(|| Uuid::new_v4().to_string()),
        name: input.name.trim().to_string(),
        description: input.description.filter(|value| !value.trim().is_empty()),
        connection_id: input.connection_id,
        sql: input.sql,
        created_at: existing.map(|item| item.created_at).unwrap_or(now),
        updated_at: now,
    };

    sqlx::query(
        "INSERT INTO saved_queries (id, name, description, connection_id, sql, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            description = excluded.description,
            connection_id = excluded.connection_id,
            sql = excluded.sql,
            updated_at = excluded.updated_at",
    )
    .bind(&saved_query.id)
    .bind(&saved_query.name)
    .bind(&saved_query.description)
    .bind(&saved_query.connection_id)
    .bind(&saved_query.sql)
    .bind(saved_query.created_at)
    .bind(saved_query.updated_at)
    .execute(pool)
    .await?;

    Ok(saved_query)
}

pub async fn delete_saved_query(pool: &SqlitePool, id: &str) -> Result<(), VeloxError> {
    sqlx::query("DELETE FROM saved_queries WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn duplicate_saved_query(pool: &SqlitePool, id: &str) -> Result<SavedQuery, VeloxError> {
    let source = get_saved_query(pool, id)
        .await?
        .ok_or_else(|| VeloxError::Validation("Saved query not found.".to_string()))?;

    save_saved_query(
        pool,
        SavedQueryInput {
            id: None,
            name: format!("{} (copy)", source.name),
            description: source.description,
            connection_id: source.connection_id,
            sql: source.sql,
        },
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::validate_saved_query_input;
    use crate::db::{
        delete_saved_query, duplicate_saved_query, get_saved_query, list_saved_queries,
        open_memory_app_meta_db, save_saved_query,
    };
    use crate::models::SavedQueryInput;

    fn valid_input() -> SavedQueryInput {
        SavedQueryInput {
            id: None,
            name: "Top customers".to_string(),
            description: None,
            connection_id: "conn-1".to_string(),
            sql: "select * from customers".to_string(),
        }
    }

    #[test]
    fn rejects_empty_name() {
        let input = SavedQueryInput { name: "  ".to_string(), ..valid_input() };
        assert!(validate_saved_query_input(&input).is_err());
    }

    #[test]
    fn rejects_empty_sql() {
        let input = SavedQueryInput { sql: "".to_string(), ..valid_input() };
        assert!(validate_saved_query_input(&input).is_err());
    }

    #[test]
    fn rejects_empty_connection_id() {
        let input = SavedQueryInput { connection_id: "".to_string(), ..valid_input() };
        assert!(validate_saved_query_input(&input).is_err());
    }

    #[test]
    fn accepts_valid_input() {
        assert!(validate_saved_query_input(&valid_input()).is_ok());
    }

    #[test]
    fn skips_invalid_store_entries() {
        let valid = serde_json::json!({
            "id": "q1",
            "name": "Top customers",
            "connectionId": "conn-1",
            "sql": "select 1",
            "createdAt": 1,
            "updatedAt": 2,
        });
        let items = super::saved_queries_from_entries([
            ("bad".to_string(), serde_json::json!({"not": "a query"})),
            ("q1".to_string(), valid),
        ]);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id, "q1");
        assert_eq!(items[0].name, "Top customers");
    }

    #[test]
    fn accepts_snake_case_saved_query_json() {
        let items = super::saved_queries_from_entries([(
            "q1".to_string(),
            serde_json::json!({
                "id": "q1",
                "name": "Legacy",
                "connection_id": "conn-1",
                "sql": "select 1",
                "created_at": 1,
                "updated_at": 2,
            }),
        )]);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].connection_id, "conn-1");
    }

    #[tokio::test]
    async fn save_list_get_delete_roundtrip() {
        let db = open_memory_app_meta_db().await.expect("memory db");
        let pool = db.pool();

        let saved = save_saved_query(pool, valid_input()).await.expect("save");
        assert!(!saved.id.is_empty());
        assert_eq!(list_saved_queries(pool, Some("conn-1")).await.expect("list").len(), 1);
        assert!(list_saved_queries(pool, Some("other")).await.expect("empty").is_empty());

        let fetched = get_saved_query(pool, &saved.id).await.expect("get").expect("exists");
        assert_eq!(fetched.sql, "select * from customers");

        delete_saved_query(pool, &saved.id).await.expect("delete");
        assert!(get_saved_query(pool, &saved.id).await.expect("get after delete").is_none());
    }

    #[tokio::test]
    async fn duplicate_creates_new_row() {
        let db = open_memory_app_meta_db().await.expect("memory db");
        let pool = db.pool();
        let saved = save_saved_query(
            pool,
            SavedQueryInput {
                id: Some("q1".to_string()),
                ..valid_input()
            },
        )
        .await
        .expect("save");

        let copy = duplicate_saved_query(pool, &saved.id).await.expect("duplicate");
        assert_ne!(copy.id, saved.id);
        assert_eq!(copy.name, "Top customers (copy)");
        assert_eq!(list_saved_queries(pool, None).await.expect("list").len(), 2);
    }
}
