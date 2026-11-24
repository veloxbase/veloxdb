//! The MCP tools: their definitions (served by the bridge in `tools/list`)
//! and their handlers (run inside the app).
//!
//! Handlers go through [`McpBackend`], so tests can run them against real
//! SQLite databases without Tauri. Every handler that takes a
//! `connection_id` only sees connections the user shared with
//! "Allow AI tools on this connection", on engines whose database enforces
//! read-only (`engines::enforces_readonly_in_database`). SQL only runs
//! through `check_agent_readonly_sql` and `engines::run_agent_readonly`; a
//! write is never executed, only opened in the editor.

use std::future::Future;

use serde::Serialize;
use serde_json::{json, Value};

use super::schema;
use crate::commands::check_agent_readonly_sql;
use crate::engines::{enforces_readonly_in_database, AgentStatement};
use crate::models::{AskVeloxyDbContextCache, ConnectionSummary, DatabaseEngine, QueryResult};

pub(crate) const LIST_CONNECTIONS: &str = "list_connections";
pub(crate) const GET_SCHEMA: &str = "get_schema";
pub(crate) const RUN_READONLY_QUERY: &str = "run_readonly_query";
pub(crate) const EXPLAIN_QUERY: &str = "explain_query";
pub(crate) const OPEN_IN_EDITOR: &str = "open_in_editor";

pub(crate) const DEFAULT_MAX_ROWS: usize = 100;
pub(crate) const MAX_ROWS_LIMIT: usize = 500;
pub(crate) const QUERY_TIMEOUT_MS: u64 = 30_000;
const EXPLAIN_MAX_ROWS: usize = 500;
/// Longer cell values are cut, so one JSON or text column cannot fill the
/// agent's context.
const MAX_CELL_CHARS: usize = 2_000;
/// Rows stop being added once the serialized output reaches this size.
const MAX_OUTPUT_CHARS: usize = 100_000;
const MAX_SQL_CHARS: usize = 100_000;
const MAX_TITLE_CHARS: usize = 80;

const SHARE_HINT: &str = "The user shares a connection in VeloxDB by turning on \"Allow AI tools on this connection\" (Settings → Veloxy → AI tools).";
const WRITE_HINT: &str = "Writes never run over MCP. To propose a change, call open_in_editor so the user can review and run it in VeloxDB.";

/// SQL sent to the editor. Nothing runs until the user runs it there.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpenInEditorRequest {
    pub connection_id: String,
    pub sql: String,
    pub title: Option<String>,
    pub client: String,
}

/// What the app needs to provide for the tools.
pub(crate) trait McpBackend: Send + Sync + 'static {
    /// Every saved connection, shared or not.
    fn connections(&self) -> Result<Vec<ConnectionSummary>, String>;

    fn catalog(
        &self,
        connection_id: &str,
        engine: DatabaseEngine,
        refresh: bool,
    ) -> impl Future<Output = Result<AskVeloxyDbContextCache, String>> + Send;

    /// Runs SQL that passed `check_agent_readonly_sql`, read-only at the
    /// database level.
    #[allow(clippy::too_many_arguments)]
    fn run_readonly(
        &self,
        connection_id: &str,
        engine: DatabaseEngine,
        sql: &str,
        kind: AgentStatement,
        max_rows: usize,
        timeout_ms: u64,
    ) -> impl Future<Output = Result<QueryResult, String>> + Send;

    fn open_in_editor(&self, request: OpenInEditorRequest) -> Result<(), String>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ToolOutput {
    pub text: String,
    pub is_error: bool,
    /// For the activity list in Settings.
    pub connection_name: Option<String>,
    pub summary: Option<String>,
}

impl ToolOutput {
    fn json(value: Value) -> Self {
        Self { text: value.to_string(), is_error: false, connection_name: None, summary: None }
    }

    fn text(text: impl Into<String>) -> Self {
        Self { text: text.into(), is_error: false, connection_name: None, summary: None }
    }

    pub(crate) fn error(message: impl Into<String>) -> Self {
        Self { text: message.into(), is_error: true, connection_name: None, summary: None }
    }

    fn on(mut self, connection: &ConnectionSummary) -> Self {
        self.connection_name = Some(connection.name.clone());
        self
    }

