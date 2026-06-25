/// Centralised error type for VeloxDB.
///
/// Replaces ad-hoc `Result<T, String>` in the connection pool, retry, and
/// identifier-guard modules. Tauri command signatures are unchanged (still
/// `Result<T, String>`); the `From<VeloxError> for String` impl bridges the two
/// worlds so that `?` works in both directions.
#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum VeloxError {
    /// Network or transport-level failures (timeout, refused, broken pipe, …).
    #[error("{0}")]
    Connection(String),

    /// A database returned an error for a query.
    #[error("{0}")]
    Query(String),

    /// A PostgreSQL error that has been formatted by `pg_error` (severity,
    /// SQLSTATE, DETAIL, HINT, caret marker).
    #[error("{0}")]
    Postgres(PgError),

    /// TLS / SSH / pool configuration is invalid.
    #[error("{0}")]
    Configuration(String),

    /// User-provided input failed validation (identifier safety, SQL checks, …).
    #[error("{0}")]
    Validation(String),

    /// OS keychain access failed or a credential was missing.
    #[error("{0}")]
    Credential(String),

    /// Catch-all for unexpected internal states.
    #[error("{0}")]
    Internal(String),
}

/// Formatted PostgreSQL error string (produced by `pg_error::map_pg_err`).
#[derive(Debug, Clone, PartialEq, thiserror::Error)]
#[error("{0}")]
pub struct PgError(pub String);

impl PgError {
    pub fn from_error(error: tokio_postgres::Error, sql: Option<&str>) -> Self {
        PgError(crate::pg_error::map_pg_err(error, sql))
    }
}

// ── Two-way bridge with `String` ────────────────────────────────
//
// Existing code (especially Tauri commands) returns `Result<_, String>`.
// New internal functions return `Result<_, VeloxError>`.
// These impls let `?` work seamlessly in both directions.

impl From<VeloxError> for String {
    fn from(e: VeloxError) -> Self {
        e.to_string()
    }
}

impl From<String> for VeloxError {
    fn from(s: String) -> Self {
        VeloxError::Internal(s)
    }
}

// ── From impls for common library error types ───────────────────

impl From<std::io::Error> for VeloxError {
    fn from(e: std::io::Error) -> Self {
        VeloxError::Internal(e.to_string())
    }
}

impl From<serde_json::Error> for VeloxError {
    fn from(e: serde_json::Error) -> Self {
        VeloxError::Internal(e.to_string())
    }
}
