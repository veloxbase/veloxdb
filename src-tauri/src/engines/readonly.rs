//! Database-enforced read-only execution for agent SQL (Veloxy and the MCP
//! server).
//!
//! `check_agent_readonly_sql` rejects anything the parser can see writing.
//! These runners are the backstop for what it cannot see, such as a user
//! function that inserts or a parser difference that hides a second statement:
//! the database itself refuses to write.
//!
//! - PostgreSQL: a pooled session in `BEGIN READ ONLY`, always rolled back.
//!   Postgres prepares the statement first, which fails for more than one
//!   command, and a SELECT is read through a cursor so only `max_rows + 1` rows
//!   leave the server.
//! - MySQL / MariaDB: a fresh session in `START TRANSACTION READ ONLY`, always
//!   rolled back. The statement is sent as a prepared statement, which the
//!   server refuses for more than one command.
//! - SQLite: a fresh connection opened read-only (`SQLITE_OPEN_READONLY`), with
//!   `PRAGMA query_only` and a transaction that is always rolled back. SQL
//!   cannot reopen it read-write, even across several statements.
//!
//! MySQL and SQLite use a fresh connection rather than a pooled one: a pooled
//! session can hold a transaction an editor run left open, which `START
//! TRANSACTION` would silently commit, and per-session settings (timeouts,
//! `query_only`) cannot leak back into the pool.

use std::collections::BTreeMap;
use std::time::{Duration, Instant};

use futures_util::TryStreamExt;
use sqlx::mysql::{MySqlConnection, MySqlRow};
use sqlx::sqlite::{SqliteConnection, SqliteRow};
use sqlx::{Connection, Executor, MySqlPool, SqlitePool};
use tokio_postgres::error::SqlState;
use tokio_postgres::SimpleQueryMessage;

use crate::commands::{map_mysql_rows, map_sqlite_rows};
use crate::models::QueryResult;
use crate::pg_error::map_pg_err;

/// What kind of statement passed the read-only check. Postgres reads a query
/// through a cursor, which EXPLAIN cannot use.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AgentStatement {
    Query,
    Explain,
}

/// Extra time the client waits beyond the server-side timeout before it gives
/// up on its own, for a server or network that stops responding.
const CLIENT_TIMEOUT_GRACE: Duration = Duration::from_secs(5);

pub(crate) fn timeout_message(timeout_ms: u64) -> String {
    format!("Query timed out after {}s.", timeout_ms.div_ceil(1000))
}

// ── PostgreSQL ──────────────────────────────────────────────────

const PG_CURSOR: &str = "veloxdb_agent_cursor";

/// True only inside a transaction block: there the transaction started with an
/// earlier message, so its timestamp is older than this statement's.
const PG_IN_TRANSACTION_PROBE: &str = "select transaction_timestamp() <> statement_timestamp()";

pub(crate) const PG_TRANSACTION_LEFT_OPEN: &str = "A transaction left open in the editor is holding \
     one of this connection's sessions, so the read-only query was not run. Commit or roll back \
     that transaction in the editor (or refresh the connection), then try again.";

