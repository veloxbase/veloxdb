use std::collections::HashMap;
use std::sync::OnceLock;
use std::time::Duration;

use deadpool_postgres::{
    Client, Config as PostgresConfig, ManagerConfig, Pool, PoolConfig, RecyclingMethod, Runtime,
    SslMode as DeadpoolSslMode, Timeouts,
};
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;
use tokio::sync::RwLock;
use tokio_postgres::NoTls;

use crate::models::{ConnectionInput, ConnectionSslMode, ConnectionSummary, StoredConnection};
use crate::ssh_tunnel::SshTunnel;
use crate::credentials;

pub const CONNECTION_STORE_PATH: &str = "connections.json";
pub const MAX_QUERY_ROWS: usize = 1000;

const APP_NAME: &str = "VeloxDB";
const CONNECT_TIMEOUT_SECS: u64 = 12;
const KEEPALIVES_IDLE_SECS: u64 = 60;
const POOL_MAX_SIZE: usize = 6;
const POOL_WAIT_SECS: u64 = 30;
const POOL_CREATE_SECS: u64 = 15;
const POOL_RECYCLE_SECS: u64 = 15;

fn deadpool_ssl_mode(mode: ConnectionSslMode) -> DeadpoolSslMode {
    match mode {
        ConnectionSslMode::Disable => DeadpoolSslMode::Disable,
        ConnectionSslMode::Prefer => DeadpoolSslMode::Prefer,
        ConnectionSslMode::Require => DeadpoolSslMode::Require,
    }
}

#[derive(Default)]
pub struct AppState {
    pub pools: RwLock<HashMap<String, Pool>>,
    pub active_connection_id: RwLock<Option<String>>,
    pub ssh_tunnels: RwLock<HashMap<String, SshTunnel>>,
}

fn tls_connector() -> Result<tokio_postgres_rustls::MakeRustlsConnect, String> {
    static CACHE: OnceLock<Result<tokio_postgres_rustls::MakeRustlsConnect, String>> = OnceLock::new();
    CACHE
        .get_or_init(|| {
            let mut root_store = rustls::RootCertStore::empty();
            root_store.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
            let config = rustls::ClientConfig::builder()
                .with_root_certificates(root_store)
                .with_no_client_auth();
            Ok(tokio_postgres_rustls::MakeRustlsConnect::new(config))
        })
        .clone()
}

pub fn build_pool_custom(host: &str, port: u16, input: &ConnectionInput) -> Result<Pool, String> {
    let mut config = PostgresConfig::new();
    config.host = Some(host.to_string());
    config.port = Some(port);
    config.dbname = Some(input.database.clone());
    config.user = Some(input.user.clone());
    config.password = Some(input.password.clone());
    config.application_name = Some(APP_NAME.to_string());
    config.connect_timeout = Some(Duration::from_secs(CONNECT_TIMEOUT_SECS));
    config.keepalives = Some(true);
    config.keepalives_idle = Some(Duration::from_secs(KEEPALIVES_IDLE_SECS));
    config.ssl_mode = Some(deadpool_ssl_mode(input.ssl_mode));
    config.manager = Some(ManagerConfig {
        recycling_method: RecyclingMethod::Verified,
    });

    let mut pool_config = PoolConfig::new(POOL_MAX_SIZE);
    pool_config.timeouts = Timeouts {
        wait: Some(Duration::from_secs(POOL_WAIT_SECS)),
        create: Some(Duration::from_secs(POOL_CREATE_SECS)),
        recycle: Some(Duration::from_secs(POOL_RECYCLE_SECS)),
    };
    config.pool = Some(pool_config);

    match input.ssl_mode {
        ConnectionSslMode::Disable => config
            .create_pool(Some(Runtime::Tokio1), NoTls)
            .map_err(|error| error.to_string()),
        ConnectionSslMode::Prefer | ConnectionSslMode::Require => {
            let tls = tls_connector()?;
            config
                .create_pool(Some(Runtime::Tokio1), tls)
                .map_err(|error| error.to_string())
        }
    }
}

pub fn build_pool(input: &ConnectionInput) -> Result<Pool, String> {
    build_pool_custom(&input.host, input.port, input)
}

/// Heuristic for transport-level failures where discarding the pool and opening
/// a new TCP session may succeed (sleep/VPN blips, idle disconnects).
fn is_retryable_connection_error(message: &str) -> bool {
    let m = message.to_lowercase();
    m.contains("broken pipe")
        || m.contains("connection reset")
        || m.contains("connection refused")
        || m.contains("unexpected eof")
        || m.contains("unexpected end of file")
        || m.contains("error communicating with the server")
        || m.contains("connection closed")
        || m.contains("closed the connection")
        || m.contains("server closed the connection")
        || m.contains("eof has been reached")
        || m.contains("could not receive data from server")
        || m.contains("could not send data to server")
        || m.contains("timeout occurred while waiting")
        || m.contains("timeout occurred while creating")
        || m.contains("timeout occurred while recycling")
}

pub async fn drop_pool(state: &AppState, connection_id: &str) {
    state.pools.write().await.remove(connection_id);
    if let Some(mut tunnel) = state.ssh_tunnels.write().await.remove(connection_id) {
        tunnel.close().await;
    }
}

pub async fn disconnect_connection(state: &AppState, connection_id: &str) {
    drop_pool(state, connection_id).await;
    if let Err(e) = credentials::delete_password(connection_id) {
        log::warn!("Failed to delete keychain entry for {}: {}", connection_id, e);
    }
    let mut active = state.active_connection_id.write().await;
    if active.as_deref() == Some(connection_id) {
        *active = None;
    }
}

