use std::path::Path;
use std::str::FromStr;
use std::time::Duration;

use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};
use sqlx::{Row, SqlitePool};
use tauri::AppHandle;
use tauri::Manager;
use tauri_plugin_store::StoreExt;

use crate::error::VeloxError;
use crate::models::{DASHBOARDS_STORE_PATH, SAVED_QUERIES_STORE_PATH};

use super::dashboards_store::{dashboards_from_entries, insert_dashboard_row};
use super::saved_queries_store::{insert_saved_query_row, saved_queries_from_entries};

pub const APP_META_DB_FILE: &str = "veloxdb.sqlite";
pub const SCHEMA_VERSION: &str = "1";

const META_SCHEMA_VERSION: &str = "schema_version";
const META_JSON_MIGRATED_AT: &str = "json_migrated_at";
const POOL_SIZE: u32 = 4;
const POOL_WAIT_SECS: u64 = 15;

pub struct AppMetaDb {
    pub pool: SqlitePool,
}

impl AppMetaDb {
    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }
}

pub async fn open_app_meta_db(app: &AppHandle) -> Result<AppMetaDb, VeloxError> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| VeloxError::Configuration(format!("App data directory: {error}")))?;
    std::fs::create_dir_all(&data_dir)?;
    let db_path = data_dir.join(APP_META_DB_FILE);
    let pool = connect_sqlite_file(&db_path).await?;
    apply_schema(&pool).await?;
    maybe_migrate_json_stores(app, &pool, &data_dir).await?;
    Ok(AppMetaDb { pool })
}

pub async fn open_memory_app_meta_db() -> Result<AppMetaDb, VeloxError> {
    let options = SqliteConnectOptions::from_str("sqlite::memory:")
        .map_err(|error| VeloxError::Internal(error.to_string()))?
        .create_if_missing(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await?;
    apply_schema(&pool).await?;
    Ok(AppMetaDb { pool })
}

async fn connect_sqlite_file(path: &Path) -> Result<SqlitePool, VeloxError> {
    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Normal);
    SqlitePoolOptions::new()
        .max_connections(POOL_SIZE)
        .acquire_timeout(Duration::from_secs(POOL_WAIT_SECS))
        .connect_with(options)
        .await
        .map_err(VeloxError::from)
}

pub async fn apply_schema(pool: &SqlitePool) -> Result<(), VeloxError> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS app_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS dashboards (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            connection_id TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            document TEXT NOT NULL
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_dashboards_connection_updated
         ON dashboards (connection_id, updated_at DESC)",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS saved_queries (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            connection_id TEXT NOT NULL,
            sql TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_saved_queries_connection_updated
         ON saved_queries (connection_id, updated_at DESC)",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS veloxy_threads (
            id TEXT PRIMARY KEY,
            connection_id TEXT NOT NULL,
            database_name TEXT,
            title TEXT NOT NULL DEFAULT '',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            opened_at INTEGER NOT NULL,
            state TEXT NOT NULL
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_veloxy_threads_connection_opened
         ON veloxy_threads (connection_id, opened_at DESC)",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "INSERT OR IGNORE INTO app_meta (key, value) VALUES (?, ?)",
    )
    .bind(META_SCHEMA_VERSION)
    .bind(SCHEMA_VERSION)
    .execute(pool)
    .await?;

    Ok(())
}

async fn maybe_migrate_json_stores(
    app: &AppHandle,
    pool: &SqlitePool,
    data_dir: &Path,
) -> Result<(), VeloxError> {
    if json_already_migrated(pool).await? {
        return Ok(());
    }
    if !tables_are_empty(pool).await? {
        set_json_migrated(pool).await?;
        return Ok(());
    }

    let dashboard_entries = load_store_entries(app, DASHBOARDS_STORE_PATH);
    let saved_query_entries = load_store_entries(app, SAVED_QUERIES_STORE_PATH);
    import_json_entries(pool, dashboard_entries, saved_query_entries).await?;
    set_json_migrated(pool).await?;
    rename_json_store_backups(data_dir);
    Ok(())
}

fn load_store_entries(app: &AppHandle, path: &str) -> Vec<(String, serde_json::Value)> {
    match app.store_builder(path).disable_auto_save().build() {
        Ok(store) => {
            let entries = store.entries();
            store.close_resource();
            entries
        }
        Err(error) => {
            log::warn!("Could not open {path} for migration: {error}");
            Vec::new()
        }
    }
}

pub async fn import_json_entries(
    pool: &SqlitePool,
    dashboard_entries: impl IntoIterator<Item = (String, serde_json::Value)>,
    saved_query_entries: impl IntoIterator<Item = (String, serde_json::Value)>,
) -> Result<(), VeloxError> {
    let dashboards = dashboards_from_entries(dashboard_entries);
    let saved_queries = saved_queries_from_entries(saved_query_entries);

    let mut tx = pool.begin().await?;
    for dashboard in dashboards {
        insert_dashboard_row(&mut tx, &dashboard).await?;
    }
    for saved_query in saved_queries {
        insert_saved_query_row(&mut tx, &saved_query).await?;
    }
    tx.commit().await?;
    Ok(())
}

