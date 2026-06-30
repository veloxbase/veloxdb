use std::collections::{BTreeMap, HashMap, HashSet};
use std::time::Instant;

use tauri::{AppHandle, State};

use crate::db::{get_or_create_duckdb_connection, quote_identifier, resolve_connection_engine, AppState, MAX_QUERY_ROWS};
use crate::models::{ColumnInfo, ColumnProperties, ForeignKeyEdge, IndexInfo, QueryRequest, QueryResult, SchemaRequest, TableIndexesResult, TableInfo, TablePropertiesApplyRequest};

/// Execute a SQL query against a DuckDB connection.
#[tauri::command]
pub async fn duckdb_run_query(
    app: AppHandle,
    state: State<'_, AppState>,
    input: QueryRequest,
) -> Result<QueryResult, String> {
    let (connection_id, _engine) =
        resolve_connection_engine(&app, &state, input.connection_id.clone()).await?;

    get_or_create_duckdb_connection(&app, &state, &connection_id).await?;

    let sql = input.sql.trim().to_string();
    if sql.is_empty() {
        return Err("Enter a SQL statement before running the query.".to_string());
    }

    let started_at = Instant::now();
    let max_rows = input.max_rows.unwrap_or(MAX_QUERY_ROWS);

    let conns = state.duckdb_connections.read().await;
    let conn_mutex = conns
        .get(&connection_id)
        .ok_or_else(|| "DuckDB connection not found.".to_string())?;
    let conn = conn_mutex.lock().await;

    let stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("DuckDB query preparation failed: {}", e))?;

    let columns: Vec<String> = stmt
        .column_names()
        .iter()
        .map(|c| c.to_string())
        .collect();

    let col_count = columns.len();

    if col_count > 0 {
        // Build a wrapper query that casts all columns to VARCHAR for safe string extraction
        let cast_cols: Vec<String> = columns
            .iter()
            .map(|c| {
                let quoted = quote_identifier(c);
                format!("CAST(\"{quoted}\" AS VARCHAR) as \"{quoted}\"")
            })
            .collect();
        let wrapper_sql = format!("SELECT {} FROM ({})", cast_cols.join(", "), sql);

        drop(stmt);

        let mut stmt2 = conn
            .prepare(&wrapper_sql)
            .map_err(|e| format!("DuckDB query preparation failed: {}", e))?;

        let mut rows: Vec<BTreeMap<String, Option<String>>> = Vec::new();
        let mut total = 0usize;

        let row_iter = stmt2
            .query_map([], |row| {
                let mut map = BTreeMap::new();
                for (i, col) in columns.iter().enumerate() {
                    let val: Option<String> = row.get(i).ok().flatten();
                    map.insert(col.clone(), val);
                }
                Ok(map)
            })
            .map_err(|e| format!("DuckDB query execution failed: {}", e))?;

        for row_result in row_iter {
            match row_result {
                Ok(row) => {
                    if rows.len() < max_rows {
                        rows.push(row);
                    }
                    total += 1;
                }
                Err(e) => return Err(format!("DuckDB row error: {}", e)),
            }
        }

        Ok(QueryResult {
            columns,
            row_count: rows.len(),
            rows,
            execution_ms: started_at.elapsed().as_millis(),
            truncated: total > max_rows,
            command_tag: None,
        })
    } else {
        // Non-row-returning statement (INSERT, UPDATE, DDL)
        drop(stmt);
        let affected = conn
            .execute(&sql, [])
            .map_err(|e| format!("DuckDB execution failed: {}", e))?;

        Ok(QueryResult {
            columns: Vec::new(),
            rows: Vec::new(),
            row_count: affected,
            execution_ms: started_at.elapsed().as_millis(),
            truncated: false,
            command_tag: Some(affected as u64),
        })
    }
}

