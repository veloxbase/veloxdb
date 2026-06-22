use uuid::Uuid;
use tauri::{AppHandle, State};

use crate::db::{
    build_mysql_pool, build_mysql_pool_custom, build_mongo_connection_string, build_pool, build_pool_custom, build_sqlite_pool,
    disconnect_connection, drop_pool, get_or_create_mongo_client, get_or_create_mysql_pool, get_or_create_sqlite_pool,
    load_connection, persist_connection_with_password, refresh_connection_pools,
    resolve_connection_engine, with_pool_client_retry, AppState, DEFAULT_MYSQL_PORT,
};
use mongodb::bson::doc;
use crate::credentials;
use crate::models::{
    ConnectionInput, ConnectionSummary, DatabaseEngine, DatabaseInfo,
    StoredConnection, SwitchDatabaseRequest,
};
use crate::pg_error::map_pg_err;
use crate::ssh_tunnel::SshTunnel;

use super::mysql_database_name_from_row;

#[tauri::command]
pub async fn connect_db(
    app: AppHandle,
    state: State<'_, AppState>,
    input: ConnectionInput,
) -> Result<ConnectionSummary, String> {
    let connection_id = input.id.clone().unwrap_or_else(|| Uuid::new_v4().to_string());

    match input.engine {
        DatabaseEngine::Postgres => {
            let pool = if let Some(ref ssh_config) = input.ssh_config {
                if ssh_config.is_active() {
                    let tunnel = match SshTunnel::connect(ssh_config, &input.host, input.port).await {
                        Ok(tunnel) => tunnel,
                        Err(e) => return Err(format!("SSH tunnel failed: {}", e)),
                    };
                    let local_port = tunnel.local_port;
                    state.ssh_tunnels.write().await.insert(connection_id.clone(), tunnel);
                    build_pool_custom("127.0.0.1", local_port, &input)?
                } else {
                    build_pool(&input)?
                }
            } else {
                build_pool(&input)?
            };

            let client = match pool.get().await {
                Ok(client) => client,
                Err(e) => {
                    drop_pool(&state, &connection_id).await;
                    return Err(e.to_string());
                }
            };

            if let Err(e) = client.simple_query("select 1").await {
                drop_pool(&state, &connection_id).await;
                return Err(map_pg_err(e, None));
            }

            state.pools.write().await.insert(connection_id.clone(), pool);
        }
        DatabaseEngine::Mysql => {
            let pool = if let Some(ref ssh_config) = input.ssh_config {
                if ssh_config.is_active() {
                    let remote_port = if input.port == 0 { DEFAULT_MYSQL_PORT } else { input.port };
                    let tunnel = match SshTunnel::connect(ssh_config, &input.host, remote_port).await {
                        Ok(tunnel) => tunnel,
                        Err(e) => return Err(format!("SSH tunnel failed: {}", e)),
                    };
                    let local_port = tunnel.local_port;
                    state.ssh_tunnels.write().await.insert(connection_id.clone(), tunnel);
                    build_mysql_pool_custom("127.0.0.1", local_port, &input).await?
                } else {
                    build_mysql_pool(&input).await?
                }
            } else {
                build_mysql_pool(&input).await?
            };

            sqlx::query("select 1").execute(&pool).await.map_err(|e| e.to_string())?;
            state.mysql_pools.write().await.insert(connection_id.clone(), pool);
        }
        DatabaseEngine::Sqlite => {
            let pool = build_sqlite_pool(&input).await?;
            sqlx::query("select 1").execute(&pool).await.map_err(|e| e.to_string())?;
            state.sqlite_pools.write().await.insert(connection_id.clone(), pool);
        }
        DatabaseEngine::Mongo => {
            let uri = build_mongo_connection_string(&input);
            let client = mongodb::Client::with_uri_str(&uri)
                .await
                .map_err(|e| format!("MongoDB connection failed: {}", e))?;
            client
                .database("admin")
                .run_command(doc! { "ping": 1 })
                .await
                .map_err(|e| format!("MongoDB ping failed: {}", e))?;
            state.mongo_clients.write().await.insert(connection_id.clone(), client);
        }
    }

    let stored_connection = StoredConnection::from_input(connection_id.clone(), input.clone());
    persist_connection_with_password(&app, &stored_connection, &input.password)?;

    *state.active_connection_id.write().await = Some(connection_id);

    Ok(stored_connection.summary())
}

#[tauri::command]
pub async fn list_connections_command(app: AppHandle) -> Result<Vec<ConnectionSummary>, String> {
    crate::db::list_connections(&app)
}