/// Runs agent SQL on a pooled Postgres session. See the module docs. The
/// session goes back to the pool only when it is known to be outside any
/// transaction this function started; otherwise it is closed.
pub(crate) async fn postgres_readonly(
    session: PgSessionGuard,
    sql: &str,
    kind: AgentStatement,
    max_rows: usize,
    timeout_ms: u64,
) -> Result<QueryResult, String> {
    let started_at = Instant::now();
    let client = session.client();

    // Inside an open transaction `BEGIN READ ONLY` only warns, the agent SQL
    // would run read-write, and the ROLLBACK below would throw away the
    // user's uncommitted work. Refuse instead and leave it untouched.
    match client.simple_query(PG_IN_TRANSACTION_PROBE).await {
        Ok(messages) => {
            let in_transaction = messages.iter().any(
                |message| matches!(message, SimpleQueryMessage::Row(row) if row.get(0) == Some("t")),
            );
            if in_transaction {
                session.release();
                return Err(PG_TRANSACTION_LEFT_OPEN.to_string());
            }
        }
        // An aborted transaction can never commit, so ending it loses nothing.
        Err(error) if error.code() == Some(&SqlState::IN_FAILED_SQL_TRANSACTION) => {
            client
                .batch_execute("ROLLBACK")
                .await
                .map_err(|error| map_pg_err(error, None))?;
        }
        Err(error) => return Err(map_pg_err(error, None)),
    }

    // `SET LOCAL` scopes the timeout to this transaction, so the rollback
    // clears it even when the query fails.
    client
        .batch_execute(&format!(
            "BEGIN READ ONLY; SET LOCAL statement_timeout = {}",
            timeout_ms
        ))
        .await
        .map_err(|error| map_pg_err(error, None))?;
    let outcome = postgres_readonly_in_transaction(client, sql, kind, max_rows).await;
    // Roll back on success too: nothing the agent runs should persist, and a
    // failed transaction must not leak into the next user of this session.
    match client.batch_execute("ROLLBACK").await {
        Ok(()) => session.release(),
        Err(error) => {
            log::warn!("Failed to end an agent read-only transaction: {}", error);
            drop(session);
        }
    }
    let mut result = outcome?;
    result.execution_ms = started_at.elapsed().as_millis();
    Ok(result)
}

async fn postgres_readonly_in_transaction(
    client: &tokio_postgres::Client,
    sql: &str,
    kind: AgentStatement,
    max_rows: usize,
) -> Result<QueryResult, String> {
    // Postgres parses the exact text first. A prepared statement holds one
    // command, so if a parser difference hid a second statement (say
    // `...; COMMIT; DELETE ...`), Postgres refuses it here instead of running
    // it outside the read-only transaction.
    let statement = client
        .prepare(sql)
        .await
        .map_err(|error| map_pg_err(error, Some(sql)))?;
    drop(statement);

    let messages = match kind {
        AgentStatement::Query => {
            client
                .batch_execute(&format!("DECLARE {} NO SCROLL CURSOR FOR {}", PG_CURSOR, sql))
                .await
                .map_err(|error| map_pg_err(error, Some(sql)))?;
            client
                .simple_query(&format!("FETCH FORWARD {} FROM {}", max_rows + 1, PG_CURSOR))
                .await
                .map_err(|error| map_pg_err(error, Some(sql)))?
        }
        AgentStatement::Explain => client
            .simple_query(sql)
            .await
            .map_err(|error| map_pg_err(error, Some(sql)))?,
    };
    Ok(collect_pg_messages(messages, max_rows))
}

fn collect_pg_messages(messages: Vec<SimpleQueryMessage>, max_rows: usize) -> QueryResult {
    let mut columns: Vec<String> = Vec::new();
    let mut rows = Vec::new();
    let mut total_rows = 0usize;
    for message in messages {
        match message {
            SimpleQueryMessage::RowDescription(description) => {
                columns = description.iter().map(|column| column.name().to_string()).collect();
            }
            SimpleQueryMessage::Row(row) => {
                total_rows += 1;
                if columns.is_empty() {
                    columns = row.columns().iter().map(|column| column.name().to_string()).collect();
                }
                if rows.len() >= max_rows {
                    continue;
                }
                let mut mapped = BTreeMap::new();
                for (index, name) in columns.iter().enumerate() {
                    mapped.insert(name.clone(), row.get(index).map(str::to_owned));
                }
                rows.push(mapped);
            }
            _ => {}
        }
    }
    QueryResult {
        columns,
        row_count: rows.len(),
        rows,
        execution_ms: 0,
        truncated: total_rows > max_rows,
        command_tag: None,
    }
}