/// Runs `operation` with a pooled client. On a retryable connection error, drops
/// the cached pool once and retries the whole operation (at most one extra attempt).
pub async fn with_pool_client_retry<T, C, F, Fut>(
    app: &AppHandle,
    state: &AppState,
    connection_id: &str,
    ctx: C,
    mut operation: F,
) -> Result<T, String>
where
    C: Clone + Send,
    F: FnMut(Client, C) -> Fut,
    Fut: std::future::Future<Output = Result<T, String>> + Send,
    T: Send,
{
    let mut dropped_pool = false;

    loop {
        let pool = get_or_create_pool(app, state, connection_id).await?;
        let client = match pool.get().await {
            Ok(client) => client,
            Err(error) => {
                let message = error.to_string();
                if !dropped_pool && is_retryable_connection_error(&message) {
                    drop_pool(state, connection_id).await;
                    dropped_pool = true;
                    continue;
                }
                return Err(message);
            }
        };

        match operation(client, ctx.clone()).await {
            Ok(value) => return Ok(value),
            Err(message) => {
                if !dropped_pool && is_retryable_connection_error(&message) {
                    drop_pool(state, connection_id).await;
                    dropped_pool = true;
                    continue;
                }
                return Err(message);
            }
        }
    }
}

pub async fn resolve_connection_id(
    state: &AppState,
    requested_connection_id: Option<String>,
) -> Result<String, String> {
    if let Some(connection_id) = requested_connection_id {
        return Ok(connection_id);
    }

    state
        .active_connection_id
        .read()
        .await
        .clone()
        .ok_or_else(|| "Connect to a database before running this action.".to_string())
}

pub async fn get_or_create_pool(
    app: &AppHandle,
    state: &AppState,
    connection_id: &str,
) -> Result<Pool, String> {
    if let Some(pool) = state.pools.read().await.get(connection_id).cloned() {
        return Ok(pool);
    }

    let stored_connection = load_connection(app, connection_id)?
        .ok_or_else(|| "Stored connection details were not found.".to_string())?;

    let input = stored_connection.to_input();

    let (host, port) = if let Some(ref ssh_config) = input.ssh_config {
        if ssh_config.is_active() {
            let tunnel = SshTunnel::connect(ssh_config, &input.host, input.port).await?;
            let local_port = tunnel.local_port;
            state
                .ssh_tunnels
                .write()
                .await
                .insert(connection_id.to_string(), tunnel);
            ("127.0.0.1".to_string(), local_port)
        } else {
            (input.host.clone(), input.port)
        }
    } else {
        (input.host.clone(), input.port)
    };

    let pool = build_pool_custom(&host, port, &input)?;

    state
        .pools
        .write()
        .await
        .insert(connection_id.to_string(), pool.clone());

    Ok(pool)
}

pub fn list_connections(app: &AppHandle) -> Result<Vec<ConnectionSummary>, String> {
    let store = app
        .store(CONNECTION_STORE_PATH)
        .map_err(|error| error.to_string())?;

    let mut connections = store
        .entries()
        .into_iter()
        .map(|(_, value)| {
            serde_json::from_value::<StoredConnection>(value).map_err(|error| error.to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;

    connections.sort_by(|left, right| {
        right
            .connected_at
            .cmp(&left.connected_at)
            .then_with(|| left.name.cmp(&right.name))
    });

    Ok(connections
        .into_iter()
        .map(|connection| connection.summary())
        .collect())
}

pub fn persist_connection(app: &AppHandle, connection: &StoredConnection) -> Result<(), String> {
    let store = app
        .store(CONNECTION_STORE_PATH)
        .map_err(|error| error.to_string())?;

    store.set(
        connection.id.clone(),
        serde_json::to_value(connection).map_err(|error| error.to_string())?,
    );

    Ok(())
}

pub fn persist_connection_with_password(
    app: &AppHandle,
    connection: &StoredConnection,
    password: &str,
) -> Result<(), String> {
    persist_connection(app, connection)?;
    credentials::store_password(&connection.id, password)?;
    Ok(())
}

pub fn delete_connection_from_store(app: &AppHandle, connection_id: &str) -> Result<(), String> {
    let store = app
        .store(CONNECTION_STORE_PATH)
        .map_err(|error| error.to_string())?;
    store.delete(connection_id);
    Ok(())
}

pub fn load_connection(
    app: &AppHandle,
    connection_id: &str,
) -> Result<Option<StoredConnection>, String> {
    let store = app
        .store(CONNECTION_STORE_PATH)
        .map_err(|error| error.to_string())?;

    let mut connection: StoredConnection = match store
        .get(connection_id)
        .map(|value| serde_json::from_value::<StoredConnection>(value).map_err(|error| error.to_string()))
        .transpose()?
    {
        Some(conn) => conn,
        None => return Ok(None),
    };

    match credentials::get_password(connection_id) {
        Ok(Some(password)) => connection.password = Some(password),
        Ok(None) => {
            let json_password = connection.password.clone();
            if let Some(ref pwd) = json_password {
                if let Err(e) = credentials::store_password(connection_id, pwd) {
                    log::warn!("Failed to migrate password to keychain for {}: {}", connection_id, e);
                } else {
                    connection.password = None;
                    persist_connection(app, &connection)?;
                    connection.password = Some(pwd.clone());
                }
            } else {
                log::warn!("No password found in keychain for connection {}", connection_id);
            }
        }
        Err(e) => log::warn!("Failed to read password from keychain for connection {}: {}", connection_id, e),
    }

    Ok(Some(connection))
}

pub fn quote_identifier(value: &str) -> String {
    value.replace('"', "\"\"")
}
