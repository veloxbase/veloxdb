use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use deadpool_postgres::{
    Client, Config as PostgresConfig, ManagerConfig, Pool, PoolConfig, RecyclingMethod, Runtime,
    SslMode as DeadpoolSslMode, Timeouts,
};
use sqlx::{MySqlPool, SqlitePool};
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;
use tokio::sync::RwLock;
use tokio_postgres::NoTls;
use rustls::pki_types::{CertificateDer, PrivateKeyDer};

use crate::models::{
    AskVeloxyConversationMessage, AskVeloxyDbContextCache, ConnectionInput, ConnectionSslMode,
    ConnectionSummary, DatabaseEngine, StoredConnection,
};
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
pub const DEFAULT_MYSQL_PORT: u16 = 3306;

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
    pub mysql_pools: RwLock<HashMap<String, MySqlPool>>,
    pub sqlite_pools: RwLock<HashMap<String, SqlitePool>>,
    pub active_connection_id: RwLock<Option<String>>,
    pub ssh_tunnels: RwLock<HashMap<String, SshTunnel>>,
    pub ask_veloxy_db_context_cache: RwLock<HashMap<String, AskVeloxyDbContextCache>>,
    pub ask_veloxy_conversations: RwLock<HashMap<String, Vec<AskVeloxyConversationMessage>>>,
    pub veloxy_cancel: RwLock<Option<Arc<AtomicBool>>>,
    pub openrouter_client: OnceLock<reqwest::Client>,
}

fn load_pem_certs(path: &str) -> Result<Vec<CertificateDer<'static>>, String> {
    let data = std::fs::read(path).map_err(|e| format!("Failed to read cert file {}: {}", path, e))?;
    let mut certs = Vec::new();
    for result in rustls_pemfile::certs(&mut &data[..]) {
        let cert = result.map_err(|e| format!("Failed to parse cert from {}: {}", path, e))?;
        certs.push(cert);
    }
    if certs.is_empty() {
        return Err(format!("No certificates found in {}", path));
    }
    Ok(certs)
}

fn load_pem_key(path: &str) -> Result<PrivateKeyDer<'static>, String> {
    let data = std::fs::read(path).map_err(|e| format!("Failed to read key file {}: {}", path, e))?;
    for result in rustls_pemfile::read_all(&mut &data[..]) {
        match result {
            Ok(rustls_pemfile::Item::Pkcs1Key(key)) => return Ok(key.into()),
            Ok(rustls_pemfile::Item::Pkcs8Key(key)) => return Ok(key.into()),
            Ok(rustls_pemfile::Item::Sec1Key(key)) => return Ok(key.into()),
            Err(e) => return Err(format!("Failed to parse key from {}: {}", path, e)),
            _ => continue,
        }
    }
    Err(format!("No private key found in {}", path))
}