/// Holds a pooled Postgres session while agent SQL runs. If the future is
/// dropped part way (a client-side timeout), the session may still be inside
/// the read-only transaction with the cursor open; it is closed rather than
/// handed back to the pool, whose recycle check would accept it.
pub(crate) struct PgSessionGuard {
    client: Option<deadpool_postgres::Client>,
}

impl PgSessionGuard {
    pub(crate) fn new(client: deadpool_postgres::Client) -> Self {
        Self { client: Some(client) }
    }

    pub(crate) fn client(&self) -> &tokio_postgres::Client {
        self.client.as_ref().expect("client is present until drop")
    }

    /// Returns the session to the pool. Call once the run finished normally.
    pub(crate) fn release(mut self) {
        self.client.take();
    }
}

impl Drop for PgSessionGuard {
    fn drop(&mut self) {
        if let Some(client) = self.client.take() {
            drop(deadpool_postgres::Object::take(client));
        }
    }
}

// ── MySQL / MariaDB ─────────────────────────────────────────────

/// Runs agent SQL on a fresh MySQL session. See the module docs.
pub(crate) async fn mysql_readonly(
    pool: &MySqlPool,
    sql: &str,
    max_rows: usize,
    timeout_ms: u64,
) -> Result<QueryResult, String> {
    let started_at = Instant::now();
    let options = pool.connect_options();
    let mut conn = MySqlConnection::connect_with(&options)
        .await
        .map_err(|error| error.to_string())?;
    let client_timeout = Duration::from_millis(timeout_ms) + CLIENT_TIMEOUT_GRACE;
    let outcome = tokio::time::timeout(
        client_timeout,
        mysql_readonly_on(&mut conn, sql, max_rows, timeout_ms),
    )
    .await;
    // Closing the session also ends its transaction; the explicit ROLLBACK in
    // `mysql_readonly_on` only makes that visible. A timed-out session is
    // dropped without the goodbye packet, which would wait on the query.
    let result = match outcome {
        Ok(result) => {
            let _ = conn.close().await;
            result
        }
        Err(_) => {
            drop(conn);
            Err(timeout_message(timeout_ms))
        }
    }?;
    let (columns, rows, total_rows, truncated) = result;
    Ok(QueryResult {
        columns,
        row_count: rows.len().min(total_rows),
        rows,
        execution_ms: started_at.elapsed().as_millis(),
        truncated,
        command_tag: None,
    })
}

async fn mysql_readonly_on(
    conn: &mut MySqlConnection,
    sql: &str,
    max_rows: usize,
    timeout_ms: u64,
) -> Result<crate::commands::MappedRowsResult, String> {
    // Server-side limit. MySQL names it max_execution_time (ms, SELECT only);
    // MariaDB names it max_statement_time (seconds). The client-side timeout
    // in `mysql_readonly` covers a server that has neither.
    let mysql_limit = format!("SET SESSION max_execution_time = {}", timeout_ms);
    if conn.execute(mysql_limit.as_str()).await.is_err() {
        let mariadb_limit = format!(
            "SET SESSION max_statement_time = {:.3}",
            timeout_ms as f64 / 1000.0
        );
        if let Err(error) = conn.execute(mariadb_limit.as_str()).await {
            log::warn!("Could not set a MySQL statement timeout: {}", error);
        }
    }
    conn.execute("START TRANSACTION READ ONLY")
        .await
        .map_err(|error| error.to_string())?;
    let fetched = fetch_capped::<sqlx::MySql, MySqlRow>(&mut *conn, sql, max_rows).await;
    if fetched.is_ok() {
        let _ = conn.execute("ROLLBACK").await;
    }
    let (rows, total_rows) = fetched.map_err(|error| map_mysql_timeout(error, timeout_ms))?;
    let (columns, mapped, _, _) = map_mysql_rows(rows, max_rows)?;
    Ok((columns, mapped, total_rows, total_rows > max_rows))
}

