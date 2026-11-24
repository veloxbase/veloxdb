//! `veloxdb --mcp`: the process an AI client launches.
//!
//! It speaks MCP over stdin/stdout and never touches a database or a
//! credential. Each `tools/call` is forwarded to the running app over
//! 127.0.0.1, using the port and token the app published (see `endpoint`).
//! When the app is closed or AI tools are off, the client still connects and
//! each call returns a message saying how to turn them on.

use std::net::Ipv4Addr;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use tokio::task::JoinSet;

use super::endpoint::{default_endpoint_path, read_endpoint, BridgeRequest, BridgeResponse, MAX_RESPONSE_BYTES};
use super::protocol::{handle_line, tool_result, Handled, Session};
use super::tools::QUERY_TIMEOUT_MS;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
/// Longer than the app's own limit for a call, so the app's message wins.
const RESPONSE_TIMEOUT: Duration = Duration::from_millis(QUERY_TIMEOUT_MS + 60_000);
/// How long in-flight calls may finish after the client closes stdin.
const SHUTDOWN_GRACE: Duration = Duration::from_secs(5);

pub(crate) const APP_NOT_RUNNING: &str = "VeloxDB is not running, or its AI tools are turned off. \
Open VeloxDB and turn on Settings → Veloxy → AI tools → \"Let AI apps use VeloxDB\", then try again.";

/// `--endpoint <path>`: read the endpoint file from `path` instead of the
/// default data folder. The app adds it to copied configs only when its data
/// folder is not the default one (a build with another identifier).
pub(crate) const ENDPOINT_FLAG: &str = "--endpoint";

fn endpoint_path_from_args(args: &[std::ffi::OsString]) -> Option<PathBuf> {
    args.windows(2)
        .find(|pair| pair[0] == ENDPOINT_FLAG)
        .map(|pair| PathBuf::from(&pair[1]))
        .or_else(default_endpoint_path)
}

/// Entry point for `veloxdb --mcp`. Returns the process exit code.
pub fn run_stdio_bridge() -> i32 {
    let args: Vec<std::ffi::OsString> = std::env::args_os().collect();
    let endpoint_path = endpoint_path_from_args(&args);
    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(error) => {
            eprintln!("veloxdb --mcp: could not start: {}", error);
            return 1;
        }
    };
    runtime.block_on(bridge_loop(tokio::io::stdin(), tokio::io::stdout(), endpoint_path));
    0
}

/// Reads JSON-RPC lines from `input` until it closes, writing replies to
/// `output`. Tool calls run concurrently; replies may come back out of order,
/// matched by id as JSON-RPC allows.
pub(crate) async fn bridge_loop<R, W>(input: R, output: W, endpoint_path: Option<PathBuf>)
where
    R: AsyncRead + Unpin,
    W: AsyncWrite + Unpin + Send + 'static,
{
    let (sender, mut receiver) = mpsc::unbounded_channel::<Value>();
    let writer = tokio::spawn(async move {
        let mut output = output;
        while let Some(message) = receiver.recv().await {
            let mut line = message.to_string();
            line.push('\n');
            if output.write_all(line.as_bytes()).await.is_err() || output.flush().await.is_err() {
                break;
            }
        }
    });

    let mut session = Session::default();
    let mut calls = JoinSet::new();
    let mut lines = BufReader::new(input).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        if line.trim().is_empty() {
            continue;
        }
        match handle_line(&mut session, &line) {
            Handled::Reply(message) => {
                let _ = sender.send(message);
            }
            Handled::CallTool { id, name, arguments } => {
                let sender = sender.clone();
                let client = session.client_name();
                let endpoint_path = endpoint_path.clone();
                calls.spawn(async move {
                    let response = forward(endpoint_path.as_deref(), &client, &name, arguments).await;
                    let _ = sender.send(tool_result(id, response.text, response.is_error));
                });
            }
            Handled::Ignore => {}
        }
        // Reap finished calls so the set does not grow with the session.
        while calls.try_join_next().is_some() {}
    }

    let _ = tokio::time::timeout(SHUTDOWN_GRACE, async { while calls.join_next().await.is_some() {} }).await;
    calls.shutdown().await;
    drop(sender);
    let _ = writer.await;
}

/// Sends one tool call to the app. Failures become error results.
pub(crate) async fn forward(
    endpoint_path: Option<&Path>,
    client: &str,
    tool: &str,
    arguments: Value,
) -> BridgeResponse {
    try_forward(endpoint_path, client, tool, arguments)
        .await
        .unwrap_or_else(|text| BridgeResponse { text, is_error: true })
}

