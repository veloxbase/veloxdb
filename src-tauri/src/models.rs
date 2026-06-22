use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

/// TLS behavior for PostgreSQL (`sslmode` style). Serialized as lowercase strings.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ConnectionSslMode {
    /// No TLS (plain TCP).
    Disable,
    /// Try TLS first; fall back to plain if the server does not support SSL.
    #[default]
    Prefer,
    /// Require TLS (typical for Neon and other hosted Postgres).
    Require,
}

fn default_connection_ssl_mode() -> ConnectionSslMode {
    ConnectionSslMode::Prefer
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DatabaseEngine {
    #[default]
    Postgres,
    Mysql,
    Sqlite,
    Mongo,
}

fn default_database_engine() -> DatabaseEngine {
    DatabaseEngine::Postgres
}

fn default_ssh_port() -> u16 {
    22
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SshAuthMethod {
    #[default]
    KeyFile,
    Password,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshConfig {
    #[serde(default)]
    pub enabled: bool,
    pub host: String,
    #[serde(default = "default_ssh_port")]
    pub port: u16,
    pub user: String,
    #[serde(default)]
    pub auth_method: SshAuthMethod,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub private_key_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub passphrase: Option<String>,
}

impl SshConfig {
    pub fn is_active(&self) -> bool {
        self.enabled
            && !self.host.is_empty()
            && !self.user.is_empty()
            && (self.auth_method != SshAuthMethod::Password
                || self.password.as_ref().map_or(false, |p| !p.is_empty()))
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionInput {
    pub id: Option<String>,
    pub name: String,
    #[serde(default = "default_database_engine")]
    pub engine: DatabaseEngine,
    pub host: String,
    pub port: u16,
    pub database: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
    pub user: String,
    pub password: String,
    #[serde(default = "default_connection_ssl_mode")]
    pub ssl_mode: ConnectionSslMode,
    #[serde(default)]
    pub ssh_config: Option<SshConfig>,
    #[serde(default)]
    pub extra_params: Option<std::collections::HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredConnection {
    pub id: String,
    pub name: String,
    #[serde(default = "default_database_engine")]
    pub engine: DatabaseEngine,
    pub host: String,
    pub port: u16,
    pub database: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
    pub user: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
    pub connected_at: String,
    #[serde(default = "default_connection_ssl_mode")]
    pub ssl_mode: ConnectionSslMode,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ssh_config: Option<SshConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extra_params: Option<std::collections::HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionSummary {
    pub id: String,
    pub name: String,
    #[serde(default = "default_database_engine")]
    pub engine: DatabaseEngine,
    pub host: String,
    pub port: u16,
    pub database: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
    pub user: String,
    pub connected_at: String,
    #[serde(default = "default_connection_ssl_mode")]
    pub ssl_mode: ConnectionSslMode,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ssh_config: Option<SshConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extra_params: Option<std::collections::HashMap<String, String>>,
    #[serde(default)]
    pub table_property_editing_supported: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryRequest {
    pub connection_id: Option<String>,
    pub sql: String,
    /// Maximum rows to return for this query. When omitted, the default (`MAX_QUERY_ROWS`) is used.
    pub max_rows: Option<usize>,
    /// Allows non-read-only statements to run. Defaults to false so the editor
    /// must explicitly confirm writes; programmatic DML (grid edits) sets it.
    #[serde(default)]
    pub allow_write: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<std::collections::BTreeMap<String, Option<String>>>,
    pub row_count: usize,
    pub execution_ms: u128,
    pub truncated: bool,
    pub command_tag: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableInfo {
    pub schema: String,
    pub name: String,
    pub preview_query: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaRequest {
    pub connection_id: Option<String>,
    pub table_schema: String,
    pub table_name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnInfo {
    pub table_schema: String,
    pub table_name: String,
    pub column_name: String,
    pub data_type: String,
    pub is_nullable: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnProperties {
    pub table_schema: String,
    pub table_name: String,
    pub column_name: String,
    pub data_type: String,
    pub is_nullable: bool,
    pub is_primary_key: bool,
    pub is_unique: bool,
    pub is_part_of_composite_unique: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub column_default: Option<String>,
    #[serde(default)]
    pub is_identity: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub identity_generation: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_generated: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnPropertiesUpdateInput {
    pub column_name: String,
    pub is_nullable: bool,
    pub is_unique: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TablePropertiesApplyRequest {
    pub connection_id: Option<String>,
    pub table_schema: String,
    pub table_name: String,
    pub columns: Vec<ColumnPropertiesUpdateInput>,
}

/// One column-pair from a foreign-key constraint (composite FKs yield multiple rows).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForeignKeyEdge {
    pub from_schema: String,
    pub from_table: String,
    pub from_column: String,
    pub to_schema: String,
    pub to_table: String,
    pub to_column: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DdlBatchRequest {
    pub connection_id: Option<String>,
    pub statements: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DdlStatementRequest {
    pub connection_id: Option<String>,
    pub statement: String,
}

/// One index on a table (includes usage stats when available).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexInfo {
    pub index_schema: String,
    pub index_name: String,
    pub table_schema: String,
    pub table_name: String,
    pub is_unique: bool,
    pub is_primary: bool,
    pub is_valid: bool,
    pub is_partial: bool,
    pub definition: String,
    pub index_bytes: i64,
    pub idx_scan: i64,
    pub idx_tup_read: i64,
    pub idx_tup_fetch: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableIndexesResult {
    pub indexes: Vec<IndexInfo>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryEditorColumn {
    pub name: String,
    pub data_type: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryEditorTable {
    pub schema: String,
    pub name: String,
    pub columns: Vec<QueryEditorColumn>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryEditorFunction {
    pub schema: String,
    pub name: String,
    pub arg_types: Vec<String>,
    pub return_type: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryEditorMetadata {
    pub tables: Vec<QueryEditorTable>,
    pub functions: Vec<QueryEditorFunction>,
    pub truncated_tables: bool,
    pub truncated_columns: bool,
    pub truncated_functions: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AskVeloxyProviderConfig {
    pub api_key: String,
    pub model: String,
    #[serde(default)]
    pub base_url: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AskVeloxyTableRef {
    pub schema: String,
    pub name: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AskVeloxyRequest {
    pub connection_id: Option<String>,
    pub natural_prompt: String,
    #[serde(default)]
    pub target_table: Option<AskVeloxyTableRef>,
    pub provider_config: AskVeloxyProviderConfig,
    #[serde(default)]
    pub max_rows: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AskVeloxyConversationMessage {
    pub id: String,
    pub role: String,
    pub mode: String,
    pub text: String,
    pub created_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sql_draft: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AskVeloxyChatRequest {
    pub connection_id: Option<String>,
    pub natural_prompt: String,
    #[serde(default)]
    pub target_table: Option<AskVeloxyTableRef>,
    pub provider_config: AskVeloxyProviderConfig,
    #[serde(default)]
    pub max_rows: Option<usize>,
    #[serde(default)]
    pub request_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VeloxyStreamChunk {
    pub request_id: String,
    pub delta: String,
    pub done: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub suggestions: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sql_draft: Option<String>,
    #[serde(default)]
    pub needs_sql_generation: bool,
    #[serde(default)]
    pub needs_clarification: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AskVeloxyChatResponse {
    pub message: String,
    pub suggestions: Vec<String>,
    pub warnings: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sql_draft: Option<String>,
    pub needs_sql_generation: bool,
    pub needs_clarification: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AskVeloxyConversationResponse {
    pub messages: Vec<AskVeloxyConversationMessage>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AskVeloxyTokenStats {
    pub schema_chars: usize,
    pub schema_tokens_estimate: usize,
    pub prompt_chars: usize,
    pub prompt_tokens_estimate: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AskVeloxyResponse {
    pub sql: String,
    pub intent: String,
    pub confidence: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub explanation: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub suggestions: Vec<String>,
    pub warnings: Vec<String>,
    pub token_stats: AskVeloxyTokenStats,
}

#[derive(Debug, Clone)]
pub struct AskVeloxyDbContextCache {
    pub database_name: String,
    pub engine: DatabaseEngine,
    pub metadata: QueryEditorMetadata,
    pub foreign_keys: Vec<ForeignKeyEdge>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LintSqlRequest {
    pub connection_id: Option<String>,
    pub sql: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SqlDiagnostic {
    pub message: String,
    pub severity: String,
    pub line: Option<usize>,
    pub column: Option<usize>,
    pub end_line: Option<usize>,
    pub end_column: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LintSqlResult {
    pub diagnostics: Vec<SqlDiagnostic>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseInfo {
    pub name: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwitchDatabaseRequest {
    pub connection_id: String,
    pub database: String,
}

impl StoredConnection {
    pub fn from_input(id: String, input: ConnectionInput) -> Self {
        Self {
            id,
            name: input.name,
            engine: input.engine,
            host: input.host,
            port: input.port,
            database: input.database,
            file_path: input.file_path,
            user: input.user,
            password: None,
            connected_at: timestamp_string(),
            ssl_mode: input.ssl_mode,
            ssh_config: input.ssh_config,
            extra_params: input.extra_params,
        }
    }

    pub fn summary(&self) -> ConnectionSummary {
        ConnectionSummary {
            id: self.id.clone(),
            name: self.name.clone(),
            engine: self.engine,
            host: self.host.clone(),
            port: self.port,
            database: self.database.clone(),
            file_path: self.file_path.clone(),
            user: self.user.clone(),
            connected_at: self.connected_at.clone(),
            ssl_mode: self.ssl_mode,
            ssh_config: self.ssh_config.clone(),
            extra_params: self.extra_params.clone(),
            table_property_editing_supported: self.engine == DatabaseEngine::Postgres,
        }
    }

    pub fn to_input(&self) -> ConnectionInput {
        ConnectionInput {
            id: Some(self.id.clone()),
            name: self.name.clone(),
            engine: self.engine,
            host: self.host.clone(),
            port: self.port,
            database: self.database.clone(),
            file_path: self.file_path.clone(),
            user: self.user.clone(),
            password: self.password.clone().unwrap_or_default(),
            ssl_mode: self.ssl_mode,
            ssh_config: self.ssh_config.clone(),
            extra_params: self.extra_params.clone(),
        }
    }
}

pub fn timestamp_string() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .to_string()
}
