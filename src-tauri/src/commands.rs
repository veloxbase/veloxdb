use std::collections::{BTreeMap, HashMap, HashSet};
use std::time::Instant;

use tauri::{AppHandle, State};
use tokio_postgres::SimpleQueryMessage;
use uuid::Uuid;

use crate::db::{
    build_pool, get_or_create_pool, list_connections, load_connection,
    persist_connection, quote_identifier, resolve_connection_id, AppState,
    MAX_QUERY_ROWS,
};
use crate::models::{
    ColumnInfo, ColumnProperties, ConnectionInput, ConnectionSummary, DdlBatchRequest,
    ForeignKeyEdge, QueryRequest, QueryResult, SchemaRequest, StoredConnection, TableInfo,
    TablePropertiesApplyRequest,
};

/// Cap FK rows returned to the UI to keep IPC payloads bounded.
const MAX_FOREIGN_KEY_ROWS: i64 = 5000;

#[tauri::command]
pub async fn connect_db(
    app: AppHandle,
    state: State<'_, AppState>,
    input: ConnectionInput,
) -> Result<ConnectionSummary, String> {
    let connection_id = input
        .id
        .clone()
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    let pool = build_pool(&input)?;
    let client = pool.get().await.map_err(|error| error.to_string())?;
    client
        .simple_query("select 1")
        .await
        .map_err(|error| error.to_string())?;

    let stored_connection = StoredConnection::from_input(connection_id.clone(), input);
    persist_connection(&app, &stored_connection)?;

    state
        .pools
        .write()
        .await
        .insert(connection_id.clone(), pool);

    *state.active_connection_id.write().await = Some(connection_id);

    Ok(stored_connection.summary())
}

#[tauri::command]
pub async fn list_connections_command(app: AppHandle) -> Result<Vec<ConnectionSummary>, String> {
    list_connections(&app)
}

#[tauri::command]
pub async fn set_active_connection(
    app: AppHandle,
    state: State<'_, AppState>,
    connection_id: String,
) -> Result<ConnectionSummary, String> {
    let stored_connection = load_connection(&app, &connection_id)?
        .ok_or_else(|| "Stored connection details were not found.".to_string())?;
    let pool = get_or_create_pool(&app, &state, &connection_id).await?;
    let client = pool.get().await.map_err(|error| error.to_string())?;

    client
        .simple_query("select 1")
        .await
        .map_err(|error| error.to_string())?;

    *state.active_connection_id.write().await = Some(connection_id);

    Ok(stored_connection.summary())
}

