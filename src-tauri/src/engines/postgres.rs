use std::time::Instant;

use tauri::AppHandle;
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
        run_simple_query(app, state, connection_id, sql, max_rows, false).await
    }

    async fn run_read_only_query(
        &self,
        app: &AppHandle,
        state: &AppState,
        connection_id: &str,
        sql: &str,
        max_rows: usize,
    ) -> Result<QueryResult, VeloxError> {
        run_simple_query(app, state, connection_id, sql, max_rows, true).await
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

/// Runs `sql` inside a read-only transaction, so Postgres itself rejects any
/// write that `is_read_only_sql` missed, such as a function that modifies data.
/// `SET TRANSACTION` also covers a connection that is somehow already inside a
/// transaction, where `BEGIN` alone would only warn. The transaction is always
/// rolled back, since nothing in it can have changed data.
async fn simple_query_read_only(
    client: &tokio_postgres::Client,
    sql: &str,
) -> Result<Vec<SimpleQueryMessage>, String> {
    client
        .simple_query("BEGIN; SET TRANSACTION READ ONLY")
        .await
        .map_err(|error| map_pg_err(error, None))?;
    let outcome = client.simple_query(sql).await;
    if let Err(error) = client.simple_query("ROLLBACK").await {
        log::warn!("Failed to end a read-only query transaction: {}", error);
    }
    outcome.map_err(|error| map_pg_err(error, Some(sql)))
}

async fn run_simple_query(
    app: &AppHandle,
    state: &AppState,
    connection_id: &str,
    sql: &str,
    max_rows: usize,
    read_only: bool,
) -> Result<QueryResult, VeloxError> {
    with_pool_client_retry(app, state, connection_id, sql.to_string(), |client, sql| async move {
        let started_at = Instant::now();
        let messages = if read_only {
            simple_query_read_only(&client, &sql).await?
        } else {
            client.simple_query(&sql).await
                .map_err(|error| map_pg_err(error, Some(sql.as_str())))?
        };

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

#[cfg(test)]
mod tests {
    use deadpool_postgres::Pool;

    use super::*;
    use crate::models::{ConnectionSslMode, DatabaseEngine};


    fn local_pool() -> Pool {
        build_pool(&ConnectionInput {
            id: None,
            name: "test-read-only".into(),
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

    async fn scalar(client: &tokio_postgres::Client, sql: &str) -> String {
        client
            .simple_query(sql)
            .await
            .expect("query")
            .iter()
            .find_map(|message| match message {
                SimpleQueryMessage::Row(row) => row.get(0).map(str::to_string),
                _ => None,
            })
            .expect("one row")
    }

    async fn setup(client: &tokio_postgres::Client, table: &str) {
        client
            .simple_query(&format!(
                "drop table if exists {table}, {table}_copy; \
                 create table {table} (id int); insert into {table} values (1), (2); \
                 create or replace function {table}_archive() returns int language sql as \
                 $$ insert into {table} values (99); select 1 $$;"
            ))
            .await
            .expect("setup");
    }

    async fn cleanup(client: &tokio_postgres::Client, table: &str) {
        client
            .simple_query(&format!(
                "drop function if exists {table}_archive(); drop table if exists {table}, {table}_copy;"
            ))
            .await
            .expect("cleanup");
    }

    fn assert_read_only_violation(result: Result<Vec<SimpleQueryMessage>, String>) {
        let error = result.expect_err("the database must refuse the write");
        assert!(error.contains("SQLSTATE: 25006"), "unexpected error: {error}");
    }

    #[tokio::test]
    #[ignore = "requires a local PostgreSQL; start with: docker compose -f docker-compose.pg.yml up -d"]
    async fn read_only_query_refuses_writes_the_keyword_check_cannot_see() {
        let pool = local_pool();
        let client = pool.get().await.expect("acquire");
        setup(&client, "velox_ro_a").await;

        // A function that writes, called from a plain SELECT.
        assert_read_only_violation(simple_query_read_only(&client, "SELECT velox_ro_a_archive()").await);
        assert_read_only_violation(
            simple_query_read_only(&client, "SELECT * INTO velox_ro_a_copy FROM velox_ro_a").await,
        );

        assert_eq!(scalar(&client, "select count(*) from velox_ro_a").await, "2");
        assert_eq!(scalar(&client, "select count(*) from pg_class where relname = 'velox_ro_a_copy'").await, "0");
        cleanup(&client, "velox_ro_a").await;
    }

    #[tokio::test]
    #[ignore = "requires a local PostgreSQL; start with: docker compose -f docker-compose.pg.yml up -d"]
    async fn read_only_query_returns_rows_and_leaves_the_connection_clean() {
        let pool = local_pool();
        let client = pool.get().await.expect("acquire");
        setup(&client, "velox_ro_b").await;

        let messages = simple_query_read_only(&client, "SELECT id FROM velox_ro_b ORDER BY id")
            .await
            .expect("read");
        let rows = messages.iter().filter(|m| matches!(m, SimpleQueryMessage::Row(_))).count();
        assert_eq!(rows, 2);

        // A failing read must not leave the connection in a transaction either.
        simple_query_read_only(&client, "SELECT 1/0").await.expect_err("division by zero");

        assert_eq!(scalar(&client, "select transaction_timestamp() <> statement_timestamp()").await, "f");
        assert_eq!(scalar(&client, "show transaction_read_only").await, "off");
        // Confirmed writes on the same connection still work.
        client.simple_query("insert into velox_ro_b values (3)").await.expect("write");
        assert_eq!(scalar(&client, "select count(*) from velox_ro_b").await, "3");
        cleanup(&client, "velox_ro_b").await;
    }

    #[tokio::test]
    #[ignore = "requires a local PostgreSQL; start with: docker compose -f docker-compose.pg.yml up -d"]
    async fn read_only_holds_on_a_connection_already_in_a_transaction() {
        let pool = local_pool();
        let client = pool.get().await.expect("acquire");
        setup(&client, "velox_ro_c").await;

        client.simple_query("BEGIN").await.expect("leftover transaction");
        assert_read_only_violation(simple_query_read_only(&client, "SELECT velox_ro_c_archive()").await);

        assert_eq!(scalar(&client, "select count(*) from velox_ro_c").await, "2");
        cleanup(&client, "velox_ro_c").await;
    }
}
