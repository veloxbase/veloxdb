//! The MCP server inside the app: a 127.0.0.1 listener that runs tool calls
//! forwarded by `veloxdb --mcp` bridges. It runs only while the app is open
//! and the user has turned on "Let AI apps use VeloxDB".

use std::collections::VecDeque;
use std::net::Ipv4Addr;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_store::StoreExt;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::tcp::OwnedWriteHalf;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{Mutex, Semaphore};

use super::endpoint::{
    generate_token, remove_endpoint, tokens_match, write_endpoint, BridgeRequest, BridgeResponse,
    Endpoint, ENDPOINT_FILE, ENDPOINT_VERSION, MAX_REQUEST_BYTES,
};
use super::tools::{call_tool, McpBackend, OpenInEditorRequest, ToolOutput, QUERY_TIMEOUT_MS};
use crate::db::AppState;
use crate::engines::AgentStatement;
use crate::models::{AskVeloxyDbContextCache, ConnectionSummary, DatabaseEngine, QueryResult};

pub(crate) const SETTINGS_STORE: &str = "mcp.json";
const ENABLED_KEY: &str = "enabled";
/// Tool calls running at once; more wait their turn.
const MAX_CONCURRENT_CALLS: usize = 4;
const REQUEST_READ_TIMEOUT: Duration = Duration::from_secs(10);
/// One call: the query timeout plus time to connect and read the catalog.
const CALL_TIMEOUT: Duration = Duration::from_millis(QUERY_TIMEOUT_MS + 30_000);
const ACTIVITY_LIMIT: usize = 50;
pub(crate) const OPEN_IN_EDITOR_EVENT: &str = "mcp://open-in-editor";
pub(crate) const ACTIVITY_EVENT: &str = "mcp://activity";

/// One tool call, for the activity list in Settings. Kept in memory only.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpActivity {
    pub at_ms: u64,
    pub client: String,
    pub tool: String,
    pub connection: Option<String>,
    pub summary: Option<String>,
    pub ok: bool,
}

pub(crate) type ActivitySink = Arc<dyn Fn(McpActivity) + Send + Sync>;

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64
}

/// Accepts bridge connections until the task is aborted. Each connection
/// carries one tool call. Generic over the backend so tests can drive it
/// without Tauri.
pub(crate) async fn serve<B: McpBackend>(
    listener: TcpListener,
    token: Arc<str>,
    backend: Arc<B>,
    active: Arc<AtomicBool>,
    on_activity: ActivitySink,
) {
    let limiter = Arc::new(Semaphore::new(MAX_CONCURRENT_CALLS));
    loop {
        let stream = match listener.accept().await {
            Ok((stream, peer)) if peer.ip().is_loopback() => stream,
            Ok(_) => continue,
            Err(error) => {
                log::warn!("MCP server accept failed: {}", error);
                tokio::time::sleep(Duration::from_millis(200)).await;
                continue;
            }
        };
        let (token, backend, active, limiter, on_activity) =
            (token.clone(), backend.clone(), active.clone(), limiter.clone(), on_activity.clone());
        tokio::spawn(async move {
            if let Some(activity) = handle_connection(stream, &token, backend.as_ref(), &active, &limiter).await {
                on_activity(activity);
            }
        });
    }
}

async fn respond(writer: &mut OwnedWriteHalf, text: impl Into<String>, is_error: bool) {
    let response = BridgeResponse { text: text.into(), is_error };
    if let Ok(mut line) = serde_json::to_string(&response) {
        line.push('\n');
        let _ = writer.write_all(line.as_bytes()).await;
        let _ = writer.shutdown().await;
    }
}

async fn handle_connection<B: McpBackend>(
    stream: TcpStream,
    token: &str,
    backend: &B,
    active: &AtomicBool,
    limiter: &Semaphore,
) -> Option<McpActivity> {
    let (read_half, mut writer) = stream.into_split();
    let mut reader = BufReader::new(read_half.take(MAX_REQUEST_BYTES));
    let mut line = String::new();
    match tokio::time::timeout(REQUEST_READ_TIMEOUT, reader.read_line(&mut line)).await {
        Ok(Ok(read)) if read > 0 => {}
        _ => return None,
    }
    // Anything else on this port, such as a browser's HTTP request, fails here.
    let Ok(request) = serde_json::from_str::<BridgeRequest>(line.trim_end()) else {
        respond(&mut writer, "Bad request.", true).await;
        return None;
    };
    if !tokens_match(token, &request.token) {
        log::warn!("Rejected an MCP tool call with a wrong token.");
        respond(&mut writer, "Not authorized. Restart the AI client so it reads VeloxDB's current endpoint.", true).await;
        return None;
    }
    let client: String = request
        .client
        .as_deref()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .unwrap_or("MCP client")
        .chars()
        .take(60)
        .collect();
    let _permit = limiter.acquire().await.ok()?;
    let output = if active.load(Ordering::SeqCst) {
        tokio::time::timeout(CALL_TIMEOUT, call_tool(backend, &request.tool, &request.arguments, &client))
            .await
            .unwrap_or_else(|_| ToolOutput::error("VeloxDB took too long to answer. Try a narrower query."))
    } else {
        ToolOutput::error("AI tools were just turned off in VeloxDB.")
    };
    respond(&mut writer, output.text.clone(), output.is_error).await;
    Some(McpActivity {
        at_ms: now_ms(),
        client,
        tool: request.tool,
        connection: output.connection_name,
        summary: output.summary,
        ok: !output.is_error,
    })
}

