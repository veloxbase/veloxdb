mod commands;
mod credentials;
mod db;
mod models;
mod ssh_tunnel;

use commands::{
  apply_table_properties, connect_db, delete_connection, disconnect_db, execute_ddl_statement,
  execute_ddl_transaction, get_foreign_keys, get_query_editor_metadata, get_schema,
  get_table_indexes, get_table_properties, get_tables, lint_sql, list_connections_command,
  ping_connection, run_query, set_active_connection,
};
use db::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .manage(AppState::default())
    .plugin(tauri_plugin_store::Builder::default().build())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .on_window_event(|window, event| {
      if let tauri::WindowEvent::Destroyed = event {
        let handle = window.app_handle();
        let state: tauri::State<AppState> = handle.state();
        let mut tunnels = state.ssh_tunnels.blocking_write();
        for (_, mut tunnel) in tunnels.drain() {
          tauri::async_runtime::block_on(async {
            tunnel.close().await;
          });
        }
      }
    })
    .invoke_handler(tauri::generate_handler![
      connect_db,
      disconnect_db,
      delete_connection,
      ping_connection,
      list_connections_command,
      set_active_connection,
      run_query,
      get_tables,
      get_schema,
      get_table_properties,
      apply_table_properties,
      get_foreign_keys,
      get_table_indexes,
      execute_ddl_transaction,
      execute_ddl_statement,
      get_query_editor_metadata,
      lint_sql
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
