use tauri::State;

use crate::db::{self, AppMetaDb};
use crate::models::{SavedQuery, SavedQueryInput};

#[tauri::command]
pub async fn list_saved_queries(
    meta: State<'_, AppMetaDb>,
    connection_id: Option<String>,
) -> Result<Vec<SavedQuery>, String> {
    db::list_saved_queries(meta.pool(), connection_id.as_deref())
        .await
        .map_err(String::from)
}

#[tauri::command]
pub async fn get_saved_query(meta: State<'_, AppMetaDb>, id: String) -> Result<Option<SavedQuery>, String> {
    db::get_saved_query(meta.pool(), &id).await.map_err(String::from)
}

#[tauri::command]
pub async fn save_saved_query(
    meta: State<'_, AppMetaDb>,
    input: SavedQueryInput,
) -> Result<SavedQuery, String> {
    db::save_saved_query(meta.pool(), input).await.map_err(String::from)
}

#[tauri::command]
pub async fn delete_saved_query(meta: State<'_, AppMetaDb>, id: String) -> Result<(), String> {
    db::delete_saved_query(meta.pool(), &id).await.map_err(String::from)
}

#[tauri::command]
pub async fn duplicate_saved_query(meta: State<'_, AppMetaDb>, id: String) -> Result<SavedQuery, String> {
    db::duplicate_saved_query(meta.pool(), &id).await.map_err(String::from)
}
