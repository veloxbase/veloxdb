use tauri::{AppHandle, State};

use crate::db::AppState;
use crate::export::{DiagramExportRequest, ExportQueryRequest, export_diagram_to_png, export_results_csv, export_results_json};
use crate::credentials;

#[tauri::command]
pub async fn export_diagram_png(
    input: DiagramExportRequest,
    output_path: String,
) -> Result<(), String> {
    let path = std::path::PathBuf::from(&output_path);
    tokio::task::spawn_blocking(move || export_diagram_to_png(&input, &path))
        .await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn export_results_csv_command(
    app: AppHandle,
    state: State<'_, AppState>,
    input: ExportQueryRequest,
) -> Result<(), String> {
    export_results_csv(&app, &state, &input).await
}

#[tauri::command]
pub async fn export_results_json_command(
    app: AppHandle,
    state: State<'_, AppState>,
    input: ExportQueryRequest,
) -> Result<(), String> {
    export_results_json(&app, &state, &input).await
}

#[tauri::command]
pub async fn save_base64_png(data: String, output_path: String) -> Result<(), String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data.strip_prefix("data:image/png;base64,").unwrap_or(&data))
        .map_err(|e| e.to_string())?;
    std::fs::write(&output_path, bytes).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_text_file(content: String, output_path: String) -> Result<(), String> {
    std::fs::write(&output_path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn read_text_file(input_path: String) -> Result<String, String> {
    std::fs::read_to_string(&input_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn store_ai_api_key(provider: String, api_key: String) -> Result<(), String> {
    if api_key.trim().is_empty() {
        return credentials::delete_ai_api_key(&provider);
    }
    credentials::store_ai_api_key(&provider, api_key.trim())
}

#[tauri::command]
pub async fn get_ai_api_key(provider: String) -> Result<Option<String>, String> {
    credentials::get_ai_api_key(&provider)
}