// ── App integration ─────────────────────────────────────────────

/// The tools' view of the running app: saved connections, the shared
/// catalog cache and pools, and the editor.
pub(crate) struct TauriBackend {
    app: AppHandle,
}

impl McpBackend for TauriBackend {
    fn connections(&self) -> Result<Vec<ConnectionSummary>, String> {
        crate::db::list_connections(&self.app).map_err(String::from)
    }

    async fn catalog(
        &self,
        connection_id: &str,
        engine: DatabaseEngine,
        refresh: bool,
    ) -> Result<AskVeloxyDbContextCache, String> {
        let state = self.app.state::<AppState>();
        if refresh {
            let prefix = format!("{}::", connection_id);
            state.ask_veloxy_db_context_cache.write().await.retain(|key, _| !key.starts_with(&prefix));
        }
        crate::commands::get_or_build_ask_veloxy_db_context(&self.app, &state, connection_id, engine).await
    }

    async fn run_readonly(
        &self,
        connection_id: &str,
        engine: DatabaseEngine,
        sql: &str,
        kind: AgentStatement,
        max_rows: usize,
        timeout_ms: u64,
    ) -> Result<QueryResult, String> {
        let state = self.app.state::<AppState>();
        crate::engines::run_agent_readonly(&self.app, &state, connection_id, engine, sql, kind, max_rows, timeout_ms)
            .await
            .map_err(String::from)
    }

    fn open_in_editor(&self, request: OpenInEditorRequest) -> Result<(), String> {
        self.app.emit(OPEN_IN_EDITOR_EVENT, &request).map_err(|error| error.to_string())?;
        if let Some(window) = self.app.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
        Ok(())
    }
}

struct RunningServer {
    token: String,
    endpoint_path: PathBuf,
    active: Arc<AtomicBool>,
    task: tauri::async_runtime::JoinHandle<()>,
}

/// App-wide MCP server state, managed by Tauri.
#[derive(Default)]
pub struct McpState {
    running: Mutex<Option<RunningServer>>,
    activity: StdMutex<VecDeque<McpActivity>>,
}

impl McpState {
    /// Starts listening and publishes the endpoint file. Does nothing when
    /// already running.
    pub(crate) async fn start(&self, app: &AppHandle) -> Result<(), String> {
        let mut running = self.running.lock().await;
        if running.is_some() {
            return Ok(());
        }
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
            .await
            .map_err(|error| format!("Could not start the MCP server: {}", error))?;
        let port = listener.local_addr().map_err(|error| error.to_string())?.port();
        let token = generate_token();
        let endpoint_path = app.path().app_data_dir().map_err(|error| error.to_string())?.join(ENDPOINT_FILE);
        write_endpoint(
            &endpoint_path,
            &Endpoint { version: ENDPOINT_VERSION, port, token: token.clone(), pid: std::process::id() },
        )
        .map_err(|error| format!("Could not write {}: {}", endpoint_path.display(), error))?;

        let sink_app = app.clone();
        let on_activity: ActivitySink = Arc::new(move |activity: McpActivity| {
            if let Some(state) = sink_app.try_state::<McpState>() {
                state.record(activity.clone());
            }
            let _ = sink_app.emit(ACTIVITY_EVENT, &activity);
        });
        let active = Arc::new(AtomicBool::new(true));
        let task = tauri::async_runtime::spawn(serve(
            listener,
            Arc::from(token.as_str()),
            Arc::new(TauriBackend { app: app.clone() }),
            active.clone(),
            on_activity,
        ));
        log::info!("MCP server listening on 127.0.0.1:{}", port);
        *running = Some(RunningServer { token, endpoint_path, active, task });
        Ok(())
    }

    /// Stops accepting calls and removes the endpoint file.
    pub(crate) async fn stop(&self) {
        if let Some(server) = self.running.lock().await.take() {
            server.active.store(false, Ordering::SeqCst);
            server.task.abort();
            remove_endpoint(&server.endpoint_path, &server.token);
        }
    }

