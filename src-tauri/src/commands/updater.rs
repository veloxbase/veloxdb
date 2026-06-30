use serde::Deserialize;
use tauri::{AppHandle, State};

use crate::db::AppState;

const GITHUB_REPO: &str = "abeni16/veloxdb";

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    pub current_version: String,
    pub latest_version: String,
    pub has_update: bool,
    pub download_url: Option<String>,
    pub release_notes: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    body: Option<String>,
    assets: Vec<GitHubAsset>,
}

#[derive(Debug, Deserialize)]
struct GitHubAsset {
    name: String,
    browser_download_url: String,
}

#[tauri::command]
pub async fn check_for_updates(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<UpdateCheckResult, String> {
    let current_version = app.package_info().version.to_string();

    let client = state
        .openrouter_client
        .get()
        .cloned()
        .unwrap_or_else(|| {
            reqwest::Client::builder()
                .user_agent(format!("VeloxDB-Updater/{}", current_version))
                .build()
                .expect("failed to build reqwest client")
        });

    let url = format!(
        "https://api.github.com/repos/{}/releases/latest",
        GITHUB_REPO
    );

    let response = client
        .get(&url)
        .header("Accept", "application/vnd.github.v3+json")
        .send()
        .await
        .map_err(|e| format!("Failed to check for updates: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "GitHub API returned {}",
            response.status().as_u16()
        ));
    }

    let release: GitHubRelease = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse release info: {}", e))?;

    let latest_tag = release.tag_name.trim_start_matches('v');

    let current_ver = semver::Version::parse(&current_version)
        .map_err(|e| format!("Invalid current version: {}", e))?;
    let latest_ver = semver::Version::parse(latest_tag)
        .map_err(|e| format!("Invalid latest version '{}': {}", latest_tag, e))?;

    let has_update = latest_ver > current_ver;

    let download_url = find_platform_asset(&release.assets);

    Ok(UpdateCheckResult {
        current_version,
        latest_version: latest_tag.to_string(),
        has_update,
        download_url,
        release_notes: release.body,
    })
}

fn find_platform_asset(assets: &[GitHubAsset]) -> Option<String> {
    for asset in assets {
        let name = &asset.name;
        #[cfg(target_os = "macos")]
        {
            if name.ends_with(".dmg") {
                return Some(asset.browser_download_url.clone());
            }
        }
        #[cfg(target_os = "windows")]
        {
            if name.ends_with(".msi") || name.ends_with(".exe") {
                return Some(asset.browser_download_url.clone());
            }
        }
        #[cfg(target_os = "linux")]
        {
            if name.ends_with(".AppImage") || name.ends_with(".deb") {
                return Some(asset.browser_download_url.clone());
            }
        }
    }
    None
}
