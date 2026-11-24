//! The MCP side of the `--mcp` bridge: JSON-RPC 2.0 over stdio, one message
//! per line. The bridge answers `initialize`, `ping` and `tools/list` itself
//! and hands each `tools/call` to the running app, so a client connects fine
//! even while the app is closed and gets a clear error per call instead.

use serde_json::{json, Value};

use super::tools::{is_known_tool, tool_definitions};

pub(crate) const SERVER_NAME: &str = "veloxdb";
/// Newest first; the first is offered when the client asks for another one.
pub(crate) const PROTOCOL_VERSIONS: &[&str] = &["2025-06-18", "2025-03-26", "2024-11-05"];

const INSTRUCTIONS: &str = "VeloxDB gives read-only access to the databases the user shared with AI tools. \
Start with list_connections, read the schema with get_schema, then query with run_readonly_query \
(explain_query shows a plan without running). The database enforces read-only; nothing you run can \
change data. To propose a write (INSERT, UPDATE, DELETE, DDL), call open_in_editor: it opens the SQL \
in VeloxDB for the user to review and run.";

const PARSE_ERROR: i64 = -32700;
const INVALID_REQUEST: i64 = -32600;
const METHOD_NOT_FOUND: i64 = -32601;
const INVALID_PARAMS: i64 = -32602;

#[derive(Debug, Default)]
pub(crate) struct Session {
    client_name: Option<String>,
}

impl Session {
    /// The client's name from `initialize`, for the app's activity list.
    pub(crate) fn client_name(&self) -> String {
        self.client_name.clone().unwrap_or_else(|| "MCP client".to_string())
    }
}

#[derive(Debug, PartialEq)]
pub(crate) enum Handled {
    /// Write this message back to the client.
    Reply(Value),
    /// Ask the app to run this tool, then reply with [`tool_result`].
    CallTool { id: Value, name: String, arguments: Value },
    /// Notifications and stray responses need no answer.
    Ignore,
}

