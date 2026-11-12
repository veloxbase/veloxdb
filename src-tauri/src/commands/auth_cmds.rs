use std::time::Duration;

use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

const CALLBACK_TIMEOUT: Duration = Duration::from_secs(180);
const SUCCESS_HTML: &[u8] = b"HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nConnection: close\r\n\r\n<!doctype html><html><body style=\"font-family:system-ui;padding:2rem\"><h1>Signed in to VeloxDB</h1><p>You can close this tab and return to the app.</p></body></html>";

#[tauri::command]
pub async fn start_desktop_auth_callback(app: AppHandle) -> Result<String, String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|error| format!("Failed to start sign-in callback server: {error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("Failed to read callback port: {error}"))?
        .port();
    let redirect_uri = format!("http://127.0.0.1:{port}/callback");

    tauri::async_runtime::spawn(async move {
        let deadline = tokio::time::Instant::now() + CALLBACK_TIMEOUT;
        loop {
            let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
            if remaining.is_zero() {
                break;
            }
            let accepted = tokio::time::timeout(remaining, listener.accept()).await;
            let Ok(Ok((stream, _))) = accepted else {
                break;
            };
            if let Some(callback_url) = handle_callback_connection(stream, port).await {
                let _ = app.emit("desktop-auth-callback", callback_url);
                break;
            }
        }
    });

    Ok(redirect_uri)
}

async fn handle_callback_connection(mut stream: TcpStream, port: u16) -> Option<String> {
    let mut buffer = vec![0_u8; 4096];
    let read = stream.read(&mut buffer).await.ok()?;
    let request = String::from_utf8_lossy(&buffer[..read]);
    let request_line = request.lines().next()?;
    let path = request_line.split_whitespace().nth(1)?;
    let callback_url = format!("http://127.0.0.1:{port}{path}");
    let _ = stream.write_all(SUCCESS_HTML).await;
    let _ = stream.shutdown().await;

    if callback_url.contains("code=") {
        Some(callback_url)
    } else {
        None
    }
}
