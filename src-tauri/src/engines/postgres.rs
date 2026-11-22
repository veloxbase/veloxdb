use std::time::Instant;

use tauri::AppHandle;
use tokio_postgres::error::SqlState;
use tokio_postgres::SimpleQueryMessage;

use crate::db::{
    build_pool, build_pool_custom, describe_pool_error, drop_pool, is_retryable_connection_error,
    quote_identifier, with_pool_client_retry, AppState,
};
use crate::error::VeloxError;
use crate::models::{ColumnInfo, ConnectionInput, DatabaseInfo, QueryResult, TableInfo};
use crate::pg_error::map_pg_err;
use crate::ssh_tunnel::SshTunnel;

use super::DatabaseEngineOps;

pub struct PostgresEngine;

const TRANSACTION_LEFT_OPEN: &str = "This run left a transaction open, so it was rolled back \
     and nothing was committed. Each run uses its own pooled session, so a transaction has to \
     BEGIN and COMMIT (or ROLLBACK) within a single run.";

/// True only inside a transaction block: there the transaction started with an
/// earlier message, so its timestamp is older than this statement's.
const IN_TRANSACTION_PROBE: &str = "select transaction_timestamp() <> statement_timestamp()";

/// Only `BEGIN` / `START TRANSACTION` can leave a transaction open after a run,
/// so anything else skips the extra round trip. Matches inside strings and
/// comments are harmless: they only cost the probe.
fn may_leave_transaction_open(sql: &str) -> bool {
    sql.split(|c: char| !(c.is_ascii_alphanumeric() || c == '_'))
        .any(|token| token.eq_ignore_ascii_case("begin") || token.eq_ignore_ascii_case("start"))
}

/// Rolls back a transaction that is still open (or aborted) on `client`.
/// Returns whether there was one.
async fn rollback_leftover_transaction(client: &tokio_postgres::Client) -> bool {
    let in_transaction = match client.simple_query(IN_TRANSACTION_PROBE).await {
        Ok(messages) => messages.iter().any(|message| {
            matches!(message, SimpleQueryMessage::Row(row) if row.get(0) == Some("t"))
        }),
        // An aborted transaction rejects every statement until it is rolled back.
        Err(error) => error.code() == Some(&SqlState::IN_FAILED_SQL_TRANSACTION),
    };
    if in_transaction {
        if let Err(error) = client.simple_query("ROLLBACK").await {
            log::warn!("Failed to roll back a leftover transaction: {}", error);
        }
    }
    in_transaction
}

/// Runs one editor execution. Pooled connections are handed to whichever
/// command asks next, so a transaction left open here would swallow later,
/// unrelated statements and keep its locks. It is rolled back instead, and the
/// run fails so the user is not told that uncommitted work succeeded.
async fn simple_query_closing_transaction(
    client: &tokio_postgres::Client,
    sql: &str,
) -> Result<Vec<SimpleQueryMessage>, String> {
    let outcome = client.simple_query(sql).await;
    let rolled_back =
        may_leave_transaction_open(sql) && rollback_leftover_transaction(client).await;
    let messages = outcome.map_err(|error| map_pg_err(error, Some(sql)))?;
    if rolled_back {
        return Err(TRANSACTION_LEFT_OPEN.to_string());
    }
    Ok(messages)
}

