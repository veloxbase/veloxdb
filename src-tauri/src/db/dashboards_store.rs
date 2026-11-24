use sqlx::{Row, Sqlite, SqlitePool, Transaction};

use crate::error::VeloxError;
use crate::models::{now_epoch_millis, Dashboard, MAX_DASHBOARD_WIDGETS};

fn validate_dashboard(dashboard: &Dashboard) -> Result<(), VeloxError> {
    if dashboard.id.trim().is_empty() {
        return Err(VeloxError::Validation("Dashboard id is required.".to_string()));
    }
    if dashboard.name.trim().is_empty() {
        return Err(VeloxError::Validation("Dashboard name is required.".to_string()));
    }
    if dashboard.connection_id.trim().is_empty() {
        return Err(VeloxError::Validation("Dashboard must reference a connection.".to_string()));
    }
    if dashboard.widgets.len() > MAX_DASHBOARD_WIDGETS {
        return Err(VeloxError::Validation(format!(
            "A dashboard can have at most {} widgets.",
            MAX_DASHBOARD_WIDGETS
        )));
    }
    Ok(())
}

pub(crate) fn dashboards_from_entries(
    entries: impl IntoIterator<Item = (String, serde_json::Value)>,
) -> Vec<Dashboard> {
    let mut items = Vec::new();
    for (key, value) in entries {
        match serde_json::from_value::<Dashboard>(value) {
            Ok(mut item) => {
                if item.id.trim().is_empty() {
                    item.id = key.clone();
                }
                if validate_dashboard(&item).is_err() {
                    log::warn!("Skipping invalid dashboard {key}");
                    continue;
                }
                items.push(item);
            }
            Err(error) => {
                log::warn!("Skipping invalid dashboard {key}: {error}");
            }
        }
    }
    items
}

fn dashboard_from_row(row: &sqlx::sqlite::SqliteRow) -> Result<Option<Dashboard>, VeloxError> {
    let document: String = row.try_get("document")?;
    let id: String = row.try_get("id")?;
    match serde_json::from_str::<Dashboard>(&document) {
        Ok(mut dashboard) => {
            dashboard.id = id;
            dashboard.name = row.try_get("name")?;
            dashboard.connection_id = row.try_get("connection_id")?;
            dashboard.created_at = row.try_get("created_at")?;
            dashboard.updated_at = row.try_get("updated_at")?;
            Ok(Some(dashboard))
        }
        Err(error) => {
            log::warn!("Skipping invalid dashboard document {id}: {error}");
            Ok(None)
        }
    }
}