/// List all tables in the DuckDB database.
#[tauri::command]
pub async fn duckdb_get_tables(
    app: AppHandle,
    state: State<'_, AppState>,
    connection_id: Option<String>,
) -> Result<Vec<TableInfo>, String> {
    let (connection_id, _engine) =
        resolve_connection_engine(&app, &state, connection_id.clone()).await?;

    get_or_create_duckdb_connection(&app, &state, &connection_id).await?;

    let conns = state.duckdb_connections.read().await;
    let conn_mutex = conns
        .get(&connection_id)
        .ok_or_else(|| "DuckDB connection not found.".to_string())?;
    let conn = conn_mutex.lock().await;

    let mut stmt = conn
        .prepare(
            "SELECT table_name FROM information_schema.tables \
             WHERE table_schema = 'main' AND table_type = 'BASE TABLE' \
             ORDER BY table_name",
        )
        .map_err(|e| format!("DuckDB table listing failed: {}", e))?;

    let tables: Vec<TableInfo> = stmt
        .query_map([], |row| {
            let name: String = row.get(0)?;
            Ok(TableInfo {
                schema: "main".to_string(),
                name: name.clone(),
                preview_query: format!(
                    "SELECT * FROM \"{}\" LIMIT 100;",
                    quote_identifier(&name)
                ),
            })
        })
        .map_err(|e| format!("DuckDB table listing failed: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(tables)
}

/// Get the column schema for a DuckDB table.
#[tauri::command]
pub async fn duckdb_get_schema(
    app: AppHandle,
    state: State<'_, AppState>,
    connection_id: Option<String>,
    table_schema: String,
    table_name: String,
) -> Result<Vec<ColumnInfo>, String> {
    let (connection_id, _engine) =
        resolve_connection_engine(&app, &state, connection_id.clone()).await?;

    get_or_create_duckdb_connection(&app, &state, &connection_id).await?;

    let conns = state.duckdb_connections.read().await;
    let conn_mutex = conns
        .get(&connection_id)
        .ok_or_else(|| "DuckDB connection not found.".to_string())?;
    let conn = conn_mutex.lock().await;

    let mut stmt = conn
        .prepare(
            "SELECT column_name, data_type, is_nullable \
             FROM information_schema.columns \
             WHERE table_schema = ? AND table_name = ? \
             ORDER BY ordinal_position",
        )
        .map_err(|e| format!("DuckDB schema query failed: {}", e))?;

    let columns: Vec<ColumnInfo> = stmt
        .query_map(
            duckdb::params![table_schema, table_name],
            |row| {
                let col_name: String = row.get(0)?;
                let data_type: String = row.get(1)?;
                let is_nullable: String = row.get(2)?;
                Ok(ColumnInfo {
                    table_schema: table_schema.clone(),
                    table_name: table_name.clone(),
                    column_name: col_name,
                    data_type,
                    is_nullable: is_nullable == "YES",
                })
            },
        )
        .map_err(|e| format!("DuckDB schema query failed: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(columns)
}

/// List foreign key relationships in the DuckDB database.
#[tauri::command]
pub async fn duckdb_get_foreign_keys(
    app: AppHandle,
    state: State<'_, AppState>,
    connection_id: Option<String>,
) -> Result<Vec<ForeignKeyEdge>, String> {
    let (connection_id, _engine) =
        resolve_connection_engine(&app, &state, connection_id.clone()).await?;

    get_or_create_duckdb_connection(&app, &state, &connection_id).await?;

    let conns = state.duckdb_connections.read().await;
    let conn_mutex = conns
        .get(&connection_id)
        .ok_or_else(|| "DuckDB connection not found.".to_string())?;
    let conn = conn_mutex.lock().await;

    let mut stmt = conn
        .prepare(
            "SELECT
                kcu.table_schema AS from_schema,
                kcu.table_name AS from_table,
                kcu.column_name AS from_column,
                kcu.referenced_table_schema AS to_schema,
                kcu.referenced_table_name AS to_table,
                kcu.referenced_column_name AS to_column
             FROM information_schema.key_column_usage kcu
             WHERE kcu.referenced_table_name IS NOT NULL
             ORDER BY kcu.table_schema, kcu.table_name",
        )
        .map_err(|e| format!("DuckDB FK query failed: {}", e))?;

    let edges: Vec<ForeignKeyEdge> = stmt
        .query_map([], |row| {
            Ok(ForeignKeyEdge {
                from_schema: row.get(0)?,
                from_table: row.get(1)?,
                from_column: row.get(2)?,
                to_schema: row.get(3)?,
                to_table: row.get(4)?,
                to_column: row.get(5)?,
            })
        })
        .map_err(|e| format!("DuckDB FK query failed: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(edges)
}

/// List indexes on a DuckDB table.
#[tauri::command]
pub async fn duckdb_get_table_indexes(
    app: AppHandle,
    state: State<'_, AppState>,
    input: SchemaRequest,
) -> Result<TableIndexesResult, String> {
    let (connection_id, _engine) =
        resolve_connection_engine(&app, &state, input.connection_id.clone()).await?;

    get_or_create_duckdb_connection(&app, &state, &connection_id).await?;

    let conns = state.duckdb_connections.read().await;
    let conn_mutex = conns
        .get(&connection_id)
        .ok_or_else(|| "DuckDB connection not found.".to_string())?;
    let conn = conn_mutex.lock().await;

    let mut stmt = conn
        .prepare(
            "SELECT
                index_name,
                index_schema,
                table_name,
                is_unique,
                is_primary,
                sql
             FROM duckdb_indexes()
             WHERE table_name = ? AND schema_name = ?
             ORDER BY index_name",
        )
        .map_err(|e| format!("DuckDB index query failed: {}", e))?;

    let indexes: Vec<IndexInfo> = stmt
        .query_map(
            duckdb::params![input.table_name, input.table_schema],
            |row| {
                let idx_name: String = row.get(0)?;
                let idx_schema: String = row.get(1)?;
                let tbl_name: String = row.get(2)?;
                let is_unique: bool = row.get(3)?;
                let is_primary: bool = row.get(4)?;
                let definition: String = row.get(5)?;
                Ok(IndexInfo {
                    index_schema: idx_schema,
                    index_name: idx_name,
                    table_schema: input.table_schema.clone(),
                    table_name: tbl_name,
                    is_unique,
                    is_primary,
                    is_valid: true,
                    is_partial: false,
                    definition,
                    index_bytes: 0,
                    idx_scan: 0,
                    idx_tup_read: 0,
                    idx_tup_fetch: 0,
                })
            },
        )
        .map_err(|e| format!("DuckDB index query failed: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    let truncated = indexes.len() > 500;
    Ok(TableIndexesResult {
        indexes: if truncated { indexes.into_iter().take(500).collect() } else { indexes },
        truncated,
    })
}

/// Get column properties (nullable, primary key, unique, default) for a DuckDB table.
#[tauri::command]
pub async fn duckdb_get_table_properties(
    app: AppHandle,
    state: State<'_, AppState>,
    input: SchemaRequest,
) -> Result<Vec<ColumnProperties>, String> {
    let (connection_id, _engine) =
        resolve_connection_engine(&app, &state, input.connection_id.clone()).await?;

    get_or_create_duckdb_connection(&app, &state, &connection_id).await?;

    let conns = state.duckdb_connections.read().await;
    let conn_mutex = conns
        .get(&connection_id)
        .ok_or_else(|| "DuckDB connection not found.".to_string())?;
    let conn = conn_mutex.lock().await;

    // Query columns
    let mut col_stmt = conn
        .prepare(
            "SELECT table_schema, table_name, column_name, data_type, is_nullable, column_default
             FROM information_schema.columns
             WHERE table_schema = ? AND table_name = ?
             ORDER BY ordinal_position",
        )
        .map_err(|e| format!("DuckDB properties query failed: {}", e))?;

    let columns: Vec<(String, String, String, String, String, Option<String>)> = col_stmt
        .query_map(
            duckdb::params![input.table_schema, input.table_name],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?)),
        )
        .map_err(|e| format!("DuckDB properties query failed: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    // Query primary keys
    let mut pk_stmt = conn
        .prepare(
            "SELECT kcu.column_name
             FROM information_schema.table_constraints tc
             JOIN information_schema.key_column_usage kcu
               ON tc.constraint_name = kcu.constraint_name
              AND tc.table_schema = kcu.table_schema
             WHERE tc.table_schema = ? AND tc.table_name = ?
               AND tc.constraint_type = 'PRIMARY KEY'
             ORDER BY kcu.ordinal_position",
        )
        .map_err(|e| format!("DuckDB PK query failed: {}", e))?;

    let pk_cols: std::collections::HashSet<String> = pk_stmt
        .query_map(duckdb::params![input.table_schema, input.table_name], |row| row.get(0))
        .map_err(|e| format!("DuckDB PK query failed: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    // Query unique constraints
    let mut uniq_stmt = conn
        .prepare(
            "SELECT tc.constraint_name, kcu.column_name
             FROM information_schema.table_constraints tc
             JOIN information_schema.key_column_usage kcu
               ON tc.constraint_name = kcu.constraint_name
              AND tc.table_schema = kcu.table_schema
             WHERE tc.table_schema = ? AND tc.table_name = ?
               AND tc.constraint_type = 'UNIQUE'
             ORDER BY tc.constraint_name, kcu.ordinal_position",
        )
        .map_err(|e| format!("DuckDB unique query failed: {}", e))?;

    let mut unique_by_name: HashMap<String, Vec<String>> = HashMap::new();
    let unique_rows: Vec<(String, String)> = uniq_stmt
        .query_map(duckdb::params![input.table_schema, input.table_name], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| format!("DuckDB unique query failed: {}", e))?
        .filter_map(|r| r.ok())
        .collect();
    for (constraint_name, column_name) in unique_rows {
        unique_by_name.entry(constraint_name).or_default().push(column_name);
    }

    let mut unique_columns: HashSet<String> = HashSet::new();
    let mut composite_unique_columns: HashSet<String> = HashSet::new();
    for cols in unique_by_name.values() {
        for c in cols { unique_columns.insert(c.clone()); }
        if cols.len() > 1 { for c in cols { composite_unique_columns.insert(c.clone()); } }
    }

    Ok(columns.into_iter().map(|(table_schema, table_name, column_name, data_type, is_nullable, column_default)| {
        let is_pk = pk_cols.contains(&column_name);
        ColumnProperties {
            table_schema,
            table_name,
            column_name: column_name.clone(),
            data_type,
            is_nullable: is_nullable == "YES",
            is_primary_key: is_pk,
            is_unique: is_pk || unique_columns.contains(&column_name),
            is_part_of_composite_unique: composite_unique_columns.contains(&column_name),
            column_default,
            is_identity: false,
            identity_generation: None,
            is_generated: None,
        }
    }).collect())
}

/// Apply nullable/unique changes to a DuckDB table via ALTER TABLE.
#[tauri::command]
pub async fn duckdb_apply_table_properties(
    app: AppHandle,
    state: State<'_, AppState>,
    input: TablePropertiesApplyRequest,
) -> Result<(), String> {
    let (connection_id, _engine) =
        resolve_connection_engine(&app, &state, input.connection_id.clone()).await?;

    get_or_create_duckdb_connection(&app, &state, &connection_id).await?;

    let conns = state.duckdb_connections.read().await;
    let conn_mutex = conns
        .get(&connection_id)
        .ok_or_else(|| "DuckDB connection not found.".to_string())?;
    let conn = conn_mutex.lock().await;

    let table_schema = &input.table_schema;
    let table_name = &input.table_name;

    // Get current nullability
    let mut col_stmt = conn
        .prepare(
            "SELECT column_name, is_nullable FROM information_schema.columns
             WHERE table_schema = ? AND table_name = ?",
        )
        .map_err(|e| format!("DuckDB: {}", e))?;
    let current_nullable: HashMap<String, bool> = col_stmt
        .query_map(duckdb::params![table_schema, table_name], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)? == "YES"))
        })
        .map_err(|e| format!("DuckDB: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    let qualified_table = format!(
        "\"{}\".\"{}\"",
        quote_identifier(table_schema),
        quote_identifier(table_name)
    );

    for update in &input.columns {
        let current = current_nullable.get(&update.column_name)
            .ok_or_else(|| format!("Unknown column: {}", update.column_name))?;
        if *current == update.is_nullable { continue; }
        let qualified_col = format!("\"{}\"", quote_identifier(&update.column_name));
        if update.is_nullable {
            conn.execute(
                &format!("ALTER TABLE {} ALTER {} DROP NOT NULL", qualified_table, qualified_col),
                [],
            ).map_err(|e| format!("DuckDB ALTER failed: {}", e))?;
        } else {
            conn.execute(
                &format!("ALTER TABLE {} ALTER {} SET NOT NULL", qualified_table, qualified_col),
                [],
            ).map_err(|e| format!("DuckDB ALTER failed: {}", e))?;
        }
    }

    // Unique constraints
    for update in &input.columns {
        if !update.is_unique { continue; }
        let qualified_col = format!("\"{}\"", quote_identifier(&update.column_name));
        let constraint_name = format!("veloxdb_unq_{}", update.column_name);
        // Add if not exists — best-effort (DuckDB may error on duplicate, which is fine)
        conn.execute(
            &format!(
                "ALTER TABLE {} ADD CONSTRAINT \"{}\" UNIQUE ({})",
                qualified_table,
                quote_identifier(&constraint_name),
                qualified_col
            ),
            [],
        ).ok(); // Ignore if constraint already exists
    }

    Ok(())
}