impl DatabaseEngineOps for PostgresEngine {
    async fn connect(
        &self,
        _app: &AppHandle,
        state: &AppState,
        input: &ConnectionInput,
        connection_id: &str,
    ) -> Result<(), VeloxError> {
        let pool = if let Some(ref ssh_config) = input.ssh_config {
            if ssh_config.is_active() {
                let tunnel = SshTunnel::connect(ssh_config, &input.host, input.port)
                    .await
                    .map_err(|e| VeloxError::Connection(format!("SSH tunnel failed: {}", e)))?;
                let local_port = tunnel.local_port;
                state.ssh_tunnels.write().await.insert(connection_id.to_string(), tunnel);
                build_pool_custom("127.0.0.1", local_port, input)?
            } else {
                build_pool(input)?
            }
        } else {
            build_pool(input)?
        };

        // Managed Postgres providers (Neon, Supabase, ...) suspend idle computes;
        // the first attempt may hit the compute while it wakes from scale-to-zero.
        // Retry the pool acquisition + ping once before giving up.
        let mut retried = false;
        loop {
            let client = match pool.get().await {
                Ok(client) => client,
                Err(e) => {
                    if !retried && is_retryable_connection_error(&describe_pool_error(&e)) {
                        retried = true;
                        continue;
                    }
                    drop_pool(state, connection_id).await;
                    return Err(VeloxError::Connection(describe_pool_error(&e)));
                }
            };

            match client.simple_query("select 1").await {
                Ok(_) => break,
                Err(e) => {
                    if !retried && is_retryable_connection_error(&e.to_string()) {
                        retried = true;
                        continue;
                    }
                    drop_pool(state, connection_id).await;
                    return Err(VeloxError::Postgres(crate::error::PgError::from_error(e, None)));
                }
            }
        }

        state.pools.write().await.insert(connection_id.to_string(), pool);
        Ok(())
    }

    async fn ping(
        &self,
        app: &AppHandle,
        state: &AppState,
        connection_id: &str,
    ) -> Result<(), VeloxError> {
        with_pool_client_retry(app, state, connection_id, (), |client, ()| async move {
            client.simple_query("select 1").await.map_err(|error| error.to_string())?;
            Ok(())
        })
        .await
    }

    async fn run_query(
        &self,
        app: &AppHandle,
        state: &AppState,
        connection_id: &str,
        sql: &str,
        max_rows: usize,
    ) -> Result<QueryResult, VeloxError> {
        with_pool_client_retry(app, state, connection_id, sql.to_string(), |client, sql| async move {
            let started_at = Instant::now();
            let messages = simple_query_closing_transaction(&client, &sql).await?;

            let mut columns = Vec::new();
            let mut rows = Vec::new();
            let mut total_rows = 0usize;
            let mut command_tag = None;
            let mut saw_row_description = false;

            for message in messages {
                match message {
                    SimpleQueryMessage::RowDescription(description) => {
                        // A script can return several result sets. Keep the last
                        // one instead of mapping later rows onto earlier columns.
                        if saw_row_description {
                            columns.clear();
                            rows.clear();
                            total_rows = 0;
                        }
                        saw_row_description = true;
                        columns = description.iter()
                            .map(|column| column.name().to_string()).collect();
                    }
                    SimpleQueryMessage::Row(row) => {
                        total_rows += 1;
                        if !saw_row_description {
                            saw_row_description = true;
                            columns = row.columns().iter()
                                .map(|column| column.name().to_string()).collect();
                        }
                        if rows.len() >= max_rows { continue; }
                        let mut mapped_row = std::collections::BTreeMap::new();
                        for (index, column_name) in columns.iter().enumerate() {
                            mapped_row.insert(column_name.clone(), row.get(index).map(str::to_owned));
                        }
                        rows.push(mapped_row);
                    }
                    SimpleQueryMessage::CommandComplete(count) => {
                        command_tag = Some(count);
                    }
                    _ => {}
                }
            }

            Ok(QueryResult {
                columns,
                row_count: rows.len(),
                rows,
                execution_ms: started_at.elapsed().as_millis(),
                truncated: total_rows > max_rows,
                command_tag,
            })
        }).await
    }