fn tls_connector_with_params(extra_params: &HashMap<String, String>) -> Result<tokio_postgres_rustls::MakeRustlsConnect, String> {
    let mut root_store = rustls::RootCertStore::empty();

    let has_custom_root = extra_params.contains_key("sslrootcert");
    if has_custom_root {
        let path = extra_params.get("sslrootcert").unwrap();
        let certs = load_pem_certs(path)?;
        for cert in certs {
            root_store.add(cert).map_err(|e| format!("Failed to add root cert: {}", e))?;
        }
    } else {
        root_store.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    }

    let config_builder = rustls::ClientConfig::builder()
        .with_root_certificates(root_store);

    let has_client_cert = extra_params.contains_key("sslcert") && extra_params.contains_key("sslkey");
    let config = if has_client_cert {
        let cert_path = extra_params.get("sslcert").unwrap();
        let key_path = extra_params.get("sslkey").unwrap();
        let certs = load_pem_certs(cert_path)?;
        let key = load_pem_key(key_path)?;
        config_builder
            .with_client_auth_cert(certs, key)
            .map_err(|e| format!("Failed to configure client auth: {}", e))?
    } else {
        config_builder
            .with_no_client_auth()
    };

    Ok(tokio_postgres_rustls::MakeRustlsConnect::new(config))
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

fn apply_extra_params(
    config: &mut PostgresConfig,
    extra_params: &HashMap<String, String>,
) {
    let mut remaining_opts: Vec<String> = Vec::new();

    for (key, value) in extra_params {
        match key.as_str() {
            "connect_timeout" => {
                if let Ok(secs) = value.parse::<u64>() {
                    config.connect_timeout = Some(Duration::from_secs(secs));
                }
            }
            "application_name" => {
                config.application_name = Some(value.clone());
            }
            "keepalives_idle" => {
                if let Ok(secs) = value.parse::<u64>() {
                    config.keepalives_idle = Some(Duration::from_secs(secs));
                }
            }
            "options" => {
                if !value.is_empty() {
                    remaining_opts.push(value.clone());
                }
            }
            "keepalives" => {
                if let Ok(v) = value.parse::<u64>() {
                    config.keepalives = Some(v != 0);
                }
            }
            // TLS params handled by tls_connector_with_params
            "sslrootcert" | "sslcert" | "sslkey" => {}
            _ => {
                let sanitized_value = value.replace('\\', "\\\\").replace('\'', "\\'");
                remaining_opts.push(format!("-c {}={}", key, sanitized_value));
            }
        }
    }

    if !remaining_opts.is_empty() {
        let existing = config.options.clone().unwrap_or_default();
        let merged = if existing.is_empty() {
            remaining_opts.join(" ")
        } else {
            format!("{} {}", existing, remaining_opts.join(" "))
        };
        config.options = Some(merged);
    }
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

    if let Some(ref extra) = input.extra_params {
        apply_extra_params(&mut config, extra);
    }

    let has_tls_params = input.extra_params.as_ref().map_or(false, |e| {
        e.contains_key("sslrootcert") || e.contains_key("sslcert") || e.contains_key("sslkey")
    });

    match input.ssl_mode {
        ConnectionSslMode::Disable => config
            .create_pool(Some(Runtime::Tokio1), NoTls)
            .map_err(|error| error.to_string()),
        ConnectionSslMode::Prefer | ConnectionSslMode::Require => {
            let tls = if has_tls_params {
                tls_connector_with_params(input.extra_params.as_ref().unwrap())?
            } else {
                tls_connector()?
            };
            config
                .create_pool(Some(Runtime::Tokio1), tls)
                .map_err(|error| error.to_string())
        }
    }
}

pub fn build_pool(input: &ConnectionInput) -> Result<Pool, String> {
    build_pool_custom(&input.host, input.port, input)
}

fn mysql_url(host: &str, port: u16, input: &ConnectionInput) -> String {
    let password = urlencoding::encode(&input.password);
    let user = urlencoding::encode(&input.user);
    let database = urlencoding::encode(&input.database);
    let ssl_param = match input.ssl_mode {
        ConnectionSslMode::Disable => "ssl-mode=DISABLED",
        ConnectionSslMode::Prefer => "ssl-mode=PREFERRED",
        ConnectionSslMode::Require => "ssl-mode=REQUIRED",
    };
    format!(
        "mysql://{}:{}@{}:{}/{}?{}",
        user, password, host, port, database, ssl_param
    )
}

fn sqlite_url(input: &ConnectionInput) -> Result<String, String> {
    let path = input
        .file_path
        .clone()
        .unwrap_or_else(|| input.database.clone());
    if path.trim().is_empty() {
        return Err("SQLite file path is required.".to_string());
    }
    if path == ":memory:" {
        return Ok("sqlite::memory:".to_string());
    }
    if path.starts_with('/') {
        Ok(format!("sqlite://{}", path))
    } else {
        Ok(format!("sqlite://{}", path))
    }
}

pub async fn build_mysql_pool_custom(host: &str, port: u16, input: &ConnectionInput) -> Result<MySqlPool, String> {
    let url = mysql_url(host, port, input);
    sqlx::mysql::MySqlPoolOptions::new()
        .max_connections(POOL_MAX_SIZE as u32)
        .acquire_timeout(Duration::from_secs(POOL_WAIT_SECS))
        .connect(&url)
        .await
        .map_err(|error| error.to_string())
}

pub async fn build_mysql_pool(input: &ConnectionInput) -> Result<MySqlPool, String> {
    let port = if input.port == 0 { DEFAULT_MYSQL_PORT } else { input.port };
    build_mysql_pool_custom(&input.host, port, input).await
}

pub async fn build_sqlite_pool(input: &ConnectionInput) -> Result<SqlitePool, String> {
    use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqliteSynchronous};

    let url = sqlite_url(input)?;
    let options: SqliteConnectOptions = url
        .parse()
        .map_err(|error: sqlx::Error| error.to_string())?;
    let options = options
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Normal);

    sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(POOL_MAX_SIZE as u32)
        .acquire_timeout(Duration::from_secs(POOL_WAIT_SECS))
        .connect_with(options)
        .await
        .map_err(|error| error.to_string())
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
    state.mysql_pools.write().await.remove(connection_id);
    state.sqlite_pools.write().await.remove(connection_id);
    state
        .ask_veloxy_db_context_cache
        .write()
        .await
        .retain(|cache_key, _| !cache_key.starts_with(&format!("{}::", connection_id)));
    state
        .ask_veloxy_conversations
        .write()
        .await
        .retain(|conversation_key, _| !conversation_key.starts_with(&format!("{}::", connection_id)));
    if let Some(mut tunnel) = state.ssh_tunnels.write().await.remove(connection_id) {
        tunnel.close().await;
    }
}