async fn json_already_migrated(pool: &SqlitePool) -> Result<bool, VeloxError> {
    let row = sqlx::query("SELECT value FROM app_meta WHERE key = ?")
        .bind(META_JSON_MIGRATED_AT)
        .fetch_optional(pool)
        .await?;
    Ok(row.is_some())
}

async fn tables_are_empty(pool: &SqlitePool) -> Result<bool, VeloxError> {
    let dashboard_count: i64 = sqlx::query("SELECT COUNT(*) AS count FROM dashboards")
        .fetch_one(pool)
        .await?
        .try_get("count")?;
    let query_count: i64 = sqlx::query("SELECT COUNT(*) AS count FROM saved_queries")
        .fetch_one(pool)
        .await?
        .try_get("count")?;
    Ok(dashboard_count == 0 && query_count == 0)
}

async fn set_json_migrated(pool: &SqlitePool) -> Result<(), VeloxError> {
    let stamp = crate::models::now_epoch_millis().to_string();
    sqlx::query(
        "INSERT INTO app_meta (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(META_JSON_MIGRATED_AT)
    .bind(stamp)
    .execute(pool)
    .await?;
    Ok(())
}

fn rename_json_store_backups(data_dir: &Path) {
    for name in [DASHBOARDS_STORE_PATH, SAVED_QUERIES_STORE_PATH] {
        let source = data_dir.join(name);
        if !source.exists() {
            continue;
        }
        let destination = data_dir.join(format!("{name}.bak"));
        if let Err(error) = std::fs::rename(&source, &destination) {
            log::warn!("Could not rename {name} to backup: {error}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{Dashboard, DashboardTheme, SavedQuery};

    fn valid_dashboard_json() -> serde_json::Value {
        serde_json::json!({
            "version": 1,
            "id": "dash-1",
            "name": "Sales overview",
            "connectionId": "conn-1",
            "layout": [],
            "widgets": {},
            "variables": [],
            "theme": "inherit",
            "createdAt": 1,
            "updatedAt": 2,
        })
    }

    #[tokio::test]
    async fn import_skips_invalid_entries() {
        let db = open_memory_app_meta_db().await.expect("memory db");
        import_json_entries(
            db.pool(),
            [
                ("bad".to_string(), serde_json::json!({"not": "a dashboard"})),
                ("dash-1".to_string(), valid_dashboard_json()),
            ],
            [
                ("bad".to_string(), serde_json::json!({"not": "a query"})),
                (
                    "q1".to_string(),
                    serde_json::json!({
                        "id": "q1",
                        "name": "Top customers",
                        "connectionId": "conn-1",
                        "sql": "select 1",
                        "createdAt": 1,
                        "updatedAt": 2,
                    }),
                ),
            ],
        )
        .await
        .expect("import");

        let dashboards: Vec<Dashboard> = crate::db::list_dashboards(db.pool(), None)
            .await
            .expect("list dashboards");
        assert_eq!(dashboards.len(), 1);
        assert_eq!(dashboards[0].id, "dash-1");

        let queries: Vec<SavedQuery> = crate::db::list_saved_queries(db.pool(), None)
            .await
            .expect("list queries");
        assert_eq!(queries.len(), 1);
        assert_eq!(queries[0].id, "q1");
    }

    #[tokio::test]
    async fn import_accepts_snake_case_documents() {
        let db = open_memory_app_meta_db().await.expect("memory db");
        import_json_entries(
            db.pool(),
            [(
                "dash-1".to_string(),
                serde_json::json!({
                    "version": 1,
                    "id": "dash-1",
                    "name": "Legacy",
                    "connection_id": "conn-legacy",
                    "created_at": 10,
                    "updated_at": 20,
                }),
            )],
            [(
                "q1".to_string(),
                serde_json::json!({
                    "id": "q1",
                    "name": "Legacy",
                    "connection_id": "conn-legacy",
                    "sql": "select 1",
                    "created_at": 10,
                    "updated_at": 20,
                }),
            )],
        )
        .await
        .expect("import");

        let dashboards = crate::db::list_dashboards(db.pool(), Some("conn-legacy"))
            .await
            .expect("list dashboards");
        assert_eq!(dashboards.len(), 1);
        assert_eq!(dashboards[0].connection_id, "conn-legacy");
        assert_eq!(dashboards[0].theme, DashboardTheme::Inherit);

        let queries = crate::db::list_saved_queries(db.pool(), Some("conn-legacy"))
            .await
            .expect("list queries");
        assert_eq!(queries.len(), 1);
        assert_eq!(queries[0].connection_id, "conn-legacy");
    }
}