    async fn get_tables(
        &self,
        app: &AppHandle,
        state: &AppState,
        connection_id: &str,
    ) -> Result<Vec<TableInfo>, VeloxError> {
        with_pool_client_retry(app, state, connection_id, (), |client, ()| async move {
            let rows = client.query(
                "select n.nspname::text, c.relname::text, \
                 case c.relkind \
                     when 'r' then 'table' \
                     when 'p' then 'table' \
                     when 'v' then 'view' \
                     when 'm' then 'materialized_view' \
                     else 'table' \
                 end as table_kind \
                 from pg_catalog.pg_class c \
                 join pg_catalog.pg_namespace n on n.oid = c.relnamespace \
                 where n.nspname not in ('pg_catalog', 'information_schema') \
                   and c.relkind in ('r', 'p', 'v', 'm') \
                   and c.relispartition = false \
                 order by n.nspname, c.relname",
                &[],
            ).await.map_err(|error| map_pg_err(error, None))?;

            Ok(rows.into_iter().map(|row| {
                let schema: String = row.get(0);
                let name: String = row.get(1);
                let kind: String = row.get(2);
                let preview_query = format!(
                    "select * from \"{}\".\"{}\" limit 100;",
                    quote_identifier(&schema), quote_identifier(&name)
                );
                TableInfo {
                    schema,
                    name,
                    preview_query,
                    kind: Some(kind),
                }
            }).collect())
        }).await
    }

    async fn get_schema(
        &self,
        app: &AppHandle,
        state: &AppState,
        connection_id: &str,
        table_schema: &str,
        table_name: &str,
    ) -> Result<Vec<ColumnInfo>, VeloxError> {
        let ts = table_schema.to_string();
        let tn = table_name.to_string();
        with_pool_client_retry(app, state, connection_id, (ts, tn), |client, (schema, name)| async move {
            let rows = client.query(
                "select table_schema, table_name, column_name, data_type, is_nullable \
                 from information_schema.columns \
                 where table_schema = $1 and table_name = $2 \
                 order by ordinal_position",
                &[&schema, &name],
            ).await.map_err(|error| map_pg_err(error, None))?;

            Ok(rows.into_iter().map(|row| ColumnInfo {
                table_schema: row.get(0),
                table_name: row.get(1),
                column_name: row.get(2),
                data_type: row.get(3),
                is_nullable: row.get::<_, String>(4) == "YES",
            }).collect())
        }).await
    }

    async fn list_databases(
        &self,
        app: &AppHandle,
        state: &AppState,
        connection_id: &str,
    ) -> Result<Vec<DatabaseInfo>, VeloxError> {
        with_pool_client_retry(app, state, connection_id, (), |client, ()| async move {
            let rows = client.query(
                "select datname from pg_database \
                 where datistemplate = false and has_database_privilege(datname, 'CONNECT') \
                 order by datname",
                &[],
            ).await.map_err(|error| map_pg_err(error, None))?;
            Ok(rows.into_iter().map(|row| {
                let name: String = row.get(0);
                DatabaseInfo { name }
            }).collect())
        }).await
    }
}

#[cfg(test)]
mod tests {
    use deadpool_postgres::Pool;

    use super::*;
    use crate::models::{ConnectionSslMode, DatabaseEngine};

    #[test]
    fn only_transaction_openers_trigger_the_probe() {
        assert!(may_leave_transaction_open("BEGIN; UPDATE t SET a = 1;"));
        assert!(may_leave_transaction_open("start transaction;\nselect 1;"));
        assert!(!may_leave_transaction_open("SELECT * FROM t LIMIT 100;"));
        assert!(!may_leave_transaction_open("SELECT started_at, beginning FROM t;"));
    }

    fn local_pool() -> Pool {
        build_pool(&ConnectionInput {
            id: None,
            name: "test-transactions".into(),
            engine: DatabaseEngine::Postgres,
            host: "localhost".into(),
            port: 15432,
            database: "veloxdb".into(),
            file_path: None,
            user: "velox".into(),
            password: "velox".into(),
            srv_enabled: false,
            ssl_mode: ConnectionSslMode::Prefer,
            ssh_config: None,
            extra_params: None,
        })
        .expect("pool should build")
    }

