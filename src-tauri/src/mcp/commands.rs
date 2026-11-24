//! Tauri commands behind Settings → Veloxy → AI tools.

use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use super::bridge::ENDPOINT_FLAG;
use super::endpoint::{default_endpoint_path, ENDPOINT_FILE};
use super::server::{is_enabled, save_enabled, McpActivity, McpState};
use super::MCP_FLAG;
use crate::models::ConnectionSummary;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpStatus {
    pub enabled: bool,
    pub running: bool,
    /// The executable AI clients launch (with `launcher_args`).
    pub launcher: Option<String>,
    pub launcher_args: Vec<String>,
    /// Why the copied config may not work as is, if anything.
    pub launcher_warning: Option<String>,
    pub activity: Vec<McpActivity>,
}

/// Path to the executable a client config should launch.
fn launcher() -> (Option<String>, Option<String>) {
    // An AppImage runs from a temporary mount; clients must launch the
    // AppImage file itself.
    #[cfg(target_os = "linux")]
    if let Some(appimage) = std::env::var_os("APPIMAGE") {
        return (Some(appimage.to_string_lossy().to_string()), None);
    }
    match std::env::current_exe() {
        Ok(path) => {
            let path = path.to_string_lossy().to_string();
            let warning = if path.contains("/AppTranslocation/") {
                Some("macOS is running VeloxDB from a temporary location. Move VeloxDB to Applications, reopen it, then copy the config again.".to_string())
            } else if cfg!(debug_assertions) {
                Some("This is a development build, so the config points at the dev binary.".to_string())
            } else {
                None
            };
            (Some(path), warning)
        }
        Err(_) => (None, Some("Could not find VeloxDB's executable.".to_string())),
    }
}

/// `--mcp`, plus `--endpoint <path>` when this build keeps its data outside
/// the default folder the bridge looks in.
fn launcher_args(app: &AppHandle) -> Vec<String> {
    let mut args = vec![MCP_FLAG.to_string()];
    if let Ok(dir) = app.path().app_data_dir() {
        let endpoint = dir.join(ENDPOINT_FILE);
        if default_endpoint_path().as_ref() != Some(&endpoint) {
            args.push(ENDPOINT_FLAG.to_string());
            args.push(endpoint.to_string_lossy().to_string());
        }
    }
    args
}

async fn status(app: &AppHandle, state: &McpState) -> McpStatus {
    let (launcher, launcher_warning) = launcher();
    McpStatus {
        enabled: is_enabled(app),
        running: state.is_running().await,
        launcher,
        launcher_args: launcher_args(app),
        launcher_warning,
        activity: state.activity(),
    }
}

#[tauri::command]
pub async fn mcp_get_status(app: AppHandle, state: State<'_, McpState>) -> Result<McpStatus, String> {
    Ok(status(&app, &state).await)
}

/// The app-level switch: starts or stops the server and remembers the choice.
#[tauri::command]
pub async fn mcp_set_enabled(
    app: AppHandle,
    state: State<'_, McpState>,
    enabled: bool,
) -> Result<McpStatus, String> {
    if enabled {
        state.start(&app).await?;
    } else {
        state.stop().await;
    }
    save_enabled(&app, enabled)?;
    Ok(status(&app, &state).await)
}

#[tauri::command]
pub async fn mcp_clear_activity(state: State<'_, McpState>) -> Result<(), String> {
    state.clear_activity();
    Ok(())
}

/// The per-connection opt-in, "Allow AI tools on this connection".
#[tauri::command]
pub async fn set_connection_ai_tools(
    app: AppHandle,
    connection_id: String,
    allowed: bool,
) -> Result<ConnectionSummary, String> {
    crate::db::set_connection_allow_ai_tools(&app, &connection_id, allowed).map_err(String::from)
}