pub async fn disconnect_connection(state: &AppState, connection_id: &str) {
    drop_pool(state, connection_id).await;
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

    let resolved_port = if input.port == 0 { DEFAULT_MYSQL_PORT } else { input.port };
    let (host, port) = if let Some(ref ssh_config) = input.ssh_config {
        if ssh_config.is_active() {
            let tunnel = SshTunnel::connect(ssh_config, &input.host, resolved_port).await?;
            let local_port = tunnel.local_port;
            state
                .ssh_tunnels
                .write()
                .await
                .insert(connection_id.to_string(), tunnel);
            ("127.0.0.1".to_string(), local_port)
        } else {
            (input.host.clone(), resolved_port)
        }
    } else {
        (input.host.clone(), resolved_port)
    };

    let pool = build_pool_custom(&host, port, &input)?;

    state
        .pools
        .write()
        .await
        .insert(connection_id.to_string(), pool.clone());

    Ok(pool)
}

pub async fn get_or_create_mysql_pool(
    app: &AppHandle,
    state: &AppState,
    connection_id: &str,
) -> Result<MySqlPool, String> {
    if let Some(pool) = state.mysql_pools.read().await.get(connection_id).cloned() {
        return Ok(pool);
    }

    let stored_connection = load_connection(app, connection_id)?
        .ok_or_else(|| "Stored connection details were not found.".to_string())?;

    let input = stored_connection.to_input();
    let resolved_port = if input.port == 0 {
        DEFAULT_MYSQL_PORT
    } else {
        input.port
    };

    let (host, port) = if let Some(ref ssh_config) = input.ssh_config {
        if ssh_config.is_active() {
            let tunnel = SshTunnel::connect(ssh_config, &input.host, resolved_port).await?;
            let local_port = tunnel.local_port;
            state
                .ssh_tunnels
                .write()
                .await
                .insert(connection_id.to_string(), tunnel);
            ("127.0.0.1".to_string(), local_port)
        } else {
            (input.host.clone(), resolved_port)
        }
    } else {
        (input.host.clone(), resolved_port)
    };

    let pool = build_mysql_pool_custom(&host, port, &input).await?;
    state
        .mysql_pools
        .write()
        .await
        .insert(connection_id.to_string(), pool.clone());
    Ok(pool)
}