    /// One Run click: borrow a pooled connection, run, hand it back.
    async fn run(pool: &Pool, sql: &str) -> Result<Vec<SimpleQueryMessage>, String> {
        let client = pool.get().await.expect("acquire");
        simple_query_closing_transaction(&client, sql).await
    }

    async fn first_value(pool: &Pool, sql: &str) -> String {
        run(pool, sql)
            .await
            .expect("query")
            .iter()
            .find_map(|message| match message {
                SimpleQueryMessage::Row(row) => row.get(0).map(str::to_string),
                _ => None,
            })
            .expect("one row")
    }

    /// Overlapping commands (schema tree, editor metadata, ...) leave several
    /// connections in the pool, which then hands them out in rotation.
    async fn pool_with_two_connections() -> Pool {
        let pool = local_pool();
        let (first, second) = tokio::join!(pool.get(), pool.get());
        drop((first.expect("acquire"), second.expect("acquire")));
        pool
    }

    #[tokio::test]
    #[ignore = "requires a local PostgreSQL; start with: docker compose -f docker-compose.pg.yml up -d"]
    async fn transaction_left_open_is_rolled_back_and_reported() {
        let pool = pool_with_two_connections().await;
        run(&pool, "drop table if exists velox_txn_open; \
                    create table velox_txn_open (balance int); \
                    insert into velox_txn_open values (100);")
            .await
            .expect("setup");

        let error = run(&pool, "BEGIN; UPDATE velox_txn_open SET balance = 60;")
            .await
            .expect_err("a transaction left open must fail the run");
        assert_eq!(error, TRANSACTION_LEFT_OPEN);

        // Later runs rotate over both connections; none is still in the transaction.
        run(&pool, "UPDATE velox_txn_open SET balance = balance + 1;").await.expect("update");
        run(&pool, "UPDATE velox_txn_open SET balance = balance + 1;").await.expect("update");
        for _ in 0..2 {
            assert_eq!(first_value(&pool, "select balance from velox_txn_open").await, "102");
        }

        run(&pool, "drop table velox_txn_open;").await.expect("cleanup");
        pool.close();
    }

    #[tokio::test]
    #[ignore = "requires a local PostgreSQL; start with: docker compose -f docker-compose.pg.yml up -d"]
    async fn aborted_transaction_does_not_poison_the_pool() {
        let pool = pool_with_two_connections().await;

        let error = run(&pool, "BEGIN; SELECT 1/0; COMMIT;")
            .await
            .expect_err("division by zero");
        assert!(error.contains("division by zero"), "original error is kept: {error}");

        for _ in 0..4 {
            assert_eq!(first_value(&pool, "select 1").await, "1");
        }
        pool.close();
    }

    #[tokio::test]
    #[ignore = "requires a local PostgreSQL; start with: docker compose -f docker-compose.pg.yml up -d"]
    async fn complete_transactions_and_plain_statements_still_succeed() {
        let pool = pool_with_two_connections().await;
        run(&pool, "drop table if exists velox_txn_done; \
                    create table velox_txn_done (balance int); \
                    insert into velox_txn_done values (100);")
            .await
            .expect("setup");

        run(&pool, "BEGIN; UPDATE velox_txn_done SET balance = 60; COMMIT;")
            .await
            .expect("committed transaction");
        run(&pool, "BEGIN; UPDATE velox_txn_done SET balance = 0; ROLLBACK;")
            .await
            .expect("rolled back transaction");
        // Multi-statement runs without BEGIN are one implicit transaction.
        run(&pool, "UPDATE velox_txn_done SET balance = 1; UPDATE velox_txn_done SET balance = 'x';")
            .await
            .expect_err("second statement fails");
        for _ in 0..2 {
            assert_eq!(first_value(&pool, "select balance from velox_txn_done").await, "60");
        }

        run(&pool, "drop table velox_txn_done;").await.expect("cleanup");
        pool.close();
    }
}
