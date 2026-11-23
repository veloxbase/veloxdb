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

fn is_false(v: &bool) -> bool {
    !*v
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DatabaseEngine {
    #[default]
    Postgres,
    Mysql,
    Sqlite,
    Mongo,
    Duckdb,
    Redis,
    Clickhouse,
    Libsql,
    Turso,
    Scylladb,
    Cassandra,
    Mssql,
    Azuresql,
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
                || self.password.as_ref().is_some_and(|p| !p.is_empty()))
    }

    /// Returns a copy with secret fields (`password`, `passphrase`) cleared.
    pub fn redacted(&self) -> Self {
        Self {
            password: None,
            passphrase: None,
            ..self.clone()
        }
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
    #[serde(default, skip_serializing_if = "is_false")]
    pub srv_enabled: bool,
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
    #[serde(default, skip_serializing_if = "is_false")]
    pub srv_enabled: bool,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableInfo {
    pub schema: String,
    pub name: String,
    pub preview_query: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_nullable: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_primary_key: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryEditorTable {
    pub schema: String,
    pub name: String,
    pub columns: Vec<QueryEditorColumn>,
    /// Planner estimate (`pg_class.reltuples`); `None` when the engine has no cheap estimate.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub estimated_rows: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryEditorEnum {
    /// Schema-qualified enum type name, e.g. `public.order_status`.
    pub name: String,
    pub values: Vec<String>,
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
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub enums: Vec<QueryEditorEnum>,
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
            srv_enabled: input.srv_enabled,
            ssh_config: input.ssh_config,
            extra_params: input.extra_params,
        }
    }

    /// Returns a copy with DB and SSH credentials stripped for safe persistence.
    pub fn redacted(&self) -> Self {
        Self {
            password: None,
            ssh_config: self.ssh_config.as_ref().map(SshConfig::redacted),
            ..self.clone()
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
            ssh_config: self.ssh_config.as_ref().map(SshConfig::redacted),
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
            srv_enabled: self.srv_enabled,
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

// ── BI: saved queries + dashboards (Pro) ────────────────────────

pub const SAVED_QUERIES_STORE_PATH: &str = "saved_queries.json";
pub const DASHBOARDS_STORE_PATH: &str = "dashboards.json";
pub const MAX_DASHBOARD_WIDGETS: usize = 50;
pub const DASHBOARD_VERSION: u32 = 1;

pub fn now_epoch_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedQuery {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(alias = "connection_id")]
    pub connection_id: String,
    pub sql: String,
    #[serde(alias = "created_at")]
    pub created_at: i64,
    #[serde(alias = "updated_at")]
    pub updated_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedQueryInput {
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub connection_id: String,
    pub sql: String,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum WidgetKind {
    #[default]
    Chart,
    Kpi,
    Table,
    Text,
    Markdown,
    Image,
    Divider,
    Filter,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ChartType {
    #[default]
    Line,
    Area,
    Bar,
    HorizontalBar,
    Pie,
    Donut,
    Scatter,
    Heatmap,
    Treemap,
    Gauge,
    Kpi,
    Combo,
    Histogram,
    Box,
    Waterfall,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ColumnRole {
    Temporal,
    Categorical,
    Numeric,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnRef {
    pub column: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<ColumnRole>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VizEncodings {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub x: Option<ColumnRef>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub y: Vec<ColumnRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub series: Option<ColumnRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<ColumnRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VizConfig {
    pub chart_type: ChartType,
    #[serde(default)]
    pub encodings: VizEncodings,
    #[serde(default)]
    pub options: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum WidgetQueryProvider {
    #[default]
    SqlQuery,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetQuery {
    #[serde(default)]
    pub provider_id: WidgetQueryProvider,
    pub connection_id: String,
    pub sql: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub saved_query_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "source_cell_id")]
    pub source_cell_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetLayout {
    pub i: String,
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub is_static: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Widget {
    pub id: String,
    pub kind: WidgetKind,
    pub title: String,
    #[serde(default)]
    pub query: Option<WidgetQuery>,
    #[serde(default)]
    pub viz: Option<VizConfig>,
    #[serde(default)]
    pub locked: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DashboardVariableType {
    Text,
    Number,
    Date,
    Select,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardVariable {
    pub name: String,
    #[serde(rename = "type")]
    pub variable_type: DashboardVariableType,
    pub default_value: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub options: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DashboardTheme {
    #[default]
    Inherit,
    Light,
    Dark,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardPage {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub widget_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardStoryBeat {
    pub page_id: String,
    pub caption: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardStory {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub beats: Vec<DashboardStoryBeat>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Dashboard {
    pub version: u32,
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(alias = "connection_id")]
    pub connection_id: String,
    #[serde(default)]
    pub cells: Vec<serde_json::Value>,
    #[serde(default)]
    pub layout: Vec<WidgetLayout>,
    #[serde(default)]
    pub widgets: std::collections::BTreeMap<String, Widget>,
    #[serde(default)]
    pub variables: Vec<DashboardVariable>,
    #[serde(default)]
    pub theme: DashboardTheme,
    #[serde(default, alias = "refresh_interval_sec")]
    pub refresh_interval_sec: Option<u32>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub pages: Vec<DashboardPage>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub story: Option<DashboardStory>,
    #[serde(alias = "created_at")]
    pub created_at: i64,
    #[serde(alias = "updated_at")]
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VeloxyThreadSummary {
    pub id: String,
    #[serde(alias = "connection_id")]
    pub connection_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "database_name")]
    pub database_name: Option<String>,
    pub title: String,
    #[serde(alias = "created_at")]
    pub created_at: i64,
    #[serde(alias = "updated_at")]
    pub updated_at: i64,
    #[serde(alias = "opened_at")]
    pub opened_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VeloxyThread {
    pub id: String,
    #[serde(alias = "connection_id")]
    pub connection_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "database_name")]
    pub database_name: Option<String>,
    pub title: String,
    #[serde(alias = "created_at")]
    pub created_at: i64,
    #[serde(alias = "updated_at")]
    pub updated_at: i64,
    #[serde(alias = "opened_at")]
    pub opened_at: i64,
    pub state: serde_json::Value,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VeloxyThreadInput {
    pub id: String,
    pub connection_id: String,
    #[serde(default)]
    pub database_name: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    pub state: serde_json::Value,
}

#[cfg(test)]
mod dashboard_contract_tests {
    use super::{ChartType, Dashboard, DashboardVariableType};

    /// Keep in lockstep with `src/data/types.ts` `ChartType` and `GENERATED_CHART_TYPES`.
    const FRONTEND_CHART_TYPES: &[&str] = &[
        "line",
        "area",
        "bar",
        "horizontalBar",
        "pie",
        "donut",
        "scatter",
        "heatmap",
        "treemap",
        "gauge",
        "kpi",
        "combo",
        "histogram",
        "box",
        "waterfall",
    ];

    /// Keep in lockstep with `src/data/types.ts` `DashboardVariableType`.
    const FRONTEND_VARIABLE_TYPES: &[&str] = &["text", "number", "date", "select"];

    #[test]
    fn chart_types_accept_every_frontend_variant() {
        for name in FRONTEND_CHART_TYPES {
            serde_json::from_value::<ChartType>(serde_json::json!(name))
                .unwrap_or_else(|error| panic!("Rust ChartType rejected `{name}`: {error}"));
        }
    }

    #[test]
    fn variable_types_accept_every_frontend_variant() {
        for name in FRONTEND_VARIABLE_TYPES {
            serde_json::from_value::<DashboardVariableType>(serde_json::json!(name))
                .unwrap_or_else(|error| panic!("Rust DashboardVariableType rejected `{name}`: {error}"));
        }
    }

    #[test]
    fn save_payload_accepts_generated_combo_and_select_filters() {
        let payload = serde_json::json!({
            "version": 2,
            "id": "dash-ai",
            "name": "Generated",
            "connectionId": "conn-1",
            "cells": [],
            "layout": [{ "i": "w1", "x": 0, "y": 0, "w": 6, "h": 4 }],
            "widgets": {
                "w1": {
                    "id": "w1",
                    "kind": "chart",
                    "title": "Revenue vs orders",
                    "query": { "providerId": "sql-query", "connectionId": "conn-1", "sql": "SELECT 1" },
                    "viz": {
                        "chartType": "combo",
                        "encodings": { "x": { "column": "month" }, "y": [{ "column": "revenue" }, { "column": "orders" }] },
                        "options": {}
                    },
                    "locked": false
                }
            },
            "variables": [{
                "name": "region",
                "type": "select",
                "defaultValue": "",
                "options": ["EU", "US"],
                "label": "Region"
            }],
            "theme": "inherit",
            "refreshIntervalSec": null,
            "createdAt": 1,
            "updatedAt": 1
        });

        let dashboard: Dashboard = serde_json::from_value(payload).expect("generated dashboard payload");
        assert_eq!(dashboard.widgets["w1"].viz.as_ref().unwrap().chart_type, ChartType::Combo);
        assert_eq!(dashboard.variables[0].variable_type, DashboardVariableType::Select);
    }
}

#[cfg(test)]
mod connection_secret_tests {
    use super::*;

    fn sample_connection() -> StoredConnection {
        StoredConnection {
            id: "conn-1".to_string(),
            name: "Prod".to_string(),
            engine: DatabaseEngine::Postgres,
            host: "db.internal".to_string(),
            port: 5432,
            database: "app".to_string(),
            file_path: None,
            user: "admin".to_string(),
            password: Some("super-secret-db-pass".to_string()),
            connected_at: "1700000000".to_string(),
            ssl_mode: ConnectionSslMode::Require,
            srv_enabled: false,
            ssh_config: Some(SshConfig {
                enabled: true,
                host: "bastion.example.com".to_string(),
                port: 22,
                user: "ubuntu".to_string(),
                auth_method: SshAuthMethod::Password,
                password: Some("super-secret-ssh-pass".to_string()),
                private_key_path: Some("/Users/dev/.ssh/id_ed25519".to_string()),
                passphrase: Some("super-secret-passphrase".to_string()),
            }),
            extra_params: None,
        }
    }

    #[test]
    fn redacted_strips_db_and_ssh_secrets_before_serialization() {
        let conn = sample_connection();
        let redacted = conn.redacted();

        assert!(redacted.password.is_none());
        let ssh = redacted.ssh_config.as_ref().expect("ssh_config preserved");
        assert!(ssh.password.is_none());
        assert!(ssh.passphrase.is_none());
        assert_eq!(ssh.host, "bastion.example.com");
        assert_eq!(
            ssh.private_key_path.as_deref(),
            Some("/Users/dev/.ssh/id_ed25519")
        );

        let json = serde_json::to_string(&redacted).expect("serialize redacted");
        assert!(!json.contains("super-secret-db-pass"));
        assert!(!json.contains("super-secret-ssh-pass"));
        assert!(!json.contains("super-secret-passphrase"));
    }

    #[test]
    fn summary_does_not_expose_ssh_secrets() {
        let conn = sample_connection();
        let summary = conn.summary();

        let ssh = summary.ssh_config.as_ref().expect("ssh_config preserved");
        assert!(ssh.password.is_none());
        assert!(ssh.passphrase.is_none());
        assert_eq!(ssh.host, "bastion.example.com");
        assert_eq!(ssh.user, "ubuntu");
    }
}
