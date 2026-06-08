mod commands;
mod credentials;
mod db;
mod export;
mod models;
mod pg_error;
mod sql_split;
mod ssh_tunnel;

use commands::{
  apply_table_properties, cancel_veloxy_request, chat_with_db, clear_veloxy_conversation, connect_db, delete_connection,
  delete_openrouter_api_key, disconnect_db, execute_ddl_statement, execute_ddl_transaction, export_diagram_png,
  export_results_csv_command, export_results_json_command, generate_sql_from_nl, get_foreign_keys,
  get_openrouter_api_key, get_query_editor_metadata, get_schema, get_table_indexes, get_table_properties, get_tables,
  lint_sql, list_connections_command, list_databases, load_veloxy_conversation, ping_connection,
  refresh_connection, rename_connection, run_query, save_base64_png, save_text_file, set_active_connection,
  store_openrouter_api_key, switch_database,
};
use db::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .manage(AppState::default())
    .plugin(tauri_plugin_store::Builder::default().build())
    .plugin(tauri_plugin_dialog::init())
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
      rename_connection,
      delete_connection,
      ping_connection,
      refresh_connection,
      list_connections_command,
      set_active_connection,
      list_databases,
      switch_database,
      run_query,
      get_tables,
      get_schema,
      get_table_properties,
      apply_table_properties,
      get_foreign_keys,
      get_table_indexes,
      execute_ddl_transaction,
      execute_ddl_statement,
      export_diagram_png,
      export_results_csv_command,
      export_results_json_command,
      get_query_editor_metadata,
      save_base64_png,
      save_text_file,
      lint_sql,
      generate_sql_from_nl,
      chat_with_db,
      cancel_veloxy_request,
      load_veloxy_conversation,
      clear_veloxy_conversation,
      store_openrouter_api_key,
      get_openrouter_api_key,
      delete_openrouter_api_key
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