pub(crate) async fn insert_dashboard_row(
    tx: &mut Transaction<'_, Sqlite>,
    dashboard: &Dashboard,
) -> Result<(), VeloxError> {
    let document = serde_json::to_string(dashboard)?;
    sqlx::query(
        "INSERT OR REPLACE INTO dashboards
         (id, name, connection_id, created_at, updated_at, document)
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(&dashboard.id)
    .bind(&dashboard.name)
    .bind(&dashboard.connection_id)
    .bind(dashboard.created_at)
    .bind(dashboard.updated_at)
    .bind(document)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

pub async fn list_dashboards(
    pool: &SqlitePool,
    connection_id: Option<&str>,
) -> Result<Vec<Dashboard>, VeloxError> {
    let rows = if let Some(connection_id) = connection_id {
        sqlx::query(
            "SELECT id, name, connection_id, created_at, updated_at, document
             FROM dashboards
             WHERE connection_id = ?
             ORDER BY updated_at DESC",
        )
        .bind(connection_id)
        .fetch_all(pool)
        .await?
    } else {
        sqlx::query(
            "SELECT id, name, connection_id, created_at, updated_at, document
             FROM dashboards
             ORDER BY updated_at DESC",
        )
        .fetch_all(pool)
        .await?
    };

    let mut items = Vec::with_capacity(rows.len());
    for row in rows {
        if let Some(dashboard) = dashboard_from_row(&row)? {
            items.push(dashboard);
        }
    }
    Ok(items)
}

pub async fn get_dashboard(pool: &SqlitePool, id: &str) -> Result<Option<Dashboard>, VeloxError> {
    let row = sqlx::query(
        "SELECT id, name, connection_id, created_at, updated_at, document
         FROM dashboards
         WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;

    match row {
        Some(row) => dashboard_from_row(&row),
        None => Ok(None),
    }
}

pub async fn save_dashboard(pool: &SqlitePool, mut dashboard: Dashboard) -> Result<Dashboard, VeloxError> {
    validate_dashboard(&dashboard)?;

    let now = now_epoch_millis();
    let existing = get_dashboard(pool, &dashboard.id).await?;
    dashboard.created_at = existing
        .map(|item| item.created_at)
        .unwrap_or(dashboard.created_at.max(now));
    dashboard.updated_at = now;

    let document = serde_json::to_string(&dashboard)?;
    sqlx::query(
        "INSERT INTO dashboards (id, name, connection_id, created_at, updated_at, document)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            connection_id = excluded.connection_id,
            updated_at = excluded.updated_at,
            document = excluded.document",
    )
    .bind(&dashboard.id)
    .bind(&dashboard.name)
    .bind(&dashboard.connection_id)
    .bind(dashboard.created_at)
    .bind(dashboard.updated_at)
    .bind(document)
    .execute(pool)
    .await?;

    Ok(dashboard)
}

pub async fn delete_dashboard(pool: &SqlitePool, id: &str) -> Result<(), VeloxError> {
    sqlx::query("DELETE FROM dashboards WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn duplicate_dashboard(
    pool: &SqlitePool,
    id: &str,
    new_id: String,
) -> Result<Dashboard, VeloxError> {
    let source = get_dashboard(pool, id)
        .await?
        .ok_or_else(|| VeloxError::Validation("Dashboard not found.".to_string()))?;

    let now = now_epoch_millis();
    let duplicate = Dashboard {
        id: new_id,
        name: format!("{} (copy)", source.name),
        created_at: now,
        updated_at: now,
        ..source
    };

    save_dashboard(pool, duplicate).await
}

#[cfg(test)]
mod tests {
    use super::validate_dashboard;
    use crate::db::{
        delete_dashboard, duplicate_dashboard, get_dashboard, list_dashboards, open_memory_app_meta_db,
        save_dashboard,
    };
    use crate::models::{
        ChartType, ColumnRef, Dashboard, DashboardTheme, DashboardVariable, DashboardVariableType,
        VizConfig, VizEncodings, Widget, WidgetKind, WidgetQuery, WidgetQueryProvider,
        MAX_DASHBOARD_WIDGETS,
    };
    use std::collections::BTreeMap;

    fn valid_dashboard() -> Dashboard {
        Dashboard {
            version: 1,
            id: "dash-1".to_string(),
            name: "Sales overview".to_string(),
            description: None,
            connection_id: "conn-1".to_string(),
            cells: Vec::new(),
            layout: Vec::new(),
            widgets: BTreeMap::new(),
            variables: Vec::new(),
            theme: DashboardTheme::Inherit,
            refresh_interval_sec: None,
            pages: Vec::new(),
            story: None,
            created_at: 0,
            updated_at: 0,
        }
    }

    #[test]
    fn rejects_empty_name() {
        let dashboard = Dashboard { name: "  ".to_string(), ..valid_dashboard() };
        assert!(validate_dashboard(&dashboard).is_err());
    }

    #[test]
    fn rejects_empty_connection_id() {
        let dashboard = Dashboard { connection_id: "".to_string(), ..valid_dashboard() };
        assert!(validate_dashboard(&dashboard).is_err());
    }

    #[test]
    fn accepts_valid_dashboard() {
        assert!(validate_dashboard(&valid_dashboard()).is_ok());
    }

    #[tokio::test]
    async fn save_list_get_delete_roundtrip() {
        let db = open_memory_app_meta_db().await.expect("memory db");
        let pool = db.pool();

        let saved = save_dashboard(pool, valid_dashboard()).await.expect("save");
        assert_eq!(saved.name, "Sales overview");
        assert!(saved.updated_at > 0);

        let listed = list_dashboards(pool, Some("conn-1")).await.expect("list");
        assert_eq!(listed.len(), 1);
        assert!(list_dashboards(pool, Some("other")).await.expect("empty").is_empty());

        let fetched = get_dashboard(pool, "dash-1").await.expect("get").expect("exists");
        assert_eq!(fetched.connection_id, "conn-1");

        delete_dashboard(pool, "dash-1").await.expect("delete");
        assert!(get_dashboard(pool, "dash-1").await.expect("get after delete").is_none());
    }

    #[tokio::test]
    async fn duplicate_assigns_new_id() {
        let db = open_memory_app_meta_db().await.expect("memory db");
        let pool = db.pool();
        save_dashboard(pool, valid_dashboard()).await.expect("save");

        let copy = duplicate_dashboard(pool, "dash-1", "dash-2".to_string())
            .await
            .expect("duplicate");
        assert_eq!(copy.id, "dash-2");
        assert_eq!(copy.name, "Sales overview (copy)");
        assert_eq!(list_dashboards(pool, None).await.expect("list").len(), 2);
    }

    #[tokio::test]
    async fn rejects_too_many_widgets() {
        let db = open_memory_app_meta_db().await.expect("memory db");
        let mut dashboard = valid_dashboard();
        for index in 0..=MAX_DASHBOARD_WIDGETS {
            let id = format!("w{index}");
            dashboard.widgets.insert(
                id.clone(),
                crate::models::Widget {
                    id,
                    kind: crate::models::WidgetKind::Text,
                    title: "n".to_string(),
                    query: None,
                    viz: None,
                    locked: false,
                },
            );
        }
        assert!(save_dashboard(db.pool(), dashboard).await.is_err());
    }

    #[tokio::test]
    async fn save_roundtrips_select_variables() {
        let db = open_memory_app_meta_db().await.expect("memory db");
        let mut dashboard = valid_dashboard();
        dashboard.variables = vec![DashboardVariable {
            name: "region".to_string(),
            variable_type: DashboardVariableType::Select,
            default_value: String::new(),
            options: Some(vec!["EU".to_string(), "US".to_string()]),
            label: Some("Region".to_string()),
        }];

        save_dashboard(db.pool(), dashboard).await.expect("save");
        let fetched = get_dashboard(db.pool(), "dash-1")
            .await
            .expect("get")
            .expect("exists");
        assert_eq!(fetched.variables.len(), 1);
        assert_eq!(fetched.variables[0].variable_type, DashboardVariableType::Select);
        assert_eq!(
            fetched.variables[0].options.as_deref(),
            Some(["EU".to_string(), "US".to_string()].as_slice())
        );
        assert_eq!(fetched.variables[0].label.as_deref(), Some("Region"));
    }

    #[tokio::test]
    async fn save_roundtrips_combo_widget() {
        let db = open_memory_app_meta_db().await.expect("memory db");
        let mut dashboard = valid_dashboard();
        dashboard.widgets.insert(
            "w1".to_string(),
            Widget {
                id: "w1".to_string(),
                kind: WidgetKind::Chart,
                title: "Revenue vs orders".to_string(),
                query: Some(WidgetQuery {
                    provider_id: WidgetQueryProvider::SqlQuery,
                    connection_id: "conn-1".to_string(),
                    sql: "SELECT 1".to_string(),
                    saved_query_id: None,
                    source_cell_id: None,
                }),
                viz: Some(VizConfig {
                    chart_type: ChartType::Combo,
                    encodings: VizEncodings {
                        x: Some(ColumnRef { column: "month".to_string(), role: None }),
                        y: vec![
                            ColumnRef { column: "revenue".to_string(), role: None },
                            ColumnRef { column: "orders".to_string(), role: None },
                        ],
                        series: None,
                        size: None,
                    },
                    options: serde_json::Map::new(),
                }),
                locked: false,
            },
        );

        save_dashboard(db.pool(), dashboard).await.expect("save");
        let fetched = get_dashboard(db.pool(), "dash-1")
            .await
            .expect("get")
            .expect("exists");
        assert_eq!(
            fetched.widgets["w1"].viz.as_ref().unwrap().chart_type,
            ChartType::Combo
        );
    }
}