#[tauri::command]
pub async fn set_active_connection(
    app: AppHandle,
    state: State<'_, AppState>,
    connection_id: String,
) -> Result<ConnectionSummary, String> {
    let stored_connection = load_connection(&app, &connection_id)?
        .ok_or_else(|| "Stored connection details were not found.".to_string())?;

    match stored_connection.engine {
        DatabaseEngine::Postgres => {
            with_pool_client_retry(&app, &state, &connection_id, (), |client, ()| async move {
                client.simple_query("select 1").await
                    .map_err(|error| map_pg_err(error, None))?;
                Ok(())
            }).await?;
        }
        DatabaseEngine::Mysql => {
            let pool = get_or_create_mysql_pool(&app, &state, &connection_id).await?;
            sqlx::query("select 1").execute(&pool).await.map_err(|error| error.to_string())?;
        }
        DatabaseEngine::Sqlite => {
            let pool = get_or_create_sqlite_pool(&app, &state, &connection_id).await?;
            sqlx::query("select 1").execute(&pool).await.map_err(|error| error.to_string())?;
        }
        DatabaseEngine::Mongo => {
            let client = get_or_create_mongo_client(&app, &state, &connection_id).await?;
            client.database("admin").run_command(doc! { "ping": 1 }).await
                .map_err(|e| format!("MongoDB ping failed: {}", e))?;
        }
    }

    *state.active_connection_id.write().await = Some(connection_id);
    Ok(stored_connection.summary())
}

#[tauri::command]
pub async fn ping_connection(
    app: AppHandle,
    state: State<'_, AppState>,
    connection_id: String,
) -> Result<(), String> {
    let stored_connection = load_connection(&app, &connection_id)?
        .ok_or_else(|| "Stored connection details were not found.".to_string())?;
    match stored_connection.engine {
        DatabaseEngine::Postgres => {
            with_pool_client_retry(&app, &state, &connection_id, (), |client, ()| async move {
                client.simple_query("select 1").await.map_err(|error| error.to_string())?;
                Ok(())
            }).await
        }
        DatabaseEngine::Mysql => {
            let pool = get_or_create_mysql_pool(&app, &state, &connection_id).await?;
            sqlx::query("select 1").execute(&pool).await.map_err(|error| error.to_string())?;
            Ok(())
        }
        DatabaseEngine::Sqlite => {
            let pool = get_or_create_sqlite_pool(&app, &state, &connection_id).await?;
            sqlx::query("select 1").execute(&pool).await.map_err(|error| error.to_string())?;
            Ok(())
        }
        DatabaseEngine::Mongo => {
            let client = get_or_create_mongo_client(&app, &state, &connection_id).await?;
            client.database("admin").run_command(doc! { "ping": 1 }).await
                .map_err(|error| error.to_string())?;
            Ok(())
        }
    }
}

#[tauri::command]
pub async fn refresh_connection(
    app: AppHandle,
    state: State<'_, AppState>,
    connection_id: String,
) -> Result<(), String> {
    refresh_connection_pools(&app, &state, &connection_id).await
}

#[tauri::command]
pub async fn disconnect_db(
    state: State<'_, AppState>,
    connection_id: String,
) -> Result<(), String> {
    disconnect_connection(&state, &connection_id).await;
    Ok(())
}

#[tauri::command]
pub async fn rename_connection(
    app: AppHandle,
    connection_id: String,
    new_name: String,
) -> Result<ConnectionSummary, String> {
    crate::db::rename_connection_in_store(&app, &connection_id, &new_name)
}

#[tauri::command]
pub async fn delete_connection(
    app: AppHandle,
    state: State<'_, AppState>,
    connection_id: String,
) -> Result<(), String> {
    disconnect_connection(&state, &connection_id).await;
    if let Err(e) = credentials::delete_password(&connection_id) {
        log::warn!("Failed to delete keychain entry for {}: {}", connection_id, e);
    }
    crate::db::delete_connection_from_store(&app, &connection_id)?;
    Ok(())
}