async fn try_forward(
    endpoint_path: Option<&Path>,
    client: &str,
    tool: &str,
    arguments: Value,
) -> Result<BridgeResponse, String> {
    let path = endpoint_path.ok_or("Could not find VeloxDB's data folder on this system.")?;
    // Read fresh for every call: the app writes a new port and token each
    // time its server starts.
    let endpoint = read_endpoint(path).map_err(|_| APP_NOT_RUNNING.to_string())?;
    let stream = tokio::time::timeout(CONNECT_TIMEOUT, TcpStream::connect((Ipv4Addr::LOCALHOST, endpoint.port)))
        .await
        .map_err(|_| APP_NOT_RUNNING.to_string())?
        .map_err(|_| APP_NOT_RUNNING.to_string())?;
    let (read_half, mut write_half) = stream.into_split();

    let request = BridgeRequest {
        token: endpoint.token,
        client: Some(client.to_string()),
        tool: tool.to_string(),
        arguments,
    };
    let mut line = serde_json::to_string(&request).map_err(|error| error.to_string())?;
    line.push('\n');
    write_half
        .write_all(line.as_bytes())
        .await
        .map_err(|error| format!("Could not reach VeloxDB: {}", error))?;

    let mut reader = BufReader::new(read_half.take(MAX_RESPONSE_BYTES));
    let mut response = String::new();
    tokio::time::timeout(RESPONSE_TIMEOUT, reader.read_line(&mut response))
        .await
        .map_err(|_| "VeloxDB did not answer in time.".to_string())?
        .map_err(|error| format!("Could not read VeloxDB's answer: {}", error))?;
    serde_json::from_str(response.trim_end()).map_err(|_| {
        "VeloxDB closed the connection without answering. Check that its AI tools are still on.".to_string()
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::mcp::endpoint::{generate_token, write_endpoint, Endpoint, ENDPOINT_FILE, ENDPOINT_VERSION};
    use crate::mcp::server::tests::start_fake_server;

    fn temp_endpoint_path() -> PathBuf {
        std::env::temp_dir().join(format!("veloxdb-bridge-{}", uuid::Uuid::new_v4())).join(ENDPOINT_FILE)
    }

    /// Runs the bridge over in-memory pipes: sends `lines`, returns the
    /// replies once the bridge exits.
    async fn run_bridge(endpoint_path: PathBuf, lines: &[Value]) -> Vec<Value> {
        let (mut client_in, bridge_in) = tokio::io::duplex(1 << 20);
        let (bridge_out, client_out) = tokio::io::duplex(1 << 20);
        let bridge = tokio::spawn(bridge_loop(bridge_in, bridge_out, Some(endpoint_path)));
        for line in lines {
            client_in.write_all(format!("{}\n", line).as_bytes()).await.unwrap();
        }
        drop(client_in);
        bridge.await.unwrap();
        let mut replies = Vec::new();
        let mut reader = BufReader::new(client_out).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            replies.push(serde_json::from_str(&line).unwrap());
        }
        replies
    }

    fn by_id(replies: &[Value], id: i64) -> &Value {
        replies.iter().find(|reply| reply["id"] == id).unwrap_or_else(|| panic!("no reply {id}: {replies:?}"))
    }

    #[test]
    fn endpoint_flag_overrides_the_default_path() {
        let args: Vec<std::ffi::OsString> = ["veloxdb", "--mcp", "--endpoint", "/tmp/x.json"].iter().map(Into::into).collect();
        assert_eq!(endpoint_path_from_args(&args), Some(PathBuf::from("/tmp/x.json")));
        let args: Vec<std::ffi::OsString> = ["veloxdb", "--mcp"].iter().map(Into::into).collect();
        assert_eq!(endpoint_path_from_args(&args), default_endpoint_path());
    }

    #[tokio::test]
    async fn end_to_end_through_the_app_server() {
        let token = generate_token();
        let (port, _active, seen, server) = start_fake_server(&token).await;
        let path = temp_endpoint_path();
        write_endpoint(&path, &Endpoint { version: ENDPOINT_VERSION, port, token, pid: 1 }).unwrap();

        let replies = run_bridge(path.clone(), &[
            json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","clientInfo":{"name":"claude-code"}}}),
            json!({"jsonrpc":"2.0","method":"notifications/initialized"}),
            json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}),
            json!({"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"run_readonly_query","arguments":{"connection_id":"shared","sql":"SELECT count(*) AS n FROM orders"}}}),
            json!({"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"run_readonly_query","arguments":{"connection_id":"shared","sql":"DELETE FROM orders"}}}),
        ]).await;

        assert_eq!(replies.len(), 4, "the notification gets no reply: {replies:?}");
        assert_eq!(by_id(&replies, 1)["result"]["serverInfo"]["name"], "veloxdb");
        assert_eq!(by_id(&replies, 2)["result"]["tools"].as_array().unwrap().len(), 5);

        let count = &by_id(&replies, 3)["result"];
        assert_eq!(count["isError"], false);
        let payload: Value = serde_json::from_str(count["content"][0]["text"].as_str().unwrap()).unwrap();
        assert_eq!(payload["rows"], json!([["3"]]));

        let refused = &by_id(&replies, 4)["result"];
        assert_eq!(refused["isError"], true);
        assert!(refused["content"][0]["text"].as_str().unwrap().contains("open_in_editor"));

        tokio::time::sleep(Duration::from_millis(50)).await;
        assert!(seen.lock().unwrap().iter().all(|activity| activity.client == "claude-code"));
        server.abort();
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[tokio::test]
    async fn tells_the_agent_to_open_the_app_when_it_is_not_running() {
        let path = temp_endpoint_path();
        let replies = run_bridge(path.clone(), &[
            json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}),
            json!({"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_connections"}}),
        ]).await;
        assert!(by_id(&replies, 1)["result"].is_object(), "initialize works without the app");
        let call = &by_id(&replies, 2)["result"];
        assert_eq!(call["isError"], true);
        assert_eq!(call["content"][0]["text"], APP_NOT_RUNNING);

        // A stale endpoint file from a closed app gives the same answer.
        write_endpoint(&path, &Endpoint { version: ENDPOINT_VERSION, port: 1, token: generate_token(), pid: 1 }).unwrap();
        let replies = run_bridge(path.clone(), &[
            json!({"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_connections"}}),
        ]).await;
        assert_eq!(by_id(&replies, 3)["result"]["content"][0]["text"], APP_NOT_RUNNING);
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }
}