pub(crate) fn result(id: Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

pub(crate) fn error(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

pub(crate) fn tool_result(id: Value, text: String, is_error: bool) -> Value {
    result(
        id,
        json!({ "content": [{ "type": "text", "text": text }], "isError": is_error }),
    )
}

pub(crate) fn handle_line(session: &mut Session, line: &str) -> Handled {
    let message: Value = match serde_json::from_str(line) {
        Ok(message) => message,
        Err(_) => return Handled::Reply(error(Value::Null, PARSE_ERROR, "Parse error")),
    };
    if message.is_array() {
        return Handled::Reply(error(Value::Null, INVALID_REQUEST, "Batch requests are not supported."));
    }
    let Some(object) = message.as_object() else {
        return Handled::Reply(error(Value::Null, INVALID_REQUEST, "Invalid request"));
    };
    let method = object.get("method").and_then(Value::as_str);
    match (object.get("id").cloned(), method) {
        (Some(id), Some(method)) => handle_request(session, id, method, object.get("params")),
        _ => Handled::Ignore,
    }
}

fn handle_request(session: &mut Session, id: Value, method: &str, params: Option<&Value>) -> Handled {
    match method {
        "initialize" => {
            let params = params.cloned().unwrap_or_default();
            session.client_name = params["clientInfo"]["name"].as_str().map(str::to_string);
            let requested = params["protocolVersion"].as_str().unwrap_or_default();
            let version = PROTOCOL_VERSIONS
                .iter()
                .find(|version| **version == requested)
                .copied()
                .unwrap_or(PROTOCOL_VERSIONS[0]);
            Handled::Reply(result(
                id,
                json!({
                    "protocolVersion": version,
                    "capabilities": { "tools": { "listChanged": false } },
                    "serverInfo": {
                        "name": SERVER_NAME,
                        "title": "VeloxDB",
                        "version": env!("CARGO_PKG_VERSION"),
                    },
                    "instructions": INSTRUCTIONS,
                }),
            ))
        }
        "ping" => Handled::Reply(result(id, json!({}))),
        "tools/list" => Handled::Reply(result(id, json!({ "tools": tool_definitions() }))),
        "tools/call" => {
            let params = params.cloned().unwrap_or_default();
            let Some(name) = params["name"].as_str() else {
                return Handled::Reply(error(id, INVALID_PARAMS, "Invalid params: name is required."));
            };
            if !is_known_tool(name) {
                return Handled::Reply(error(id, INVALID_PARAMS, &format!("Unknown tool: {}", name)));
            }
            let arguments = match &params["arguments"] {
                Value::Null => json!({}),
                arguments => arguments.clone(),
            };
            Handled::CallTool { id, name: name.to_string(), arguments }
        }
        _ => Handled::Reply(error(id, METHOD_NOT_FOUND, "Method not found")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reply(handled: Handled) -> Value {
        match handled {
            Handled::Reply(value) => value,
            other => panic!("expected a reply, got {other:?}"),
        }
    }

    #[test]
    fn initialize_negotiates_the_protocol_version_and_names_the_client() {
        let mut session = Session::default();
        let response = reply(handle_line(
            &mut session,
            r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"claude-code","version":"2.0"}}}"#,
        ));
        assert_eq!(response["id"], 1);
        assert_eq!(response["result"]["protocolVersion"], "2025-03-26");
        assert_eq!(response["result"]["serverInfo"]["name"], SERVER_NAME);
        assert!(response["result"]["capabilities"]["tools"].is_object());
        assert_eq!(session.client_name(), "claude-code");

        let response = reply(handle_line(
            &mut session,
            r#"{"jsonrpc":"2.0","id":"a","method":"initialize","params":{"protocolVersion":"1999-01-01"}}"#,
        ));
        assert_eq!(response["id"], "a");
        assert_eq!(response["result"]["protocolVersion"], PROTOCOL_VERSIONS[0]);
    }

    #[test]
    fn lists_tools_and_answers_ping() {
        let mut session = Session::default();
        let tools = reply(handle_line(&mut session, r#"{"jsonrpc":"2.0","id":2,"method":"tools/list"}"#));
        assert_eq!(tools["result"]["tools"].as_array().unwrap().len(), 5);
        let pong = reply(handle_line(&mut session, r#"{"jsonrpc":"2.0","id":3,"method":"ping"}"#));
        assert_eq!(pong["result"], json!({}));
    }

    #[test]
    fn tool_calls_are_forwarded_with_their_arguments() {
        let mut session = Session::default();
        let handled = handle_line(
            &mut session,
            r#"{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"run_readonly_query","arguments":{"connection_id":"c","sql":"select 1"}}}"#,
        );
        assert_eq!(
            handled,
            Handled::CallTool {
                id: json!(4),
                name: "run_readonly_query".into(),
                arguments: json!({ "connection_id": "c", "sql": "select 1" }),
            }
        );
        let handled = handle_line(&mut session, r#"{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"list_connections"}}"#);
        assert_eq!(handled, Handled::CallTool { id: json!(5), name: "list_connections".into(), arguments: json!({}) });
    }

    #[test]
    fn rejects_unknown_tools_methods_and_bad_json() {
        let mut session = Session::default();
        let unknown = reply(handle_line(&mut session, r#"{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"drop_everything"}}"#));
        assert_eq!(unknown["error"]["code"], INVALID_PARAMS);
        let missing = reply(handle_line(&mut session, r#"{"jsonrpc":"2.0","id":7,"method":"resources/list"}"#));
        assert_eq!(missing["error"]["code"], METHOD_NOT_FOUND);
        let bad = reply(handle_line(&mut session, "{not json"));
        assert_eq!(bad["error"]["code"], PARSE_ERROR);
        let batch = reply(handle_line(&mut session, "[]"));
        assert_eq!(batch["error"]["code"], INVALID_REQUEST);
    }

    #[test]
    fn notifications_get_no_reply() {
        let mut session = Session::default();
        assert_eq!(handle_line(&mut session, r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#), Handled::Ignore);
        assert_eq!(handle_line(&mut session, r#"{"jsonrpc":"2.0","id":9,"result":{}}"#), Handled::Ignore);
    }

    #[test]
    fn tool_results_use_text_content() {
        let value = tool_result(json!(8), "hi".into(), true);
        assert_eq!(value["result"]["content"][0], json!({ "type": "text", "text": "hi" }));
        assert_eq!(value["result"]["isError"], true);
    }
}