    fn summarized(mut self, summary: impl Into<String>) -> Self {
        self.summary = Some(summary.into());
        self
    }
}

/// Tool names the bridge accepts in `tools/call`.
pub(crate) fn is_known_tool(name: &str) -> bool {
    [LIST_CONNECTIONS, GET_SCHEMA, RUN_READONLY_QUERY, EXPLAIN_QUERY, OPEN_IN_EDITOR].contains(&name)
}

/// The `tools/list` payload.
pub(crate) fn tool_definitions() -> Value {
    let connection_id = json!({
        "type": "string",
        "description": "Connection id from list_connections."
    });
    let read_only = json!({
        "readOnlyHint": true,
        "destructiveHint": false,
        "idempotentHint": true,
        "openWorldHint": false
    });
    json!([
        {
            "name": LIST_CONNECTIONS,
            "title": "List connections",
            "description": "List the databases the user shared with AI tools in VeloxDB (name, engine, database, location). Call this first: every other tool takes a connection_id from here.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false },
            "annotations": read_only,
        },
        {
            "name": GET_SCHEMA,
            "title": "Get schema",
            "description": "Read a database's schema from VeloxDB's catalog, without querying information_schema. No options: every table with row estimates. `search`: tables matching the keywords with their columns and the foreign keys between them. `table`: one table in full (columns, types, nullability, primary key, enum values, foreign keys).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "connection_id": connection_id,
                    "search": { "type": "string", "description": "Keywords, e.g. \"orders customers revenue\"." },
                    "table": { "type": "string", "description": "One table, as schema.table or table." },
                    "refresh": { "type": "boolean", "description": "Re-read the catalog from the database, e.g. after a schema change.", "default": false }
                },
                "required": ["connection_id"],
                "additionalProperties": false
            },
            "annotations": read_only,
        },
        {
            "name": RUN_READONLY_QUERY,
            "title": "Run read-only query",
            "description": format!(
                "Run one read-only SELECT (or EXPLAIN) and return up to max_rows rows. The database enforces read-only: the query runs in a read-only transaction that is always rolled back, and stops after {}s. Anything that writes is refused; call open_in_editor instead so the user can review and run it.",
                QUERY_TIMEOUT_MS / 1000
            ),
            "inputSchema": {
                "type": "object",
                "properties": {
                    "connection_id": connection_id,
                    "sql": { "type": "string", "description": "One SELECT, WITH ... SELECT, VALUES or EXPLAIN statement." },
                    "max_rows": { "type": "integer", "minimum": 1, "maximum": MAX_ROWS_LIMIT, "default": DEFAULT_MAX_ROWS, "description": "Rows to return." }
                },
                "required": ["connection_id", "sql"],
                "additionalProperties": false
            },
            "annotations": read_only,
        },
        {
            "name": EXPLAIN_QUERY,
            "title": "Explain query",
            "description": "Show the database's plan for a read-only SELECT without running it (EXPLAIN without ANALYZE). Use it to check indexes and joins before running a heavy query.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "connection_id": connection_id,
                    "sql": { "type": "string", "description": "The SELECT to explain, without EXPLAIN." }
                },
                "required": ["connection_id", "sql"],
                "additionalProperties": false
            },
            "annotations": read_only,
        },
        {
            "name": OPEN_IN_EDITOR,
            "title": "Open SQL in VeloxDB",
            "description": "Open SQL in a new VeloxDB editor tab for the user to review and run. Nothing is executed. Use it for anything that writes (INSERT, UPDATE, DELETE, DDL, migrations) and for queries the user wants to keep working on.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "connection_id": connection_id,
                    "sql": { "type": "string", "description": "SQL to put in the editor." },
                    "title": { "type": "string", "description": "Short description of what the SQL does." }
                },
                "required": ["connection_id", "sql"],
                "additionalProperties": false
            },
            "annotations": {
                "readOnlyHint": false,
                "destructiveHint": false,
                "idempotentHint": false,
                "openWorldHint": false
            },
        },
    ])
}

