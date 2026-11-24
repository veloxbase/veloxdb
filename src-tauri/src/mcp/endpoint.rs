//! How the `--mcp` bridge finds and talks to the running app.
//!
//! While its MCP server runs, the app writes `mcp-endpoint.json` (port and a
//! token that changes every time the server starts) into its data directory,
//! readable by the current user only. The bridge reads it for each tool call,
//! so client configs never contain a secret and a restarted app is picked up
//! without restarting the client.
//!
//! The wire protocol is one JSON line each way over a 127.0.0.1 TCP socket: a
//! [`BridgeRequest`] carrying the token, then a [`BridgeResponse`]. There is no
//! HTTP, so a web page cannot speak it even if it guessed the port.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Must match `identifier` in tauri.conf.json: Tauri's app data directory is
/// `<platform data dir>/<identifier>`, and the bridge runs without Tauri.
pub(crate) const APP_IDENTIFIER: &str = "com.veloxdb.app";
pub(crate) const ENDPOINT_FILE: &str = "mcp-endpoint.json";
pub(crate) const ENDPOINT_VERSION: u32 = 1;

/// Upper bound for one request line (tool arguments, mostly SQL).
pub(crate) const MAX_REQUEST_BYTES: u64 = 1024 * 1024;
/// Upper bound for one response line. Tool output is capped well below this.
pub(crate) const MAX_RESPONSE_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct Endpoint {
    pub version: u32,
    pub port: u16,
    pub token: String,
    pub pid: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct BridgeRequest {
    pub token: String,
    /// The MCP client's name from `initialize` (e.g. "claude-code"), shown
    /// in the app's activity list.
    #[serde(default)]
    pub client: Option<String>,
    pub tool: String,
    #[serde(default)]
    pub arguments: Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct BridgeResponse {
    pub text: String,
    #[serde(rename = "isError")]
    pub is_error: bool,
}

/// Where the bridge looks for the endpoint file.
pub(crate) fn default_endpoint_path() -> Option<PathBuf> {
    dirs::data_dir().map(|dir| dir.join(APP_IDENTIFIER).join(ENDPOINT_FILE))
}

/// 32 random bytes, hex encoded.
pub(crate) fn generate_token() -> String {
    let mut bytes = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    hex::encode(bytes)
}

/// Compares tokens without stopping at the first differing byte.
pub(crate) fn tokens_match(expected: &str, given: &str) -> bool {
    let (expected, given) = (expected.as_bytes(), given.as_bytes());
    if expected.is_empty() || expected.len() != given.len() {
        return false;
    }
    expected
        .iter()
        .zip(given)
        .fold(0u8, |diff, (a, b)| diff | (a ^ b))
        == 0
}

/// Writes the endpoint file readable by the current user only, replacing any
/// previous one in a single rename so the bridge never reads half a file.
pub(crate) fn write_endpoint(path: &Path, endpoint: &Endpoint) -> std::io::Result<()> {
    let dir = path
        .parent()
        .ok_or_else(|| std::io::Error::other("endpoint path has no parent directory"))?;
    fs::create_dir_all(dir)?;
    let tmp = dir.join(format!(".{}.{}.tmp", ENDPOINT_FILE, std::process::id()));
    let _ = fs::remove_file(&tmp);
    {
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&tmp)?;
        file.write_all(&serde_json::to_vec(endpoint).map_err(std::io::Error::other)?)?;
        file.sync_all()?;
    }
    fs::rename(&tmp, path)
}

pub(crate) fn read_endpoint(path: &Path) -> Result<Endpoint, String> {
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    let endpoint: Endpoint = serde_json::from_slice(&bytes).map_err(|error| error.to_string())?;
    if endpoint.version != ENDPOINT_VERSION {
        return Err(format!(
            "Unsupported endpoint version {} (expected {}). Update VeloxDB and the AI client config.",
            endpoint.version, ENDPOINT_VERSION
        ));
    }
    Ok(endpoint)
}

/// Removes the endpoint file if it still belongs to the server holding
/// `token`, so stopping one app instance does not unpublish another.
pub(crate) fn remove_endpoint(path: &Path, token: &str) {
    if let Ok(current) = read_endpoint(path) {
        if !tokens_match(&current.token, token) {
            return;
        }
    }
    let _ = fs::remove_file(path);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path() -> PathBuf {
        std::env::temp_dir()
            .join(format!("veloxdb-mcp-endpoint-{}", uuid::Uuid::new_v4()))
            .join(ENDPOINT_FILE)
    }

    #[test]
    fn identifier_matches_tauri_config() {
        let config: Value = serde_json::from_str(include_str!("../../tauri.conf.json")).expect("config");
        assert_eq!(config["identifier"].as_str(), Some(APP_IDENTIFIER));
    }

    #[test]
    fn endpoint_round_trips_and_is_private() {
        let path = temp_path();
        let endpoint = Endpoint { version: ENDPOINT_VERSION, port: 4242, token: generate_token(), pid: 7 };
        write_endpoint(&path, &endpoint).expect("write");
        assert_eq!(read_endpoint(&path).expect("read"), endpoint);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(&path).expect("metadata").permissions().mode();
            assert_eq!(mode & 0o777, 0o600);
        }
        // Rewriting replaces the file in place.
        let next = Endpoint { port: 4343, ..endpoint.clone() };
        write_endpoint(&path, &next).expect("rewrite");
        assert_eq!(read_endpoint(&path).expect("read").port, 4343);

        remove_endpoint(&path, "someone-else");
        assert!(path.exists(), "another server's token must not remove the file");
        remove_endpoint(&path, &endpoint.token);
        assert!(!path.exists());
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn tokens_are_random_and_compared_exactly() {
        let a = generate_token();
        let b = generate_token();
        assert_eq!(a.len(), 64);
        assert_ne!(a, b);
        assert!(tokens_match(&a, &a.clone()));
        assert!(!tokens_match(&a, &b));
        assert!(!tokens_match(&a, &a[..63]));
        assert!(!tokens_match("", ""));
    }

    #[test]
    fn rejects_unknown_versions() {
        let path = temp_path();
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, r#"{"version":99,"port":1,"token":"x","pid":1}"#).unwrap();
        assert!(read_endpoint(&path).unwrap_err().contains("Unsupported endpoint version"));
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }
}