#[tauri::command]
pub async fn list_databases(
    app: AppHandle,
    state: State<'_, AppState>,
    connection_id: Option<String>,
) -> Result<Vec<DatabaseInfo>, String> {
    let (connection_id, engine) = resolve_connection_engine(&app, &state, connection_id).await?;

    match engine {
        DatabaseEngine::Postgres => {
            with_pool_client_retry(&app, &state, &connection_id, (), |client, ()| async move {
                let rows = client.query(
                    "select datname from pg_database \
                     where datistemplate = false and has_database_privilege(datname, 'CONNECT') \
                     order by datname",
                    &[],
                ).await.map_err(|error| map_pg_err(error, None))?;
                Ok(rows.into_iter().map(|row| {
                    let name: String = row.get(0);
                    DatabaseInfo { name }
                }).collect())
            }).await
        }
        DatabaseEngine::Mysql => {
            let pool = get_or_create_mysql_pool(&app, &state, &connection_id).await?;
            let rows = sqlx::query("show databases")
                .fetch_all(&pool).await.map_err(|error| error.to_string())?;
            let mut databases = Vec::with_capacity(rows.len());
            for row in rows {
                let name = mysql_database_name_from_row(&row, "list_databases")?;
                databases.push(DatabaseInfo { name });
            }
            Ok(databases)
        }
        DatabaseEngine::Sqlite => Ok(vec![DatabaseInfo { name: "main".to_string() }]),
        DatabaseEngine::Mongo => {
            let client = get_or_create_mongo_client(&app, &state, &connection_id).await?;
            let db_names = client.list_database_names().await
                .map_err(|e| format!("Failed to list MongoDB databases: {}", e))?;
            Ok(db_names.into_iter().map(|name| DatabaseInfo { name }).collect())
        }
    }
}

#[tauri::command]
pub async fn switch_database(
    app: AppHandle,
    state: State<'_, AppState>,
    input: SwitchDatabaseRequest,
) -> Result<ConnectionSummary, String> {
    let mut stored_connection = load_connection(&app, &input.connection_id)?
        .ok_or_else(|| "Stored connection details were not found.".to_string())?;

    if stored_connection.engine == DatabaseEngine::Sqlite {
        return Err("Switch database is not supported for SQLite connections.".to_string());
    }

    drop_pool(&state, &input.connection_id).await;

    stored_connection.database = input.database.clone();
    stored_connection.connected_at = crate::models::timestamp_string();
    persist_connection_with_password(&app, &stored_connection, &stored_connection.password.clone().unwrap_or_default())?;

    let connection_input = stored_connection.to_input();

    match connection_input.engine {
        DatabaseEngine::Postgres => {
            let pool = if let Some(ref ssh_config) = connection_input.ssh_config {
                if ssh_config.is_active() {
                    let tunnel = match SshTunnel::connect(ssh_config, &connection_input.host, connection_input.port).await {
                        Ok(tunnel) => tunnel,
                        Err(e) => return Err(format!("SSH tunnel failed: {}", e)),
                    };
                    let local_port = tunnel.local_port;
                    state.ssh_tunnels.write().await.insert(input.connection_id.clone(), tunnel);
                    build_pool_custom("127.0.0.1", local_port, &connection_input)?
                } else {
                    build_pool(&connection_input)?
                }
            } else {
                build_pool(&connection_input)?
            };

            let client = match pool.get().await {
                Ok(client) => client,
                Err(e) => { drop_pool(&state, &input.connection_id).await; return Err(e.to_string()); }
            };

            if let Err(e) = client.simple_query("select 1").await {
                drop_pool(&state, &input.connection_id).await;
                return Err(map_pg_err(e, None));
            }

            state.pools.write().await.insert(input.connection_id.clone(), pool);
        }
        DatabaseEngine::Mysql => {
            let pool = if let Some(ref ssh_config) = connection_input.ssh_config {
                if ssh_config.is_active() {
                    let remote_port = if connection_input.port == 0 { DEFAULT_MYSQL_PORT } else { connection_input.port };
                    let tunnel = match SshTunnel::connect(ssh_config, &connection_input.host, remote_port).await {
                        Ok(tunnel) => tunnel,
                        Err(e) => return Err(format!("SSH tunnel failed: {}", e)),
                    };
                    let local_port = tunnel.local_port;
                    state.ssh_tunnels.write().await.insert(input.connection_id.clone(), tunnel);
                    build_mysql_pool_custom("127.0.0.1", local_port, &connection_input).await?
                } else {
                    build_mysql_pool(&connection_input).await?
                }
            } else {
                build_mysql_pool(&connection_input).await?
            };

            sqlx::query("select 1").execute(&pool).await.map_err(|e| e.to_string())?;
            state.mysql_pools.write().await.insert(input.connection_id.clone(), pool);
        }
        DatabaseEngine::Sqlite => {}
        DatabaseEngine::Mongo => {
            let client = get_or_create_mongo_client(&app, &state, &input.connection_id).await?;
            client.database(&input.database).run_command(doc! { "ping": 1 }).await
                .map_err(|e| format!("MongoDB ping failed: {}", e))?;
        }
    }

    *state.active_connection_id.write().await = Some(input.connection_id);
    Ok(stored_connection.summary())
}