/// Runs one tool. Failures come back as an error result the agent can read,
/// never as a panic or a protocol error.
pub(crate) async fn call_tool<B: McpBackend>(
    backend: &B,
    name: &str,
    arguments: &Value,
    client: &str,
) -> ToolOutput {
    let empty = json!({});
    let args = if arguments.is_object() { arguments } else { &empty };
    let outcome = match name {
        LIST_CONNECTIONS => list_connections(backend),
        GET_SCHEMA => get_schema(backend, args).await,
        RUN_READONLY_QUERY => run_readonly_query(backend, args).await,
        EXPLAIN_QUERY => explain_query(backend, args).await,
        OPEN_IN_EDITOR => open_in_editor(backend, args, client),
        other => Err(format!("Unknown tool: {}", other)),
    };
    outcome.unwrap_or_else(ToolOutput::error)
}

fn is_shared(connection: &ConnectionSummary) -> bool {
    connection.allow_ai_tools && enforces_readonly_in_database(connection.engine)
}

fn str_arg<'a>(args: &'a Value, key: &str) -> Option<&'a str> {
    args.get(key).and_then(Value::as_str).map(str::trim).filter(|value| !value.is_empty())
}

fn required_sql(args: &Value) -> Result<String, String> {
    let sql = str_arg(args, "sql").ok_or("sql is required.")?;
    if sql.chars().count() > MAX_SQL_CHARS {
        return Err(format!("sql is longer than {} characters.", MAX_SQL_CHARS));
    }
    Ok(sql.to_string())
}

/// The shared connection named by `connection_id`. A connection that exists
/// but is not shared gets the same answer as one that does not exist.
fn shared_connection<B: McpBackend>(backend: &B, args: &Value) -> Result<ConnectionSummary, String> {
    let id = str_arg(args, "connection_id")
        .ok_or("connection_id is required. Call list_connections to get one.")?;
    backend
        .connections()?
        .into_iter()
        .find(|connection| connection.id == id && is_shared(connection))
        .ok_or_else(|| {
            format!(
                "Connection \"{}\" is not available to AI tools. Use an id from list_connections. {}",
                id, SHARE_HINT
            )
        })
}

fn engine_name(engine: DatabaseEngine) -> String {
    serde_json::to_value(engine)
        .ok()
        .and_then(|value| value.as_str().map(str::to_string))
        .unwrap_or_else(|| format!("{:?}", engine).to_lowercase())
}

fn location(connection: &ConnectionSummary) -> String {
    if connection.engine == DatabaseEngine::Sqlite {
        return connection.file_path.clone().unwrap_or_else(|| connection.database.clone());
    }
    let mut location = if connection.port == 0 {
        connection.host.clone()
    } else {
        format!("{}:{}", connection.host, connection.port)
    };
    if connection.ssh_config.as_ref().is_some_and(|ssh| ssh.is_active()) {
        location.push_str(" (via SSH)");
    }
    location
}

/// First line of the SQL, short enough for the activity list.
fn sql_summary(sql: &str) -> String {
    let line = sql.split_whitespace().collect::<Vec<_>>().join(" ");
    clip(&line, 140).0
}

fn clip(value: &str, max_chars: usize) -> (String, bool) {
    match value.char_indices().nth(max_chars) {
        Some((cut, _)) => (format!("{}…", &value[..cut]), true),
        None => (value.to_string(), false),
    }
}

fn list_connections<B: McpBackend>(backend: &B) -> Result<ToolOutput, String> {
    let all = backend.connections()?;
    let shared: Vec<Value> = all
        .iter()
        .filter(|connection| is_shared(connection))
        .map(|connection| {
            json!({
                "id": connection.id,
                "name": connection.name,
                "engine": engine_name(connection.engine),
                "database": connection.database,
                "location": location(connection),
            })
        })
        .collect();
    let hidden = all.len() - shared.len();
    let mut result = json!({ "connections": shared });
    if shared.is_empty() {
        result["note"] = json!(format!("No connections are shared with AI tools yet. {}", SHARE_HINT));
    } else if hidden > 0 {
        result["note"] = json!(format!(
            "{} other saved connection{} not shared with AI tools.",
            hidden,
            if hidden == 1 { " is" } else { "s are" }
        ));
    }
    Ok(ToolOutput::json(result))
}

