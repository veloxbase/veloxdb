use tauri::State;
use uuid::Uuid;

use crate::db::{self, AppMetaDb};
use crate::models::Dashboard;

#[tauri::command]
pub async fn list_dashboards(
    meta: State<'_, AppMetaDb>,
    connection_id: Option<String>,
) -> Result<Vec<Dashboard>, String> {
    db::list_dashboards(meta.pool(), connection_id.as_deref())
        .await
        .map_err(String::from)
}

#[tauri::command]
pub async fn get_dashboard(meta: State<'_, AppMetaDb>, id: String) -> Result<Option<Dashboard>, String> {
    db::get_dashboard(meta.pool(), &id).await.map_err(String::from)
}

#[tauri::command]
pub async fn save_dashboard(meta: State<'_, AppMetaDb>, input: Dashboard) -> Result<Dashboard, String> {
    db::save_dashboard(meta.pool(), input).await.map_err(String::from)
}

#[tauri::command]
pub async fn delete_dashboard(meta: State<'_, AppMetaDb>, id: String) -> Result<(), String> {
    db::delete_dashboard(meta.pool(), &id).await.map_err(String::from)
}

#[tauri::command]
pub async fn duplicate_dashboard(meta: State<'_, AppMetaDb>, id: String) -> Result<Dashboard, String> {
    let new_id = Uuid::new_v4().to_string();
    db::duplicate_dashboard(meta.pool(), &id, new_id)
        .await
        .map_err(String::from)
}
