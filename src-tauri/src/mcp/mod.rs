//! MCP server: lets AI apps the user already has (Claude Desktop, Claude
//! Code, Cursor, VS Code) query their databases through VeloxDB, with no API
//! key in VeloxDB.
//!
//! ```text
//! AI client --stdio--> veloxdb --mcp --127.0.0.1 + token--> VeloxDB app --> databases
//!                      (bridge.rs)                          (server.rs, tools.rs)
//! ```
//!
//! - The client launches the VeloxDB executable with `--mcp`. That process
//!   speaks MCP, holds no credentials and runs no SQL: it forwards each tool
//!   call to the running app.
//! - The app listens on 127.0.0.1 only while it is open and "Let AI apps use
//!   VeloxDB" is on (off by default). The port and a token that changes every
//!   time the server starts go in a user-only file that the bridge reads, so
//!   client configs hold no secret.
//! - Tools see only connections with "Allow AI tools on this connection" on
//!   (off by default), run SQL only through the database-enforced read-only
//!   path, and never execute a write: `open_in_editor` puts SQL in a new
//!   editor tab for the user to review and run.

mod bridge;
mod commands;
mod endpoint;
mod protocol;
mod schema;
mod server;
mod tools;

pub use bridge::run_stdio_bridge;
pub use commands::{mcp_clear_activity, mcp_get_status, mcp_set_enabled, set_connection_ai_tools};
pub use server::McpState;

use tauri::{AppHandle, Manager};

/// The command-line flag that runs the stdio bridge instead of the app.
pub const MCP_FLAG: &str = "--mcp";

/// Starts the server at launch when the user left AI tools on.
pub fn start_if_enabled(app: &AppHandle) {
    if !server::is_enabled(app) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = app.state::<McpState>().start(&app).await {
            log::warn!("{}", error);
        }
    });
}

/// Stops the server and removes the endpoint file as the app exits.
pub fn shutdown(app: &AppHandle) {
    if let Some(state) = app.try_state::<McpState>() {
        tauri::async_runtime::block_on(state.stop());
    }
}
