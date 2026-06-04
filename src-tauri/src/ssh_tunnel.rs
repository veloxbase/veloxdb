use std::process::Stdio;

use tokio::net::TcpListener;
use tokio::process::{Child, Command};

use crate::models::{SshAuthMethod, SshConfig};

async fn find_free_port() -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Failed to bind for SSH tunnel: {}", e))?;

    let port = listener
        .local_addr()
        .map_err(|e| format!("Failed to get local port: {}", e))?
        .port();

    drop(listener);
    Ok(port)
}

async fn check_sshpass_available() -> bool {
    Command::new("sshpass")
        .arg("-V")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .stdin(Stdio::null())
        .spawn()
        .is_ok()
}

async fn spawn_ssh_tunnel_password(
    ssh_config: &SshConfig,
    local_port: u16,
    pg_host: &str,
    pg_port: u16,
) -> Result<Child, String> {
    let password = ssh_config
        .password
        .as_deref()
        .ok_or("SSH password required")?;

    // `sshpass -e` reads the password from the SSHPASS env var, which keeps it
    // out of the process argument list (visible via `ps aux`).
    let child = Command::new("sshpass")
        .arg("-e")
        .env("SSHPASS", password)
        .arg("ssh")
        .arg("-o")
        .arg("StrictHostKeyChecking=accept-new")
        .arg("-o")
        .arg("PasswordAuthentication=yes")
        .arg("-o")
        .arg("PubkeyAuthentication=no")
        .arg("-o")
        .arg("ServerAliveInterval=30")
        .arg("-o")
        .arg("ServerAliveCountMax=3")
        .arg("-o")
        .arg("ExitOnForwardFailure=yes")
        .arg("-N")
        .arg("-L")
        .arg(format!("127.0.0.1:{}:{}:{}", local_port, pg_host, pg_port))
        .arg("-p")
        .arg(ssh_config.port.to_string())
        .arg(format!("{}@{}", ssh_config.user, ssh_config.host))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("Failed to spawn SSH tunnel: {}", e))?;

    Ok(child)
}

async fn spawn_ssh_tunnel_key(
    ssh_config: &SshConfig,
    local_port: u16,
    pg_host: &str,
    pg_port: u16,
) -> Result<Child, String> {
    let mut cmd = Command::new("ssh");

    cmd.arg("-o")
        .arg("StrictHostKeyChecking=accept-new")
        .arg("-o")
        .arg("ServerAliveInterval=30")
        .arg("-o")
        .arg("ServerAliveCountMax=3")
        .arg("-o")
        .arg("ExitOnForwardFailure=yes")
        .arg("-N")
        .arg("-L")
        .arg(format!("127.0.0.1:{}:{}:{}", local_port, pg_host, pg_port))
        .arg("-p")
        .arg(ssh_config.port.to_string());

    if let Some(ref key_path) = ssh_config.private_key_path {
        cmd.arg("-i").arg(key_path);
    }

    if let Some(ref passphrase) = ssh_config.passphrase {
        cmd.env("SSH_PASSPHRASE", passphrase);
    }

    cmd.arg(format!("{}@{}", ssh_config.user, ssh_config.host))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn SSH tunnel: {}", e))?;

    Ok(child)
}

pub struct SshTunnel {
    child: Option<Child>,
    pub local_port: u16,
}

impl SshTunnel {
    pub async fn connect(
        ssh_config: &SshConfig,
        pg_host: &str,
        pg_port: u16,
    ) -> Result<Self, String> {
        let local_port = find_free_port().await?;

        let mut child = match ssh_config.auth_method {
            SshAuthMethod::Password => {
                if !check_sshpass_available().await {
                    return Err(
                        "sshpass is required for SSH password authentication. Install it with: \
                         brew install sshpass (macOS) or apt install sshpass (Linux). \
                         Alternatively, use SSH key-based authentication."
                            .to_string(),
                    );
                }
                spawn_ssh_tunnel_password(ssh_config, local_port, pg_host, pg_port).await?
            }
            SshAuthMethod::KeyFile => {
                spawn_ssh_tunnel_key(ssh_config, local_port, pg_host, pg_port).await?
            }
        };

        tokio::time::sleep(std::time::Duration::from_millis(800)).await;

        match child.try_wait() {
            Ok(Some(status)) => {
                let mut stderr_output = String::new();
                if let Some(ref mut stderr) = child.stderr {
                    use tokio::io::AsyncReadExt;
                    let _ = stderr.read_to_string(&mut stderr_output).await;
                }
                let detail = stderr_output.trim();
                let detail = if detail.is_empty() {
                    "The SSH process exited immediately."
                } else {
                    detail
                };
                return Err(format!(
                    "SSH tunnel failed (exit {:?}): {}",
                    status.code(),
                    detail
                ));
            }
            Ok(None) => {}
            Err(e) => {
                return Err(format!("SSH tunnel process error: {}", e));
            }
        }

        Ok(SshTunnel {
            child: Some(child),
            local_port,
        })
    }

    pub async fn close(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill().await;
        }
    }
}

impl Drop for SshTunnel {
    fn drop(&mut self) {
        if let Some(mut child) = self.child.take() {
            tokio::task::spawn(async move {
                let _ = child.kill().await;
            });
        }
    }
}