async fn get_schema<B: McpBackend>(backend: &B, args: &Value) -> Result<ToolOutput, String> {
    let connection = shared_connection(backend, args)?;
    let refresh = args.get("refresh").and_then(Value::as_bool).unwrap_or(false);
    let catalog = backend.catalog(&connection.id, connection.engine, refresh).await?;

    if let Some(reference) = str_arg(args, "table") {
        let matches = schema::find_tables(&catalog.metadata, reference);
        let output = match matches.as_slice() {
            [] => {
                let suggestions = schema::search(&catalog.metadata, &catalog.foreign_keys, reference);
                let names: Vec<String> = suggestions["tables"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .take(5)
                    .map(|table| format!("{}.{}", table["schema"].as_str().unwrap_or(""), table["name"].as_str().unwrap_or("")))
                    .collect();
                return Err(format!(
                    "No table \"{}\" in the catalog. Closest: {}. Pass refresh: true if it was just created.",
                    reference,
                    if names.is_empty() { "none".to_string() } else { names.join(", ") }
                ));
            }
            [table] => schema::describe(&catalog, table),
            several => json!({
                "note": "Several schemas have a table with this name; pass schema.table for just one.",
                "tables": several.iter().take(5).map(|table| schema::describe(&catalog, table)).collect::<Vec<_>>(),
            }),
        };
        return Ok(ToolOutput::json(output).on(&connection).summarized(format!("table {}", reference)));
    }
    if let Some(query) = str_arg(args, "search") {
        let result = schema::search(&catalog.metadata, &catalog.foreign_keys, query);
        return Ok(ToolOutput::json(result).on(&connection).summarized(format!("search \"{}\"", query)));
    }
    Ok(ToolOutput::json(schema::overview(&catalog)).on(&connection).summarized("overview"))
}

/// Explains why SQL was not run, pointing the agent at the editor for writes.
fn not_run(reason: String) -> String {
    format!("Not run: {} {}", reason.trim_end(), WRITE_HINT)
}

fn map_query_error(message: String) -> String {
    let lower = message.to_lowercase();
    if lower.contains("statement timeout") || lower.contains("canceling statement") || lower.contains("timed out") {
        return format!(
            "Query timed out after {}s. Narrow it with filters, aggregates or LIMIT, or check its plan with explain_query.",
            QUERY_TIMEOUT_MS / 1000
        );
    }
    if lower.contains("read-only transaction") || lower.contains("readonly database") || lower.contains("read only transaction") || lower.contains("read-only") && lower.contains("cannot") {
        return not_run(format!("the database refused a write ({}).", message.trim()));
    }
    message
}

/// Rows as arrays under `columns`, with long values cut and the whole output
/// kept under `MAX_OUTPUT_CHARS`.
fn result_json(result: &QueryResult, max_rows: usize) -> Value {
    let mut rows: Vec<Value> = Vec::new();
    let mut used = serde_json::to_string(&result.columns).map(|s| s.len()).unwrap_or(0);
    let mut cut_cells = false;
    let mut cut_rows = false;
    for row in &result.rows {
        let values: Vec<Value> = result
            .columns
            .iter()
            .map(|column| match row.get(column).cloned().flatten() {
                Some(value) => {
                    let (value, cut) = clip(&value, MAX_CELL_CHARS);
                    cut_cells |= cut;
                    Value::String(value)
                }
                None => Value::Null,
            })
            .collect();
        let size = serde_json::to_string(&values).map(|s| s.len()).unwrap_or(0) + 1;
        if !rows.is_empty() && used + size > MAX_OUTPUT_CHARS {
            cut_rows = true;
            break;
        }
        used += size;
        rows.push(Value::Array(values));
    }

    let mut notes: Vec<String> = Vec::new();
    if cut_rows {
        notes.push(format!(
            "Output trimmed to {} rows to stay under {} characters; select fewer columns or rows.",
            rows.len(),
            MAX_OUTPUT_CHARS
        ));
    } else if result.truncated {
        notes.push(format!(
            "Only the first {} rows are shown. Add filters, aggregates or LIMIT, or raise max_rows (up to {}).",
            max_rows, MAX_ROWS_LIMIT
        ));
    }
    if cut_cells {
        notes.push(format!("Values longer than {} characters were cut.", MAX_CELL_CHARS));
    }
    let mut output = json!({
        "columns": result.columns,
        "rows": rows,
        "rowCount": rows.len(),
        "truncated": result.truncated || cut_rows,
        "executionMs": result.execution_ms,
    });
    if !notes.is_empty() {
        output["note"] = json!(notes.join(" "));
    }
    output
}

async fn run_readonly_query<B: McpBackend>(backend: &B, args: &Value) -> Result<ToolOutput, String> {
    let connection = shared_connection(backend, args)?;
    let sql = required_sql(args)?;
    let max_rows = args
        .get("max_rows")
        .and_then(Value::as_u64)
        .map(|rows| rows.clamp(1, MAX_ROWS_LIMIT as u64) as usize)
        .unwrap_or(DEFAULT_MAX_ROWS);
    let kind = check_agent_readonly_sql(&sql, connection.engine).map_err(not_run)?;
    let result = backend
        .run_readonly(&connection.id, connection.engine, &sql, kind, max_rows, QUERY_TIMEOUT_MS)
        .await
        .map_err(map_query_error)?;
    Ok(ToolOutput::json(result_json(&result, max_rows)).on(&connection).summarized(sql_summary(&sql)))
}

fn explain_sql(engine: DatabaseEngine, sql: &str) -> String {
    match engine {
        DatabaseEngine::Sqlite | DatabaseEngine::Libsql | DatabaseEngine::Turso => {
            format!("EXPLAIN QUERY PLAN {}", sql)
        }
        _ => format!("EXPLAIN {}", sql),
    }
}

async fn explain_query<B: McpBackend>(backend: &B, args: &Value) -> Result<ToolOutput, String> {
    let connection = shared_connection(backend, args)?;
    let sql = required_sql(args)?;
    match check_agent_readonly_sql(&sql, connection.engine).map_err(not_run)? {
        AgentStatement::Query => {}
        AgentStatement::Explain => {
            return Err("Pass the statement without EXPLAIN; explain_query adds it. To run EXPLAIN ANALYZE, use run_readonly_query.".to_string());
        }
    }
    let plan_sql = explain_sql(connection.engine, sql.trim().trim_end_matches(';'));
    let kind = check_agent_readonly_sql(&plan_sql, connection.engine).map_err(not_run)?;
    let result = backend
        .run_readonly(&connection.id, connection.engine, &plan_sql, kind, EXPLAIN_MAX_ROWS, QUERY_TIMEOUT_MS)
        .await
        .map_err(map_query_error)?;
    // Postgres returns the plan as one text column, one row per line.
    let output = if result.columns.len() == 1 {
        let column = &result.columns[0];
        let lines: Vec<String> = result
            .rows
            .iter()
            .map(|row| row.get(column).cloned().flatten().unwrap_or_default())
            .collect();
        json!({ "planSql": plan_sql, "plan": lines.join("\n"), "truncated": result.truncated })
    } else {
        let mut table = result_json(&result, EXPLAIN_MAX_ROWS);
        table["planSql"] = json!(plan_sql);
        table
    };
    Ok(ToolOutput::json(output).on(&connection).summarized(sql_summary(&sql)))
}

fn open_in_editor<B: McpBackend>(backend: &B, args: &Value, client: &str) -> Result<ToolOutput, String> {
    let connection = shared_connection(backend, args)?;
    let sql = required_sql(args)?;
    let title = str_arg(args, "title").map(|title| clip(title, MAX_TITLE_CHARS).0);
    backend.open_in_editor(OpenInEditorRequest {
        connection_id: connection.id.clone(),
        sql: sql.clone(),
        title,
        client: client.to_string(),
    })?;
    Ok(ToolOutput::text(format!(
        "Opened in a new VeloxDB editor tab on \"{}\". Nothing was run: the user reviews the SQL and runs it themselves, and you will not see the result unless they share it.",
        connection.name
    ))
    .on(&connection)
    .summarized(sql_summary(&sql)))
}

#[cfg(test)]
pub(crate) mod tests {
    use std::collections::HashMap;
    use std::sync::Mutex;

    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
    use sqlx::SqlitePool;

    use super::*;
    use crate::models::{ConnectionSslMode, DatabaseEngine};

    /// Real SQLite databases behind the real read-only runner, with a fixed
    /// catalog, so the handlers are tested end to end without Tauri.
    pub(crate) struct FakeBackend {
        pub connections: Vec<ConnectionSummary>,
        pub pools: HashMap<String, SqlitePool>,
        pub opened: Mutex<Vec<OpenInEditorRequest>>,
        _files: Vec<TempFile>,
    }

    pub(crate) struct TempFile(std::path::PathBuf);

    impl Drop for TempFile {
        fn drop(&mut self) {
            for suffix in ["", "-wal", "-shm"] {
                let mut name = self.0.clone().into_os_string();
                name.push(suffix);
                let _ = std::fs::remove_file(name);
            }
        }
    }

    pub(crate) fn summary(id: &str, engine: DatabaseEngine, allow: bool) -> ConnectionSummary {
        ConnectionSummary {
            id: id.to_string(),
            name: format!("{} db", id),
            engine,
            host: "localhost".into(),
            port: 5432,
            database: "shop".into(),
            file_path: None,
            user: "me".into(),
            connected_at: "0".into(),
            ssl_mode: ConnectionSslMode::Disable,
            ssh_config: None,
            extra_params: None,
            table_property_editing_supported: false,
            allow_ai_tools: allow,
        }
    }

    impl FakeBackend {
        /// `shared` (SQLite, shared), `private` (SQLite, not shared) and
        /// `mongo` (shared but unsupported engine).
        pub(crate) async fn new() -> Self {
            let mut pools = HashMap::new();
            let mut files = Vec::new();
            let mut connections = Vec::new();
            for (id, allow) in [("shared", true), ("private", false)] {
                let path = std::env::temp_dir().join(format!("veloxdb-mcp-{}-{}.sqlite", id, uuid::Uuid::new_v4()));
                let options = SqliteConnectOptions::new()
                    .filename(&path)
                    .create_if_missing(true)
                    .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal);
                let pool = SqlitePoolOptions::new().max_connections(2).connect_with(options).await.expect("pool");
                sqlx::raw_sql(
                    "CREATE TABLE customers (id INTEGER PRIMARY KEY, email TEXT);
                     CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER, total REAL, note TEXT);
                     INSERT INTO customers (email) VALUES ('a@x.io'), ('b@x.io');
                     INSERT INTO orders (customer_id, total, note) VALUES (1, 10.5, 'first'), (1, 20, NULL), (2, 7.25, 'third');",
                )
                .execute(&pool)
                .await
                .expect("seed");
                let mut connection = summary(id, DatabaseEngine::Sqlite, allow);
                connection.file_path = Some(path.to_string_lossy().to_string());
                connections.push(connection);
                pools.insert(id.to_string(), pool);
                files.push(TempFile(path));
            }
            connections.push(summary("mongo", DatabaseEngine::Mongo, true));
            Self { connections, pools, opened: Mutex::new(Vec::new()), _files: files }
        }

        pub(crate) async fn order_count(&self, id: &str) -> i64 {
            sqlx::query_scalar("SELECT count(*) FROM orders").fetch_one(&self.pools[id]).await.expect("count")
        }
    }

    impl McpBackend for FakeBackend {
        fn connections(&self) -> Result<Vec<ConnectionSummary>, String> {
            Ok(self.connections.clone())
        }

        async fn catalog(&self, _id: &str, _engine: DatabaseEngine, _refresh: bool) -> Result<AskVeloxyDbContextCache, String> {
            Ok(schema::tests::sample_context())
        }

        async fn run_readonly(
            &self,
            connection_id: &str,
            _engine: DatabaseEngine,
            sql: &str,
            _kind: AgentStatement,
            max_rows: usize,
            timeout_ms: u64,
        ) -> Result<QueryResult, String> {
            let pool = self.pools.get(connection_id).ok_or("no pool")?;
            crate::engines::readonly_sqlite_for_tests(pool, sql, max_rows, timeout_ms).await
        }

        fn open_in_editor(&self, request: OpenInEditorRequest) -> Result<(), String> {
            self.opened.lock().unwrap().push(request);
            Ok(())
        }
    }

    async fn call(backend: &FakeBackend, name: &str, args: Value) -> (Value, ToolOutput) {
        let output = call_tool(backend, name, &args, "test-client").await;
        let parsed = serde_json::from_str(&output.text).unwrap_or(Value::Null);
        (parsed, output)
    }

    #[tokio::test]
    async fn list_connections_shows_only_shared_supported_connections() {
        let backend = FakeBackend::new().await;
        let (result, output) = call(&backend, LIST_CONNECTIONS, json!({})).await;
        assert!(!output.is_error);
        let connections = result["connections"].as_array().unwrap();
        assert_eq!(connections.len(), 1);
        assert_eq!(connections[0]["id"], "shared");
        assert_eq!(connections[0]["engine"], "sqlite");
        assert!(result["note"].as_str().unwrap().contains("2 other saved connections"));
    }

    #[tokio::test]
    async fn list_connections_explains_how_to_share_when_none_are() {
        let mut backend = FakeBackend::new().await;
        backend.connections.iter_mut().for_each(|c| c.allow_ai_tools = false);
        let (result, _) = call(&backend, LIST_CONNECTIONS, json!({})).await;
        assert!(result["connections"].as_array().unwrap().is_empty());
        assert!(result["note"].as_str().unwrap().contains("Allow AI tools on this connection"));
    }

    #[tokio::test]
    async fn tools_refuse_connections_that_are_not_shared() {
        let backend = FakeBackend::new().await;
        for id in ["private", "mongo", "missing"] {
            for tool in [GET_SCHEMA, RUN_READONLY_QUERY, EXPLAIN_QUERY, OPEN_IN_EDITOR] {
                let (_, output) = call(&backend, tool, json!({ "connection_id": id, "sql": "SELECT 1" })).await;
                assert!(output.is_error, "{tool} on {id}");
                assert!(output.text.contains("not available to AI tools"), "{tool} on {id}: {}", output.text);
            }
        }
        assert!(backend.opened.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn run_readonly_query_returns_capped_rows() {
        let backend = FakeBackend::new().await;
        let (result, output) = call(
            &backend,
            RUN_READONLY_QUERY,
            json!({ "connection_id": "shared", "sql": "SELECT id, total, note FROM orders ORDER BY id", "max_rows": 2 }),
        )
        .await;
        assert!(!output.is_error, "{}", output.text);
        assert_eq!(result["columns"], json!(["id", "total", "note"]));
        assert_eq!(result["rows"], json!([["1", "10.5", "first"], ["2", "20", null]]));
        assert_eq!(result["truncated"], json!(true));
        assert!(result["note"].as_str().unwrap().contains("first 2 rows"));
        assert_eq!(output.connection_name.as_deref(), Some("shared db"));
        assert_eq!(output.summary.as_deref(), Some("SELECT id, total, note FROM orders ORDER BY id"));
    }

    #[tokio::test]
    async fn run_readonly_query_never_writes() {
        let backend = FakeBackend::new().await;
        for sql in [
            "DELETE FROM orders",
            "UPDATE orders SET total = 0",
            "INSERT INTO orders (total) VALUES (1)",
            "DROP TABLE orders",
            "SELECT 1; DELETE FROM orders",
            "WITH d AS (DELETE FROM orders RETURNING *) SELECT * FROM d",
            "PRAGMA query_only = OFF",
            "ATTACH DATABASE '/tmp/x.db' AS x",
            "SELECT load_extension('x')",
        ] {
            let (_, output) = call(&backend, RUN_READONLY_QUERY, json!({ "connection_id": "shared", "sql": sql })).await;
            assert!(output.is_error, "should refuse: {sql}");
            assert!(output.text.contains("open_in_editor"), "should point at the editor: {}", output.text);
        }
        assert_eq!(backend.order_count("shared").await, 3);
    }

    #[tokio::test]
    async fn long_values_are_cut() {
        let backend = FakeBackend::new().await;
        let (result, _) = call(
            &backend,
            RUN_READONLY_QUERY,
            json!({ "connection_id": "shared", "sql": "SELECT printf('%.5000c', 'x') AS big" }),
        )
        .await;
        let value = result["rows"][0][0].as_str().unwrap();
        assert_eq!(value.chars().count(), MAX_CELL_CHARS + 1);
        assert!(result["note"].as_str().unwrap().contains("were cut"));
    }

    #[tokio::test]
    async fn explain_query_returns_a_plan_without_running() {
        let backend = FakeBackend::new().await;
        let (result, output) = call(
            &backend,
            EXPLAIN_QUERY,
            json!({ "connection_id": "shared", "sql": "SELECT * FROM orders WHERE customer_id = 1;" }),
        )
        .await;
        assert!(!output.is_error, "{}", output.text);
        assert_eq!(result["planSql"], "EXPLAIN QUERY PLAN SELECT * FROM orders WHERE customer_id = 1");
        assert!(result["rows"].as_array().is_some_and(|rows| !rows.is_empty()), "{result}");

        let (_, output) = call(&backend, EXPLAIN_QUERY, json!({ "connection_id": "shared", "sql": "DELETE FROM orders" })).await;
        assert!(output.is_error);
        let (_, output) = call(&backend, EXPLAIN_QUERY, json!({ "connection_id": "shared", "sql": "EXPLAIN SELECT 1" })).await;
        assert!(output.is_error);
        assert!(output.text.contains("without EXPLAIN"));
    }

    #[tokio::test]
    async fn get_schema_searches_and_describes() {
        let backend = FakeBackend::new().await;
        let (overview, _) = call(&backend, GET_SCHEMA, json!({ "connection_id": "shared" })).await;
        assert_eq!(overview["tables"].as_array().unwrap().len(), 4);

        let (found, _) = call(&backend, GET_SCHEMA, json!({ "connection_id": "shared", "search": "orders" })).await;
        assert_eq!(found["tables"][0]["name"], "orders");

        let (table, _) = call(&backend, GET_SCHEMA, json!({ "connection_id": "shared", "table": "public.orders" })).await;
        assert_eq!(table["name"], "orders");
        assert_eq!(table["columns"][2]["enumValues"], json!(["open", "paid"]));

        let (_, missing) = call(&backend, GET_SCHEMA, json!({ "connection_id": "shared", "table": "order" })).await;
        assert!(missing.is_error);
        assert!(missing.text.contains("public.orders"), "suggests a close match: {}", missing.text);
    }

    #[tokio::test]
    async fn open_in_editor_hands_sql_to_the_editor_and_runs_nothing() {
        let backend = FakeBackend::new().await;
        let (_, output) = call(
            &backend,
            OPEN_IN_EDITOR,
            json!({ "connection_id": "shared", "sql": "DELETE FROM orders WHERE id = 1", "title": "Remove order 1" }),
        )
        .await;
        assert!(!output.is_error, "{}", output.text);
        assert!(output.text.contains("Nothing was run"));
        assert_eq!(
            backend.opened.lock().unwrap().as_slice(),
            &[OpenInEditorRequest {
                connection_id: "shared".into(),
                sql: "DELETE FROM orders WHERE id = 1".into(),
                title: Some("Remove order 1".into()),
                client: "test-client".into(),
            }]
        );
        assert_eq!(backend.order_count("shared").await, 3);
    }

    #[tokio::test]
    async fn bad_arguments_come_back_as_tool_errors() {
        let backend = FakeBackend::new().await;
        let (_, output) = call(&backend, RUN_READONLY_QUERY, json!({ "connection_id": "shared" })).await;
        assert!(output.is_error);
        assert_eq!(output.text, "sql is required.");
        let (_, output) = call(&backend, RUN_READONLY_QUERY, Value::Null).await;
        assert!(output.text.contains("connection_id is required"));
        let (_, output) = call(&backend, "drop_database", json!({})).await;
        assert!(output.is_error);
    }

    #[test]
    fn every_definition_is_a_known_tool() {
        let definitions = tool_definitions();
        let names: Vec<&str> = definitions.as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap()).collect();
        assert_eq!(names, vec![LIST_CONNECTIONS, GET_SCHEMA, RUN_READONLY_QUERY, EXPLAIN_QUERY, OPEN_IN_EDITOR]);
        assert!(names.iter().all(|name| is_known_tool(name)));
        for tool in definitions.as_array().unwrap() {
            assert_eq!(tool["inputSchema"]["type"], "object");
        }
    }
}