    pub(crate) async fn is_running(&self) -> bool {
        self.running.lock().await.is_some()
    }

    fn record(&self, activity: McpActivity) {
        if let Ok(mut log) = self.activity.lock() {
            log.push_front(activity);
            log.truncate(ACTIVITY_LIMIT);
        }
    }

    /// Recent tool calls, newest first.
    pub(crate) fn activity(&self) -> Vec<McpActivity> {
        self.activity.lock().map(|log| log.iter().cloned().collect()).unwrap_or_default()
    }

    pub(crate) fn clear_activity(&self) {
        if let Ok(mut log) = self.activity.lock() {
            log.clear();
        }
    }
}

/// The app-level switch. Off unless the user turned it on.
pub(crate) fn is_enabled(app: &AppHandle) -> bool {
    app.store(SETTINGS_STORE)
        .ok()
        .and_then(|store| store.get(ENABLED_KEY))
        .and_then(|value| value.as_bool())
        .unwrap_or(false)
}

pub(crate) fn save_enabled(app: &AppHandle, enabled: bool) -> Result<(), String> {
    let store = app.store(SETTINGS_STORE).map_err(|error| error.to_string())?;
    store.set(ENABLED_KEY, json!(enabled));
    store.save().map_err(|error| error.to_string())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::mcp::tools::tests::FakeBackend;

    /// A server on a random port with the fake backend.
    pub(crate) async fn start_fake_server(
        token: &str,
    ) -> (u16, Arc<AtomicBool>, Arc<StdMutex<Vec<McpActivity>>>, tokio::task::JoinHandle<()>) {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.expect("bind");
        let port = listener.local_addr().unwrap().port();
        let seen = Arc::new(StdMutex::new(Vec::new()));
        let sink_seen = seen.clone();
        let active = Arc::new(AtomicBool::new(true));
        let task = tokio::spawn(serve(
            listener,
            Arc::from(token),
            Arc::new(FakeBackend::new().await),
            active.clone(),
            Arc::new(move |activity| sink_seen.lock().unwrap().push(activity)),
        ));
        (port, active, seen, task)
    }

    async fn send_raw(port: u16, line: &str) -> String {
        let mut stream = TcpStream::connect((Ipv4Addr::LOCALHOST, port)).await.expect("connect");
        stream.write_all(line.as_bytes()).await.unwrap();
        let mut response = String::new();
        BufReader::new(stream).read_line(&mut response).await.unwrap();
        response
    }

    fn request(token: &str, tool: &str, arguments: serde_json::Value) -> String {
        let mut line = serde_json::to_string(&BridgeRequest {
            token: token.to_string(),
            client: Some("claude-code".into()),
            tool: tool.into(),
            arguments,
        })
        .unwrap();
        line.push('\n');
        line
    }

    #[tokio::test]
    async fn runs_calls_with_the_right_token_and_logs_them() {
        let token = generate_token();
        let (port, _active, seen, task) = start_fake_server(&token).await;
        let response = send_raw(port, &request(&token, "list_connections", json!({}))).await;
        let response: BridgeResponse = serde_json::from_str(&response).unwrap();
        assert!(!response.is_error, "{}", response.text);
        assert!(response.text.contains("\"shared\""));
        tokio::time::sleep(Duration::from_millis(50)).await;
        let seen = seen.lock().unwrap();
        assert_eq!(seen.len(), 1);
        assert_eq!(seen[0].client, "claude-code");
        assert_eq!(seen[0].tool, "list_connections");
        task.abort();
    }

    #[tokio::test]
    async fn rejects_wrong_tokens_and_non_protocol_traffic() {
        let token = generate_token();
        let (port, _active, seen, task) = start_fake_server(&token).await;
        let wrong = send_raw(port, &request(&generate_token(), "list_connections", json!({}))).await;
        let wrong: BridgeResponse = serde_json::from_str(&wrong).unwrap();
        assert!(wrong.is_error);
        assert!(wrong.text.contains("Not authorized"));

        let http = send_raw(port, "GET / HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n").await;
        let http: BridgeResponse = serde_json::from_str(&http).unwrap();
        assert!(http.is_error);
        assert_eq!(http.text, "Bad request.");
        assert!(seen.lock().unwrap().is_empty(), "rejected calls are not run");
        task.abort();
    }

    #[tokio::test]
    async fn refuses_calls_once_turned_off() {
        let token = generate_token();
        let (port, active, _seen, task) = start_fake_server(&token).await;
        active.store(false, Ordering::SeqCst);
        let response = send_raw(port, &request(&token, "list_connections", json!({}))).await;
        let response: BridgeResponse = serde_json::from_str(&response).unwrap();
        assert!(response.is_error);
        assert!(response.text.contains("turned off"));
        task.abort();
    }
}