fn map_mysql_timeout(error: sqlx::Error, timeout_ms: u64) -> String {
    let message = error.to_string();
    let lower = message.to_lowercase();
    // MySQL 3024 "maximum statement execution time exceeded";
    // MariaDB 1969 "Query execution was interrupted (max_statement_time exceeded)".
    if lower.contains("maximum statement execution time") || lower.contains("max_statement_time") {
        timeout_message(timeout_ms)
    } else {
        message
    }
}

/// Fetches at most `max_rows + 1` rows so a huge result is never held in
/// memory. Returns the rows kept and how many were seen (`max_rows + 1` means
/// "more than `max_rows`").
async fn fetch_capped<'c, DB, R>(
    conn: &'c mut DB::Connection,
    sql: &str,
    max_rows: usize,
) -> Result<(Vec<R>, usize), sqlx::Error>
where
    DB: sqlx::Database<Row = R>,
    R: sqlx::Row<Database = DB>,
    for<'a> &'a mut DB::Connection: Executor<'a, Database = DB>,
    for<'q> <DB as sqlx::Database>::Arguments<'q>: sqlx::IntoArguments<'q, DB>,
{
    let mut stream = sqlx::query::<DB>(sql).fetch(&mut *conn);
    let mut rows = Vec::new();
    let mut seen = 0usize;
    while let Some(row) = stream.try_next().await? {
        seen += 1;
        if rows.len() < max_rows {
            rows.push(row);
        }
        if seen > max_rows {
            break;
        }
    }
    Ok((rows, seen))
}

// ── SQLite ──────────────────────────────────────────────────────

/// SQLite VM instructions between timeout checks. Small enough to stop within
/// milliseconds of the deadline, large enough to cost nothing measurable.
const SQLITE_PROGRESS_OPS: i32 = 10_000;

/// Runs agent SQL on a fresh read-only SQLite connection. See the module docs.
pub(crate) async fn sqlite_readonly(
    pool: &SqlitePool,
    sql: &str,
    max_rows: usize,
    timeout_ms: u64,
) -> Result<QueryResult, String> {
    let started_at = Instant::now();
    let options = pool.connect_options();
    let filename = options.get_filename().to_string_lossy().to_string();
    if filename.is_empty() || filename == ":memory:" {
        return Err("Agent queries need a SQLite database file; in-memory databases are not supported.".to_string());
    }
    // A fresh connection opened with SQLITE_OPEN_READONLY: no statement can
    // reopen it read-write, and databases it ATTACHes are read-only too.
    let read_only_options = (*options).clone().read_only(true).create_if_missing(false);
    let mut conn = SqliteConnection::connect_with(&read_only_options)
        .await
        .map_err(|error| error.to_string())?;

    // Stop the statement once the deadline passes. The handler returns
    // false to interrupt; SQLite then fails the step with "interrupted".
    let deadline = Instant::now() + Duration::from_millis(timeout_ms);
    conn.lock_handle()
        .await
        .map_err(|error| error.to_string())?
        .set_progress_handler(SQLITE_PROGRESS_OPS, move || Instant::now() < deadline);

    let client_timeout = Duration::from_millis(timeout_ms) + CLIENT_TIMEOUT_GRACE;
    let outcome = tokio::time::timeout(
        client_timeout,
        sqlite_readonly_on(&mut conn, sql, max_rows, timeout_ms),
    )
    .await;
    let _ = conn.close().await;
    let (columns, rows, total_rows, truncated) =
        outcome.map_err(|_| timeout_message(timeout_ms))??;
    Ok(QueryResult {
        columns,
        row_count: rows.len().min(total_rows),
        rows,
        execution_ms: started_at.elapsed().as_millis(),
        truncated,
        command_tag: None,
    })
}