pub async fn get_or_create_sqlite_pool(
    app: &AppHandle,
    state: &AppState,
    connection_id: &str,
) -> Result<SqlitePool, String> {
    if let Some(pool) = state.sqlite_pools.read().await.get(connection_id).cloned() {
        return Ok(pool);
    }

    let stored_connection = load_connection(app, connection_id)?
        .ok_or_else(|| "Stored connection details were not found.".to_string())?;

    let input = stored_connection.to_input();
    let pool = build_sqlite_pool(&input).await?;

    state
        .sqlite_pools
        .write()
        .await
        .insert(connection_id.to_string(), pool.clone());

    Ok(pool)
}

/// Drops cached pools and re-validates the connection (used by sidebar refresh).
pub async fn refresh_connection_pools(
    app: &AppHandle,
    state: &AppState,
    connection_id: &str,
) -> Result<(), String> {
    let stored = load_connection(app, connection_id)?
        .ok_or_else(|| "Stored connection details were not found.".to_string())?;
    let engine = stored.engine;

    drop_pool(state, connection_id).await;

    match engine {
        DatabaseEngine::Postgres => {
            with_pool_client_retry(app, state, connection_id, (), |client, ()| async move {
                client
                    .simple_query("select 1")
                    .await
                    .map_err(|error| error.to_string())?;
                Ok(())
            })
            .await?;
        }
        DatabaseEngine::Mysql => {
            let pool = get_or_create_mysql_pool(app, state, connection_id).await?;
            sqlx::query("select 1")
                .execute(&pool)
                .await
                .map_err(|error| error.to_string())?;
        }
        DatabaseEngine::Sqlite => {
            let pool = get_or_create_sqlite_pool(app, state, connection_id).await?;
            sqlx::query("select 1")
                .execute(&pool)
                .await
                .map_err(|error| error.to_string())?;
        }
    }

    Ok(())
}

pub async fn resolve_connection_engine(
    app: &AppHandle,
    state: &AppState,
    requested_connection_id: Option<String>,
) -> Result<(String, DatabaseEngine), String> {
    let connection_id = resolve_connection_id(state, requested_connection_id).await?;
    let stored = load_connection(app, &connection_id)?
        .ok_or_else(|| "Stored connection details were not found.".to_string())?;
    Ok((connection_id, stored.engine))
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

    store.save().map_err(|error| error.to_string())?;

    Ok(())
}

pub fn persist_connection_with_password(
    app: &AppHandle,
    connection: &StoredConnection,
    password: &str,
) -> Result<(), String> {
    let mut stored = connection.clone();
    stored.password = Some(password.to_string());
    persist_connection(app, &stored)?;
    if connection.engine != DatabaseEngine::Sqlite {
        credentials::store_password(&connection.id, password)?;
    }
    Ok(())
}

/// Renames a persisted connection and returns the updated summary.
pub fn rename_connection_in_store(
    app: &AppHandle,
    connection_id: &str,
    new_name: &str,
) -> Result<ConnectionSummary, String> {
    let mut stored = load_connection(app, connection_id)?
        .ok_or_else(|| format!("Connection {} not found.", connection_id))?;
    stored.name = new_name.to_string();
    persist_connection(app, &stored)?;
    Ok(stored.summary())
}

