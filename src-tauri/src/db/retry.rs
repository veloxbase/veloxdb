use deadpool_postgres::Client;
use tauri::AppHandle;

use super::connection_pool::{self, AppState};
use crate::error::VeloxError;

/// Heuristic for transport-level failures where discarding the pool and opening
/// a new TCP session may succeed (sleep/VPN blips, idle disconnects).
pub fn is_retryable_connection_error(message: &str) -> bool {
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

/// Runs `operation` with a pooled client. On a retryable connection error, drops
/// the cached pool once and retries the whole operation (at most one extra attempt).
pub async fn with_pool_client_retry<T, C, F, Fut>(
    app: &AppHandle,
    state: &AppState,
    connection_id: &str,
    ctx: C,
    mut operation: F,
) -> Result<T, VeloxError>
where
    C: Clone + Send,
    F: FnMut(Client, C) -> Fut,
    Fut: std::future::Future<Output = Result<T, String>> + Send,
    T: Send,
{
    let mut dropped_pool = false;

    loop {
        let pool = connection_pool::get_or_create_pool(app, state, connection_id).await?;
        let client = match pool.get().await {
            Ok(client) => client,
            Err(error) => {
                let message = error.to_string();
                if !dropped_pool && is_retryable_connection_error(&message) {
                    connection_pool::drop_pool(state, connection_id).await;
                    dropped_pool = true;
                    continue;
                }
                return Err(VeloxError::Connection(message));
            }
        };

        match operation(client, ctx.clone()).await {
            Ok(value) => return Ok(value),
            Err(message) => {
                if !dropped_pool && is_retryable_connection_error(&message) {
                    connection_pool::drop_pool(state, connection_id).await;
                    dropped_pool = true;
                    continue;
                }
                return Err(VeloxError::Query(message));
            }
        }
    }
}