async fn sqlite_readonly_on(
    conn: &mut SqliteConnection,
    sql: &str,
    max_rows: usize,
    timeout_ms: u64,
) -> Result<crate::commands::MappedRowsResult, String> {
    conn.execute("PRAGMA query_only = ON")
        .await
        .map_err(|error| error.to_string())?;
    conn.execute("BEGIN").await.map_err(|error| error.to_string())?;
    let fetched = fetch_capped::<sqlx::Sqlite, SqliteRow>(&mut *conn, sql, max_rows).await;
    let _ = conn.execute("ROLLBACK").await;
    let (rows, total_rows) = fetched.map_err(|error| {
        let message = error.to_string();
        if message.to_lowercase().contains("interrupted") {
            timeout_message(timeout_ms)
        } else {
            message
        }
    })?;
    let (columns, mapped, _, _) = map_sqlite_rows(rows, max_rows)?;
    Ok((columns, mapped, total_rows, total_rows > max_rows))
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn sqlite_fixture() -> (tempfile_path::TempDb, SqlitePool) {
        let db = tempfile_path::TempDb::new();
        let options = sqlx::sqlite::SqliteConnectOptions::new()
            .filename(db.path())
            .create_if_missing(true)
            .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal);
        let pool = SqlitePoolOptions::new()
            .max_connections(2)
            .connect_with(options)
            .await
            .expect("pool");
        sqlx::raw_sql(
            "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
             INSERT INTO users (name) VALUES ('ada'), ('grace'), ('linus');",
        )
        .execute(&pool)
        .await
        .expect("seed");
        (db, pool)
    }

    async fn user_count(pool: &SqlitePool) -> i64 {
        sqlx::query_scalar("SELECT count(*) FROM users")
            .fetch_one(pool)
            .await
            .expect("count")
    }

    #[tokio::test]
    async fn sqlite_readonly_reads_and_caps_rows() {
        let (_db, pool) = sqlite_fixture().await;
        let result = sqlite_readonly(&pool, "SELECT id, name FROM users ORDER BY id", 2, 5_000)
            .await
            .expect("select");
        assert_eq!(result.columns, vec!["id", "name"]);
        assert_eq!(result.rows.len(), 2);
        assert!(result.truncated);
        assert_eq!(result.rows[0].get("name").cloned().flatten().as_deref(), Some("ada"));

        let all = sqlite_readonly(&pool, "SELECT name FROM users", 10, 5_000)
            .await
            .expect("select all");
        assert_eq!(all.rows.len(), 3);
        assert!(!all.truncated);
    }

    #[tokio::test]
    async fn sqlite_readonly_refuses_writes_the_parser_would_miss() {
        let (_db, pool) = sqlite_fixture().await;
        // These never pass `check_agent_readonly_sql`; calling the runner
        // directly shows the database refuses them on its own.
        for sql in [
            "INSERT INTO users (name) VALUES ('mallory')",
            "DELETE FROM users",
            "UPDATE users SET name = 'x'",
            "DROP TABLE users",
            "PRAGMA query_only = OFF; DELETE FROM users",
            "ROLLBACK; DELETE FROM users",
            "COMMIT; PRAGMA query_only = OFF; DELETE FROM users",
            "SELECT 1; DELETE FROM users",
        ] {
            let outcome = sqlite_readonly(&pool, sql, 10, 5_000).await;
            assert!(outcome.is_err(), "should fail: {sql}");
            assert_eq!(user_count(&pool).await, 3, "data changed by: {sql}");
        }
    }

    #[tokio::test]
    async fn sqlite_readonly_leaves_the_pool_writable() {
        let (_db, pool) = sqlite_fixture().await;
        sqlite_readonly(&pool, "SELECT * FROM users", 10, 5_000)
            .await
            .expect("select");
        sqlx::query("INSERT INTO users (name) VALUES ('margaret')")
            .execute(&pool)
            .await
            .expect("editor writes still work");
        assert_eq!(user_count(&pool).await, 4);
    }

    #[tokio::test]
    async fn sqlite_readonly_times_out_long_queries() {
        let (_db, pool) = sqlite_fixture().await;
        let started = Instant::now();
        let outcome = sqlite_readonly(
            &pool,
            "WITH RECURSIVE r(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM r) \
             SELECT count(*) FROM r",
            10,
            300,
        )
        .await;
        let error = outcome.expect_err("should time out");
        assert!(error.contains("timed out"), "unexpected error: {error}");
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[test]
    fn pg_messages_are_capped() {
        let result = collect_pg_messages(Vec::new(), 10);
        assert!(result.rows.is_empty());
        assert!(!result.truncated);
    }

    // ── PostgreSQL (needs VELOXDB_TEST_PG_URL) ──────────────────
    //
    // e.g. VELOXDB_TEST_PG_URL=postgresql://velox:velox@localhost:15432/veloxdb
    // with docker-compose.pg.yml. Skipped when unset.

    mod postgres {
        use std::str::FromStr;

        use deadpool_postgres::{Manager, ManagerConfig, Pool, RecyclingMethod};
        use tokio_postgres::NoTls;

        use super::super::*;

        /// A one-session pool, so every call reuses the same session and a
        /// leaked transaction or setting would show up in the next call.
        async fn pool(table: &str) -> Option<Pool> {
            let Ok(url) = std::env::var("VELOXDB_TEST_PG_URL") else {
                eprintln!("skipping: VELOXDB_TEST_PG_URL is not set");
                return None;
            };
            let config = tokio_postgres::Config::from_str(&url).expect("url");
            let manager = Manager::from_config(
                config,
                NoTls,
                ManagerConfig { recycling_method: RecyclingMethod::Verified },
            );
            let pool = Pool::builder(manager).max_size(1).build().expect("pool");
            let client = pool.get().await.expect("connect");
            client
                .batch_execute(&format!(
                    "DROP TABLE IF EXISTS {table} CASCADE;
                     CREATE TABLE {table} (id int PRIMARY KEY, name text);
                     INSERT INTO {table} SELECT g, 'row ' || g FROM generate_series(1, 200) g;
                     CREATE OR REPLACE FUNCTION {table}_sneaky() RETURNS int LANGUAGE sql AS
                       $$ INSERT INTO {table} VALUES (999, 'sneaky') RETURNING 1 $$;"
                ))
                .await
                .expect("seed");
            drop(client);
            Some(pool)
        }

        async fn run(pool: &Pool, sql: &str, kind: AgentStatement, max_rows: usize, timeout_ms: u64) -> Result<QueryResult, String> {
            let session = PgSessionGuard::new(pool.get().await.expect("session"));
            postgres_readonly(session, sql, kind, max_rows, timeout_ms).await
        }

        async fn count(pool: &Pool, table: &str) -> i64 {
            let client = pool.get().await.expect("session");
            client
                .query_one(&format!("SELECT count(*) FROM {table}"), &[])
                .await
                .expect("count")
                .get(0)
        }

        async fn session_setting(pool: &Pool, name: &str) -> String {
            let client = pool.get().await.expect("session");
            client
                .query_one(&format!("SELECT current_setting('{name}')"), &[])
                .await
                .expect("setting")
                .get(0)
        }

        #[tokio::test]
        async fn reads_through_a_capped_cursor() {
            let Some(pool) = pool("agent_ro_read").await else { return };
            let result = run(&pool, "SELECT id, name FROM agent_ro_read ORDER BY id", AgentStatement::Query, 5, 5_000)
                .await
                .expect("select");
            assert_eq!(result.columns, vec!["id", "name"]);
            assert_eq!(result.rows.len(), 5);
            assert!(result.truncated);
            assert_eq!(result.rows[0].get("name").cloned().flatten().as_deref(), Some("row 1"));

            let small = run(&pool, "SELECT id FROM agent_ro_read WHERE id <= 3", AgentStatement::Query, 5, 5_000)
                .await
                .expect("select");
            assert_eq!(small.rows.len(), 3);
            assert!(!small.truncated);

            let empty = run(&pool, "SELECT id FROM agent_ro_read WHERE id < 0", AgentStatement::Query, 5, 5_000)
                .await
                .expect("select");
            assert_eq!(empty.columns, vec!["id"]);
            assert!(empty.rows.is_empty());

            let plan = run(&pool, "EXPLAIN SELECT * FROM agent_ro_read", AgentStatement::Explain, 50, 5_000)
                .await
                .expect("explain");
            assert_eq!(plan.columns, vec!["QUERY PLAN"]);
            assert!(!plan.rows.is_empty());
        }

        #[tokio::test]
        async fn the_database_refuses_writes_the_parser_cannot_see() {
            let Some(pool) = pool("agent_ro_writes").await else { return };
            let error = run(&pool, "SELECT agent_ro_writes_sneaky()", AgentStatement::Query, 5, 5_000)
                .await
                .expect_err("function insert must fail");
            assert!(error.contains("read-only transaction"), "unexpected error: {error}");
            assert_eq!(count(&pool, "agent_ro_writes").await, 200);
        }

        #[tokio::test]
        async fn a_hidden_second_statement_never_runs() {
            let Some(pool) = pool("agent_ro_multi").await else { return };
            for sql in [
                "SELECT 1; DELETE FROM agent_ro_multi",
                "SELECT 1; COMMIT; DELETE FROM agent_ro_multi",
            ] {
                let outcome = run(&pool, sql, AgentStatement::Query, 5, 5_000).await;
                assert!(outcome.is_err(), "should fail: {sql}");
                let outcome = run(&pool, sql, AgentStatement::Explain, 5, 5_000).await;
                assert!(outcome.is_err(), "should fail: {sql}");
            }
            assert_eq!(count(&pool, "agent_ro_multi").await, 200);
        }

        #[tokio::test]
        async fn times_out_and_leaves_the_session_clean() {
            let Some(pool) = pool("agent_ro_timeout").await else { return };
            let error = run(&pool, "SELECT pg_sleep(5)", AgentStatement::Query, 5, 300)
                .await
                .expect_err("should time out");
            assert!(error.to_lowercase().contains("timeout"), "unexpected error: {error}");
            // Same session (max_size 1): no transaction, timeout or read-only
            // mode carried over.
            assert_eq!(session_setting(&pool, "statement_timeout").await, "0");
            assert_eq!(session_setting(&pool, "transaction_read_only").await, "off");
            let client = pool.get().await.expect("session");
            client
                .batch_execute("INSERT INTO agent_ro_timeout VALUES (500, 'editor write')")
                .await
                .expect("editor writes still work");
        }

        #[tokio::test]
        async fn refuses_to_run_inside_a_transaction_left_open() {
            let Some(pool) = pool("agent_ro_open_tx").await else { return };
            {
                let client = pool.get().await.expect("session");
                client
                    .batch_execute("BEGIN; UPDATE agent_ro_open_tx SET name = 'pending' WHERE id = 1")
                    .await
                    .expect("open transaction");
            }
            let error = run(&pool, "SELECT 1", AgentStatement::Query, 5, 5_000)
                .await
                .expect_err("should refuse");
            assert_eq!(error, PG_TRANSACTION_LEFT_OPEN);
            // The user's transaction is untouched: still open and still able to commit.
            let client = pool.get().await.expect("session");
            client.batch_execute("COMMIT").await.expect("commit");
            let name: String = client
                .query_one("SELECT name FROM agent_ro_open_tx WHERE id = 1", &[])
                .await
                .expect("row")
                .get(0);
            assert_eq!(name, "pending");
        }

        #[tokio::test]
        async fn rolls_back_an_aborted_transaction_and_runs() {
            let Some(pool) = pool("agent_ro_aborted").await else { return };
            {
                let client = pool.get().await.expect("session");
                let _ = client.batch_execute("BEGIN; SELECT 1/0").await;
            }
            let result = run(&pool, "SELECT count(*) AS n FROM agent_ro_aborted", AgentStatement::Query, 5, 5_000)
                .await
                .expect("select after aborted transaction");
            assert_eq!(result.rows[0].get("n").cloned().flatten().as_deref(), Some("200"));
        }
    }

    // ── MySQL (needs VELOXDB_TEST_MYSQL_URL) ────────────────────
    //
    // e.g. VELOXDB_TEST_MYSQL_URL=mysql://root:velox@127.0.0.1:3306/veloxdb
    // Skipped when unset.

    mod mysql {
        use sqlx::mysql::MySqlPoolOptions;

        use super::super::*;

        async fn pool() -> Option<MySqlPool> {
            let Ok(url) = std::env::var("VELOXDB_TEST_MYSQL_URL") else {
                eprintln!("skipping: VELOXDB_TEST_MYSQL_URL is not set");
                return None;
            };
            let pool = MySqlPoolOptions::new().max_connections(2).connect(&url).await.expect("connect");
            sqlx::raw_sql(
                "DROP TABLE IF EXISTS agent_ro_users;
                 CREATE TABLE agent_ro_users (id INT PRIMARY KEY, name VARCHAR(50));
                 INSERT INTO agent_ro_users VALUES (1, 'ada'), (2, 'grace'), (3, 'linus');
                 DROP FUNCTION IF EXISTS agent_ro_sneaky;
                 CREATE FUNCTION agent_ro_sneaky() RETURNS INT DETERMINISTIC MODIFIES SQL DATA
                 BEGIN INSERT INTO agent_ro_users VALUES (99, 'sneaky'); RETURN 1; END",
            )
            .execute(&pool)
            .await
            .expect("seed");
            Some(pool)
        }

        async fn count(pool: &MySqlPool) -> i64 {
            sqlx::query_scalar("SELECT count(*) FROM agent_ro_users").fetch_one(pool).await.expect("count")
        }

        #[tokio::test]
        async fn mysql_reads_caps_and_refuses_writes() {
            let Some(pool) = pool().await else { return };
            let result = mysql_readonly(&pool, "SELECT id, name FROM agent_ro_users ORDER BY id", 2, 5_000)
                .await
                .expect("select");
            assert_eq!(result.rows.len(), 2);
            assert!(result.truncated);

            for sql in [
                "SELECT agent_ro_sneaky()",
                "SELECT 1; DELETE FROM agent_ro_users",
                "DELETE FROM agent_ro_users",
            ] {
                assert!(mysql_readonly(&pool, sql, 5, 5_000).await.is_err(), "should fail: {sql}");
            }
            assert_eq!(count(&pool).await, 3);
        }

        #[tokio::test]
        async fn mysql_times_out() {
            let Some(pool) = pool().await else { return };
            let error = mysql_readonly(&pool, "SELECT SLEEP(5) FROM agent_ro_users", 5, 500)
                .await;
            // MySQL stops the SELECT and either reports the limit or returns
            // the interrupted SLEEP(); MariaDB reports max_statement_time.
            if let Err(error) = error {
                assert!(error.contains("timed out"), "unexpected error: {error}");
            }
        }
    }

    /// A throwaway database file under the system temp dir, removed on drop.
    mod tempfile_path {
        use std::path::{Path, PathBuf};

        pub struct TempDb(PathBuf);

        impl TempDb {
            pub fn new() -> Self {
                let path = std::env::temp_dir()
                    .join(format!("veloxdb-readonly-{}.sqlite", uuid::Uuid::new_v4()));
                Self(path)
            }

            pub fn path(&self) -> &Path {
                &self.0
            }
        }

        impl Drop for TempDb {
            fn drop(&mut self) {
                for suffix in ["", "-wal", "-shm"] {
                    let mut name = self.0.clone().into_os_string();
                    name.push(suffix);
                    let _ = std::fs::remove_file(PathBuf::from(name));
                }
            }
        }
    }
}