pub fn delete_connection_from_store(app: &AppHandle, connection_id: &str) -> Result<(), String> {
    let store = app
        .store(CONNECTION_STORE_PATH)
        .map_err(|error| error.to_string())?;
    store.delete(connection_id);
    store.save().map_err(|error| error.to_string())?;
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

    let json_password = connection.password.clone();

    if connection.engine == DatabaseEngine::Sqlite {
        connection.password = Some(String::new());
        return Ok(Some(connection));
    }

    match credentials::get_password(connection_id) {
        Ok(Some(password)) => {
            if json_password.is_some() {
                let clean = StoredConnection {
                    password: None,
                    ..connection.clone()
                };
                let _ = persist_connection(app, &clean);
            }
            connection.password = Some(password);
        }
        Ok(None) => {
            if let Some(ref pwd) = json_password {
                if let Err(e) = credentials::store_password(connection_id, pwd) {
                    log::warn!("Failed to migrate password to keychain for {}: {}", connection_id, e);
                }
                connection.password = Some(pwd.clone());
            } else {
                return Err(format!(
                    "No saved password found for connection {}. Re-enter your password to reconnect.",
                    connection.name
                ));
            }
        }
        Err(e) => {
            log::warn!("Failed to read password from keychain for {}: {}", connection_id, e);
            if let Some(ref pwd) = json_password {
                connection.password = Some(pwd.clone());
            } else {
                return Err(format!(
                    "Failed to read saved password for connection {} (keychain error). Re-enter your password to reconnect.",
                    connection.name
                ));
            }
        }
    }

    Ok(Some(connection))
}

pub fn quote_identifier(value: &str) -> String {
    value.replace('"', "\"\"")
}

/// Whether `name` is safe to interpolate into dynamic SQL (e.g. SQLite `PRAGMA`
/// statements, where bind parameters are not allowed). Restricted to ASCII
/// alphanumerics and underscores so it cannot terminate or escape a statement.
pub fn is_safe_identifier(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 128
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// Validates an identifier before it is interpolated into dynamic SQL. Returns
/// the identifier unchanged when safe, or a descriptive error otherwise.
pub fn require_safe_identifier<'a>(name: &'a str, context: &str) -> Result<&'a str, String> {
    if is_safe_identifier(name) {
        Ok(name)
    } else {
        Err(format!("Invalid identifier for {}: {:?}", context, name))
    }
}

#[cfg(test)]
mod tests {
    use super::{is_safe_identifier, mysql_url, require_safe_identifier};
    use crate::models::{ConnectionInput, ConnectionSslMode, DatabaseEngine};

    fn mysql_input(ssl_mode: ConnectionSslMode) -> ConnectionInput {
        ConnectionInput {
            id: None,
            name: "test".to_string(),
            engine: DatabaseEngine::Mysql,
            host: "localhost".to_string(),
            port: 3306,
            database: "app".to_string(),
            file_path: None,
            user: "root".to_string(),
            password: "pw".to_string(),
            ssl_mode,
            ssh_config: None,
            extra_params: None,
        }
    }

    #[test]
    fn mysql_url_maps_ssl_mode() {
        assert!(mysql_url("localhost", 3306, &mysql_input(ConnectionSslMode::Disable))
            .ends_with("?ssl-mode=DISABLED"));
        assert!(mysql_url("localhost", 3306, &mysql_input(ConnectionSslMode::Prefer))
            .ends_with("?ssl-mode=PREFERRED"));
        assert!(mysql_url("localhost", 3306, &mysql_input(ConnectionSslMode::Require))
            .ends_with("?ssl-mode=REQUIRED"));
    }

    #[test]
    fn rejects_sql_injection_in_identifiers() {
        assert!(!is_safe_identifier("\"; DROP TABLE users; --"));
        assert!(!is_safe_identifier("foo; DELETE FROM bar"));
        assert!(!is_safe_identifier("a\0b"));
        assert!(!is_safe_identifier(""));
        assert!(require_safe_identifier("foo);", "table name").is_err());
    }

    #[test]
    fn accepts_plain_identifiers() {
        assert!(is_safe_identifier("users"));
        assert!(is_safe_identifier("_internal"));
        assert!(is_safe_identifier("Table123"));
        assert_eq!(require_safe_identifier("users", "table name"), Ok("users"));
    }
}