#[tauri::command]
pub async fn run_query(
    app: AppHandle,
    state: State<'_, AppState>,
    input: QueryRequest,
) -> Result<QueryResult, String> {
    let connection_id = resolve_connection_id(&state, input.connection_id).await?;
    let sql = input.sql.trim();

    if sql.is_empty() {
        return Err("Enter a SQL statement before running the query.".to_string());
    }

    let pool = get_or_create_pool(&app, &state, &connection_id).await?;
    let client = pool.get().await.map_err(|error| error.to_string())?;

    let started_at = Instant::now();
    let messages = client
        .simple_query(sql)
        .await
        .map_err(|error| error.to_string())?;

    let mut columns = Vec::new();
    let mut rows = Vec::new();
    let mut total_rows = 0usize;
    let mut command_tag = None;

    for message in messages {
        match message {
            SimpleQueryMessage::RowDescription(description) => {
                if columns.is_empty() {
                    columns = description
                        .iter()
                        .map(|column| column.name().to_string())
                        .collect();
                }
            }
            SimpleQueryMessage::Row(row) => {
                total_rows += 1;

                if columns.is_empty() {
                    columns = row
                        .columns()
                        .iter()
                        .map(|column| column.name().to_string())
                        .collect();
                }

                if rows.len() >= MAX_QUERY_ROWS {
                    continue;
                }

                let mut mapped_row = BTreeMap::new();
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
        truncated: total_rows > MAX_QUERY_ROWS,
        command_tag,
    })
}

#[tauri::command]
pub async fn get_tables(
    app: AppHandle,
    state: State<'_, AppState>,
    connection_id: Option<String>,
) -> Result<Vec<TableInfo>, String> {
    let connection_id = resolve_connection_id(&state, connection_id).await?;
    let pool = get_or_create_pool(&app, &state, &connection_id).await?;
    let client = pool.get().await.map_err(|error| error.to_string())?;

    let rows = client
        .query(
            "
            select table_schema, table_name
            from information_schema.tables
            where table_type = 'BASE TABLE'
              and table_schema not in ('pg_catalog', 'information_schema')
            order by table_schema, table_name
            ",
            &[],
        )
        .await
        .map_err(|error| error.to_string())?;

    Ok(rows
        .into_iter()
        .map(|row| {
            let schema: String = row.get(0);
            let name: String = row.get(1);
            let preview_query = format!(
                "select * from \"{}\".\"{}\" limit 100;",
                quote_identifier(&schema),
                quote_identifier(&name)
            );

            TableInfo {
                schema,
                name,
                preview_query,
            }
        })
        .collect())
}

#[tauri::command]
pub async fn get_schema(
    app: AppHandle,
    state: State<'_, AppState>,
    input: SchemaRequest,
) -> Result<Vec<ColumnInfo>, String> {
    let connection_id = resolve_connection_id(&state, input.connection_id).await?;
    let pool = get_or_create_pool(&app, &state, &connection_id).await?;
    let client = pool.get().await.map_err(|error| error.to_string())?;

    let rows = client
        .query(
            "
            select table_schema, table_name, column_name, data_type, is_nullable
            from information_schema.columns
            where table_schema = $1 and table_name = $2
            order by ordinal_position
            ",
            &[&input.table_schema, &input.table_name],
        )
        .await
        .map_err(|error| error.to_string())?;

    Ok(rows
        .into_iter()
        .map(|row| ColumnInfo {
            table_schema: row.get(0),
            table_name: row.get(1),
            column_name: row.get(2),
            data_type: row.get(3),
            is_nullable: row.get::<_, String>(4) == "YES",
        })
        .collect())
}

fn veloxdb_unique_constraint_name(table_name: &str, column_name: &str) -> String {
    // Postgres constraint names are limited to 63 bytes.
    // Keep this deterministic so we can drop the exact constraint later.
    let suffix = "_uniq";
    let max_base_len = 63usize.saturating_sub(suffix.len());

    let mut base = format!("veloxdb_{}_{}", table_name, column_name);
    base.truncate(max_base_len);

    format!("{}{}", base, suffix)
}

#[tauri::command]
pub async fn get_table_properties(
    app: AppHandle,
    state: State<'_, AppState>,
    input: SchemaRequest,
) -> Result<Vec<ColumnProperties>, String> {
    let connection_id = resolve_connection_id(&state, input.connection_id).await?;
    let pool = get_or_create_pool(&app, &state, &connection_id).await?;
    let client = pool.get().await.map_err(|error| error.to_string())?;

    let columns = client
        .query(
            "
            select table_schema, table_name, column_name, data_type, is_nullable
            from information_schema.columns
            where table_schema = $1 and table_name = $2
            order by ordinal_position
            ",
            &[&input.table_schema, &input.table_name],
        )
        .await
        .map_err(|error| error.to_string())?;

    let primary_keys = client
        .query(
            "
            select kcu.column_name
            from information_schema.table_constraints tc
            join information_schema.key_column_usage kcu
              on tc.constraint_name = kcu.constraint_name
             and tc.table_schema = kcu.table_schema
            where tc.table_schema = $1
              and tc.table_name = $2
              and tc.constraint_type = 'PRIMARY KEY'
            order by kcu.ordinal_position
            ",
            &[&input.table_schema, &input.table_name],
        )
        .await
        .map_err(|error| error.to_string())?;

    let primary_key_columns: HashSet<String> = primary_keys
        .into_iter()
        .filter_map(|row| Some(row.get::<_, String>(0)))
        .collect();

    let unique_constraints = client
        .query(
            "
            select tc.constraint_name, kcu.column_name, kcu.ordinal_position
            from information_schema.table_constraints tc
            join information_schema.key_column_usage kcu
              on tc.constraint_name = kcu.constraint_name
             and tc.table_schema = kcu.table_schema
            where tc.table_schema = $1
              and tc.table_name = $2
              and tc.constraint_type = 'UNIQUE'
            order by tc.constraint_name, kcu.ordinal_position
            ",
            &[&input.table_schema, &input.table_name],
        )
        .await
        .map_err(|error| error.to_string())?;

    let mut unique_by_name: HashMap<String, Vec<String>> = HashMap::new();
    for row in unique_constraints {
        let constraint_name: String = row.get(0);
        let column_name: String = row.get(1);
        unique_by_name.entry(constraint_name).or_default().push(column_name);
    }

    let mut unique_columns: HashSet<String> = HashSet::new();
    let mut composite_unique_columns: HashSet<String> = HashSet::new();

    for (_constraint_name, cols) in unique_by_name {
        for c in &cols {
            unique_columns.insert(c.clone());
        }
        if cols.len() > 1 {
            for c in &cols {
                composite_unique_columns.insert(c.clone());
            }
        }
    }

    Ok(columns
        .into_iter()
        .map(|row| {
            let table_schema: String = row.get(0);
            let table_name: String = row.get(1);
            let column_name: String = row.get(2);
            let data_type: String = row.get(3);
            let is_nullable = row.get::<_, String>(4) == "YES";

            let is_primary_key = primary_key_columns.contains(&column_name);
            let is_unique = is_primary_key || unique_columns.contains(&column_name);
            let is_part_of_composite_unique = composite_unique_columns.contains(&column_name);

            ColumnProperties {
                table_schema,
                table_name,
                column_name,
                data_type,
                is_nullable,
                is_primary_key,
                is_unique,
                is_part_of_composite_unique,
            }
        })
        .collect())
}

#[tauri::command]
pub async fn apply_table_properties(
    app: AppHandle,
    state: State<'_, AppState>,
    input: TablePropertiesApplyRequest,
) -> Result<(), String> {
    let TablePropertiesApplyRequest {
        connection_id: requested_connection_id,
        table_schema,
        table_name,
        columns,
    } = input;

    let connection_id = resolve_connection_id(&state, requested_connection_id).await?;
    let pool = get_or_create_pool(&app, &state, &connection_id).await?;
    let mut client = pool.get().await.map_err(|error| error.to_string())?;

    let current_columns = client
        .query(
            "
            select column_name, is_nullable
            from information_schema.columns
            where table_schema = $1 and table_name = $2
            ",
            &[&table_schema, &table_name],
        )
        .await
        .map_err(|error| error.to_string())?;

    let mut current_nullable: HashMap<String, bool> = HashMap::new();
    for row in current_columns {
        let column_name: String = row.get(0);
        let is_nullable = row.get::<_, String>(1) == "YES";
        current_nullable.insert(column_name, is_nullable);
    }

    let primary_keys = client
        .query(
            "
            select kcu.column_name
            from information_schema.table_constraints tc
            join information_schema.key_column_usage kcu
              on tc.constraint_name = kcu.constraint_name
             and tc.table_schema = kcu.table_schema
            where tc.table_schema = $1
              and tc.table_name = $2
              and tc.constraint_type = 'PRIMARY KEY'
            ",
            &[&table_schema, &table_name],
        )
        .await
        .map_err(|error| error.to_string())?;

    let primary_key_columns: HashSet<String> = primary_keys
        .into_iter()
        .filter_map(|row| Some(row.get::<_, String>(0)))
        .collect();

    let unique_constraints = client
        .query(
            "
            select tc.constraint_name, kcu.column_name, kcu.ordinal_position
            from information_schema.table_constraints tc
            join information_schema.key_column_usage kcu
              on tc.constraint_name = kcu.constraint_name
             and tc.table_schema = kcu.table_schema
            where tc.table_schema = $1
              and tc.table_name = $2
              and tc.constraint_type = 'UNIQUE'
            order by tc.constraint_name, kcu.ordinal_position
            ",
            &[&table_schema, &table_name],
        )
        .await
        .map_err(|error| error.to_string())?;

    let mut unique_by_name: HashMap<String, Vec<String>> = HashMap::new();
    for row in unique_constraints {
        let constraint_name: String = row.get(0);
        let column_name: String = row.get(1);
        unique_by_name.entry(constraint_name).or_default().push(column_name);
    }

    let mut composite_unique_columns: HashSet<String> = HashSet::new();
    let mut single_unique_constraint_names_by_column: HashMap<String, Vec<String>> = HashMap::new();

    for (constraint_name, cols) in &unique_by_name {
        if cols.len() > 1 {
            for c in cols {
                composite_unique_columns.insert(c.clone());
            }
        } else if cols.len() == 1 {
            let c = &cols[0];
            single_unique_constraint_names_by_column
                .entry(c.clone())
                .or_default()
                .push(constraint_name.clone());
        }
    }

    let mut desired_by_column: HashMap<String, (bool, bool)> = HashMap::new();
    for update in columns {
        desired_by_column.insert(update.column_name, (update.is_nullable, update.is_unique));
    }

    let txn = client.transaction().await.map_err(|error| error.to_string())?;

    // 1) Nullable changes
    for (column_name, (desired_is_nullable, _desired_is_unique)) in &desired_by_column {
        let current_is_nullable = current_nullable
            .get(column_name)
            .ok_or_else(|| format!("Unknown column: {}", column_name))?;

        if *current_is_nullable == *desired_is_nullable {
            continue;
        }

        let qualified_table = format!(
            "\"{}\".\"{}\"",
            quote_identifier(&table_schema),
            quote_identifier(&table_name)
        );

        let qualified_column = format!("\"{}\"", quote_identifier(column_name));

        if *desired_is_nullable {
            let sql = format!(
                "ALTER TABLE {} ALTER COLUMN {} DROP NOT NULL",
                qualified_table, qualified_column
            );
            txn.execute(sql.as_str(), &[]).await.map_err(|error| error.to_string())?;
        } else {
            let sql = format!(
                "ALTER TABLE {} ALTER COLUMN {} SET NOT NULL",
                qualified_table, qualified_column
            );
            txn.execute(sql.as_str(), &[]).await.map_err(|error| error.to_string())?;
        }
    }

    // 2) UNIQUE changes (v1: only support single-column UNIQUE constraints)
    for (column_name, (_desired_is_nullable, desired_is_unique)) in &desired_by_column {
        let is_primary_key = primary_key_columns.contains(column_name);
        let is_part_of_composite_unique = composite_unique_columns.contains(column_name);

        if !*desired_is_unique {
            if is_primary_key {
                return Err(format!(
                    "Cannot disable UNIQUE for primary key column: {}",
                    column_name
                ));
            }

            if is_part_of_composite_unique {
                return Err(format!(
                    "Cannot disable UNIQUE for column in a composite UNIQUE constraint: {}",
                    column_name
                ));
            }
        }

        // Compute current uniqueness:
        let has_single_unique = single_unique_constraint_names_by_column
            .get(column_name)
            .map(|names| !names.is_empty())
            .unwrap_or(false);

        let current_is_unique = is_primary_key || has_single_unique || is_part_of_composite_unique;

        if *desired_is_unique == current_is_unique {
            continue;
        }

        let qualified_table = format!(
            "\"{}\".\"{}\"",
            quote_identifier(&table_schema),
            quote_identifier(&table_name)
        );
        let qualified_column = format!("\"{}\"", quote_identifier(column_name));

        if *desired_is_unique {
            // Add a new single-column UNIQUE constraint.
            if current_is_unique {
                continue;
            }

            let generated_name = veloxdb_unique_constraint_name(&table_name, column_name);

            // If a constraint with that name exists and doesn't match our target column, fail fast.
            if let Some(existing_cols) = unique_by_name.get(&generated_name) {
                if existing_cols.len() != 1 || existing_cols[0] != *column_name {
                    return Err(format!(
                        "Cannot create UNIQUE constraint due to name collision ({}). Rename the existing constraint.",
                        generated_name
                    ));
                }
            }

            let sql = format!(
                "ALTER TABLE {} ADD CONSTRAINT \"{}\" UNIQUE ({})",
                qualified_table,
                quote_identifier(&generated_name),
                qualified_column
            );
            txn.execute(sql.as_str(), &[]).await.map_err(|error| error.to_string())?;
        } else {
            // Drop the existing single-column UNIQUE constraints for this column.
            let constraint_names = single_unique_constraint_names_by_column
                .get(column_name)
                .cloned()
                .unwrap_or_default();

            for constraint_name in constraint_names {
                let sql = format!(
                    "ALTER TABLE {} DROP CONSTRAINT \"{}\"",
                    qualified_table,
                    quote_identifier(&constraint_name)
                );
                txn.execute(sql.as_str(), &[]).await.map_err(|error| error.to_string())?;
            }
        }
    }

    txn.commit().await.map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn get_foreign_keys(
    app: AppHandle,
    state: State<'_, AppState>,
    connection_id: Option<String>,
) -> Result<Vec<ForeignKeyEdge>, String> {
    let connection_id = resolve_connection_id(&state, connection_id).await?;
    let pool = get_or_create_pool(&app, &state, &connection_id).await?;
    let client = pool.get().await.map_err(|error| error.to_string())?;

    let rows = client
        .query(
            "
            select
              src_ns.nspname::text as from_schema,
              src_cls.relname::text as from_table,
              src_att.attname::text as from_column,
              tgt_ns.nspname::text as to_schema,
              tgt_cls.relname::text as to_table,
              tgt_att.attname::text as to_column
            from pg_constraint c
            join pg_class src_cls on src_cls.oid = c.conrelid
            join pg_namespace src_ns on src_ns.oid = src_cls.relnamespace
            join pg_class tgt_cls on tgt_cls.oid = c.confrelid
            join pg_namespace tgt_ns on tgt_ns.oid = tgt_cls.relnamespace
            cross join lateral unnest(c.conkey, c.confkey) as u(attnum, confattnum)
            join pg_attribute src_att
              on src_att.attrelid = c.conrelid
             and src_att.attnum = u.attnum
             and not src_att.attisdropped
            join pg_attribute tgt_att
              on tgt_att.attrelid = c.confrelid
             and tgt_att.attnum = u.confattnum
             and not tgt_att.attisdropped
            where c.contype = 'f'
              and src_ns.nspname not in ('pg_catalog', 'information_schema')
            order by src_ns.nspname, src_cls.relname, c.conname, u.attnum
            limit $1
            ",
            &[&MAX_FOREIGN_KEY_ROWS],
        )
        .await
        .map_err(|error| error.to_string())?;

    Ok(rows
        .into_iter()
        .map(|row| ForeignKeyEdge {
            from_schema: row.get(0),
            from_table: row.get(1),
            from_column: row.get(2),
            to_schema: row.get(3),
            to_table: row.get(4),
            to_column: row.get(5),
        })
        .collect())
}

#[tauri::command]
pub async fn execute_ddl_transaction(
    app: AppHandle,
    state: State<'_, AppState>,
    input: DdlBatchRequest,
) -> Result<(), String> {
    let DdlBatchRequest {
        connection_id: requested_connection_id,
        statements,
    } = input;

    let connection_id = resolve_connection_id(&state, requested_connection_id).await?;
    let pool = get_or_create_pool(&app, &state, &connection_id).await?;
    let mut client = pool.get().await.map_err(|error| error.to_string())?;

    let stmts: Vec<String> = statements
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    if stmts.is_empty() {
        return Err("No SQL statements to execute.".to_string());
    }

    let txn = client.transaction().await.map_err(|error| error.to_string())?;
    for sql in &stmts {
        txn.execute(sql.as_str(), &[])
            .await
            .map_err(|error| error.to_string())?;
    }
    txn.commit().await.map_err(|error| error.to_string())?;
    Ok(())
}
