// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
  // AI clients launch `veloxdb --mcp` as an MCP server over stdio. That
  // process only bridges to the running app; it never opens a window.
  if std::env::args_os().skip(1).any(|arg| arg == veloxdb_lib::mcp::MCP_FLAG) {
    std::process::exit(veloxdb_lib::mcp::run_stdio_bridge());
  }
  veloxdb_lib::run();
}
