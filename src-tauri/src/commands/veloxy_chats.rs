use tauri::State;

use crate::db::{self, AppMetaDb};
use crate::models::{VeloxyThread, VeloxyThreadInput, VeloxyThreadSummary};

#[tauri::command]
pub async fn list_veloxy_threads(
    meta: State<'_, AppMetaDb>,
    connection_id: String,
) -> Result<Vec<VeloxyThreadSummary>, String> {
    db::list_veloxy_threads(meta.pool(), &connection_id)
        .await
        .map_err(String::from)
}

#[tauri::command]
pub async fn load_veloxy_thread(
    meta: State<'_, AppMetaDb>,
    id: String,
) -> Result<Option<VeloxyThread>, String> {
    db::load_veloxy_thread(meta.pool(), &id)
        .await
        .map_err(String::from)
}

#[tauri::command]
pub async fn save_veloxy_thread(
    meta: State<'_, AppMetaDb>,
    input: VeloxyThreadInput,
) -> Result<VeloxyThread, String> {
    db::save_veloxy_thread(meta.pool(), input)
        .await
        .map_err(String::from)
}

#[tauri::command]
pub async fn touch_veloxy_thread(meta: State<'_, AppMetaDb>, id: String) -> Result<(), String> {
    db::touch_veloxy_thread(meta.pool(), &id)
        .await
        .map_err(String::from)
}

#[tauri::command]
pub async fn delete_veloxy_thread(meta: State<'_, AppMetaDb>, id: String) -> Result<(), String> {
    db::delete_veloxy_thread(meta.pool(), &id)
        .await
        .map_err(String::from)
}
