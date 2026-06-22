use tauri::{AppHandle, State};

use crate::db::{
    get_or_create_mysql_pool, get_or_create_sqlite_pool, load_connection, quote_identifier,
    require_safe_identifier, resolve_connection_engine, with_pool_client_retry, AppState,
};
use crate::models::{
    DatabaseEngine, ForeignKeyEdge, QueryEditorColumn, QueryEditorFunction,
    QueryEditorMetadata, QueryEditorTable,
};
use crate::pg_error::map_pg_err;

use super::{
    MAX_EDITOR_TABLES, MAX_EDITOR_COLUMNS_PER_TABLE, MAX_EDITOR_FUNCTIONS, MAX_FOREIGN_KEY_ROWS,
    mysql_get_string, sqlite_get_idx, sqlite_get_name,
};

pub(crate) async fn fetch_query_editor_metadata_for_connection(
    app: &AppHandle,
    state: &AppState,
    connection_id: &str,
    engine: DatabaseEngine,
) -> Result<QueryEditorMetadata, String> {
    if engine == DatabaseEngine::Mysql {
        let pool = get_or_create_mysql_pool(app, state, connection_id).await?;
        let database = load_connection(app, connection_id)?
            .map(|connection| connection.database).unwrap_or_default();
        let table_rows = sqlx::query(
            "select table_schema, table_name \
             from information_schema.tables \
             where table_type = 'BASE TABLE' \
               and table_schema = ? \
               and table_schema not in ('information_schema', 'mysql', 'performance_schema', 'sys') \
             order by table_schema, table_name \
             limit ?",
        ).bind(&database).bind(MAX_EDITOR_TABLES + 1)
        .fetch_all(&pool).await.map_err(|error| error.to_string())?;

        let truncated_tables = table_rows.len() as i64 > MAX_EDITOR_TABLES;
        let mut tables = Vec::new();
        let mut truncated_columns = false;

        for row in table_rows.into_iter().take(MAX_EDITOR_TABLES as usize) {
            let schema: String = mysql_get_string(&row, 0, "table_schema", "get_query_editor_metadata")?;
            let name: String = mysql_get_string(&row, 1, "table_name", "get_query_editor_metadata")?;
            let column_rows = sqlx::query(
                "select column_name, data_type \
                 from information_schema.columns \
                 where table_schema = ? and table_name = ? \
                 order by ordinal_position \
                 limit ?",
            ).bind(&schema).bind(&name).bind(MAX_EDITOR_COLUMNS_PER_TABLE + 1)
            .fetch_all(&pool).await.map_err(|error| error.to_string())?;
            if column_rows.len() as i64 > MAX_EDITOR_COLUMNS_PER_TABLE { truncated_columns = true; }
            let mut columns = Vec::new();
            for column in column_rows.into_iter().take(MAX_EDITOR_COLUMNS_PER_TABLE as usize) {
                columns.push(QueryEditorColumn {
                    name: mysql_get_string(&column, 0, "column_name", "get_query_editor_metadata")?,
                    data_type: mysql_get_string(&column, 1, "data_type", "get_query_editor_metadata")?,
                });
            }
            tables.push(QueryEditorTable { schema, name, columns });
        }

        return Ok(QueryEditorMetadata {
            tables, functions: Vec::new(),
            truncated_tables, truncated_columns, truncated_functions: false,
        });
    }

    if engine == DatabaseEngine::Sqlite {
        let pool = get_or_create_sqlite_pool(app, state, connection_id).await?;
        let table_rows = sqlx::query(
            "select name from sqlite_master \
             where type = 'table' and name not like 'sqlite_%' \
             order by name limit ?",
        ).bind(MAX_EDITOR_TABLES + 1).fetch_all(&pool).await.map_err(|error| error.to_string())?;
        let truncated_tables = table_rows.len() as i64 > MAX_EDITOR_TABLES;
        let mut tables = Vec::new();
        let mut truncated_columns = false;
        for row in table_rows.into_iter().take(MAX_EDITOR_TABLES as usize) {
            let name: String = sqlite_get_idx(&row, 0, "name", "get_query_editor_metadata")?;
            require_safe_identifier(&name, "table name")?;
            let pragma_sql = format!("PRAGMA table_info(\"{}\");", quote_identifier(&name));
            let column_rows = sqlx::query(&pragma_sql).fetch_all(&pool).await
                .map_err(|error| error.to_string())?;
            if column_rows.len() as i64 > MAX_EDITOR_COLUMNS_PER_TABLE { truncated_columns = true; }
            let mut columns = Vec::new();
            for column in column_rows.into_iter().take(MAX_EDITOR_COLUMNS_PER_TABLE as usize) {
                columns.push(QueryEditorColumn {
                    name: sqlite_get_name(&column, "name", "get_query_editor_metadata")?,
                    data_type: sqlite_get_name(&column, "type", "get_query_editor_metadata")?,
                });
            }
            tables.push(QueryEditorTable { schema: "main".to_string(), name, columns });
        }
        return Ok(QueryEditorMetadata {
            tables, functions: Vec::new(),
            truncated_tables, truncated_columns, truncated_functions: false,
        });
    }

    with_pool_client_retry(app, state, connection_id, (), |client, ()| async move {
        let table_rows = client.query(
            "select n.nspname::text as schema_name, c.relname::text as table_name \
             from pg_class c \
             join pg_namespace n on n.oid = c.relnamespace \
             where c.relkind in ('r', 'p', 'v', 'm', 'f') \
               and n.nspname not in ('pg_catalog', 'information_schema') \
             order by n.nspname, c.relname \
             limit $1",
            &[&(MAX_EDITOR_TABLES + 1)],
        ).await.map_err(|error| map_pg_err(error, None))?;

        let truncated_tables = table_rows.len() as i64 > MAX_EDITOR_TABLES;
        let table_rows = if truncated_tables {
            table_rows.into_iter().take(MAX_EDITOR_TABLES as usize).collect::<Vec<_>>()
        } else { table_rows };

        let mut tables = Vec::with_capacity(table_rows.len());
        let mut truncated_columns = false;

        for row in table_rows {
            let schema: String = row.get(0);
            let name: String = row.get(1);
            let column_rows = client.query(
                "select a.attname::text as column_name, format_type(a.atttypid, a.atttypmod)::text as data_type \
                 from pg_attribute a \
                 join pg_class c on c.oid = a.attrelid \
                 join pg_namespace n on n.oid = c.relnamespace \
                 where n.nspname = $1 and c.relname = $2 \
                   and a.attnum > 0 and not a.attisdropped \
                 order by a.attnum limit $3",
                &[&schema, &name, &(MAX_EDITOR_COLUMNS_PER_TABLE + 1)],
            ).await.map_err(|error| map_pg_err(error, None))?;

            if column_rows.len() as i64 > MAX_EDITOR_COLUMNS_PER_TABLE { truncated_columns = true; }
            let columns = column_rows.into_iter().take(MAX_EDITOR_COLUMNS_PER_TABLE as usize)
                .map(|column| QueryEditorColumn { name: column.get(0), data_type: column.get(1) })
                .collect();

            tables.push(QueryEditorTable { schema, name, columns });
        }

        let function_rows = client.query(
            "select n.nspname::text as schema_name, p.proname::text as function_name, \
             coalesce(pg_get_function_identity_arguments(p.oid), '')::text as args, \
             pg_get_function_result(p.oid)::text as return_type \
             from pg_proc p \
             join pg_namespace n on n.oid = p.pronamespace \
             where n.nspname not in ('pg_catalog', 'information_schema') \
             order by n.nspname, p.proname limit $1",
            &[&(MAX_EDITOR_FUNCTIONS + 1)],
        ).await.map_err(|error| map_pg_err(error, None))?;

        let truncated_functions = function_rows.len() as i64 > MAX_EDITOR_FUNCTIONS;
        let functions = function_rows.into_iter().take(MAX_EDITOR_FUNCTIONS as usize)
            .map(|row| {
                let args_raw: String = row.get(2);
                QueryEditorFunction {
                    schema: row.get(0),
                    name: row.get(1),
                    arg_types: if args_raw.trim().is_empty() { Vec::new() }
                        else { args_raw.split(',').map(|value| value.trim().to_string()).collect() },
                    return_type: row.get(3),
                }
            }).collect();

        Ok(QueryEditorMetadata {
            tables, functions,
            truncated_tables, truncated_columns, truncated_functions,
        })
    }).await
}

pub(crate) async fn fetch_foreign_keys_for_connection(
    app: &AppHandle,
    state: &AppState,
    connection_id: &str,
    engine: DatabaseEngine,
) -> Result<Vec<ForeignKeyEdge>, String> {
    if engine == DatabaseEngine::Mysql {
        let pool = get_or_create_mysql_pool(app, state, connection_id).await?;
        let rows = sqlx::query(
            "select kcu.table_schema as from_schema, kcu.table_name as from_table, \
             kcu.column_name as from_column, kcu.referenced_table_schema as to_schema, \
             kcu.referenced_table_name as to_table, kcu.referenced_column_name as to_column \
             from information_schema.key_column_usage kcu \
             where kcu.referenced_table_name is not null \
             order by kcu.table_schema, kcu.table_name, kcu.ordinal_position \
             limit ?",
        ).bind(MAX_FOREIGN_KEY_ROWS).fetch_all(&pool).await.map_err(|error| error.to_string())?;
        let mut edges = Vec::new();
        for row in rows {
            edges.push(ForeignKeyEdge {
                from_schema: mysql_get_string(&row, 0, "from_schema", "get_foreign_keys")?,
                from_table: mysql_get_string(&row, 1, "from_table", "get_foreign_keys")?,
                from_column: mysql_get_string(&row, 2, "from_column", "get_foreign_keys")?,
                to_schema: mysql_get_string(&row, 3, "to_schema", "get_foreign_keys")?,
                to_table: mysql_get_string(&row, 4, "to_table", "get_foreign_keys")?,
                to_column: mysql_get_string(&row, 5, "to_column", "get_foreign_keys")?,
            });
        }
        return Ok(edges);
    }

    if engine == DatabaseEngine::Sqlite {
        let pool = get_or_create_sqlite_pool(app, state, connection_id).await?;
        let tables = sqlx::query(
            "select name from sqlite_master \
             where type = 'table' and name not like 'sqlite_%'",
        ).fetch_all(&pool).await.map_err(|error| error.to_string())?;
        let mut edges = Vec::new();
        for table in tables {
            let table_name: String = sqlite_get_idx(&table, 0, "name", "get_foreign_keys")?;
            require_safe_identifier(&table_name, "table name")?;
            let fk_sql = format!("PRAGMA foreign_key_list(\"{}\");", quote_identifier(&table_name));
            let fk_rows = sqlx::query(&fk_sql).fetch_all(&pool).await.map_err(|error| error.to_string())?;
            for row in fk_rows {
                edges.push(ForeignKeyEdge {
                    from_schema: "main".to_string(),
                    from_table: table_name.clone(),
                    from_column: sqlite_get_name(&row, "from", "get_foreign_keys")?,
                    to_schema: "main".to_string(),
                    to_table: sqlite_get_name(&row, "table", "get_foreign_keys")?,
                    to_column: sqlite_get_name(&row, "to", "get_foreign_keys")?,
                });
                if edges.len() >= MAX_FOREIGN_KEY_ROWS as usize {
                    return Ok(edges);
                }
            }
        }
        return Ok(edges);
    }

    with_pool_client_retry(app, state, connection_id, (), |client, ()| async move {
        let rows = client.query(
            "select src_ns.nspname::text as from_schema, src_cls.relname::text as from_table, \
             src_att.attname::text as from_column, tgt_ns.nspname::text as to_schema, \
             tgt_cls.relname::text as to_table, tgt_att.attname::text as to_column \
             from pg_constraint c \
             join pg_class src_cls on src_cls.oid = c.conrelid \
             join pg_namespace src_ns on src_ns.oid = src_cls.relnamespace \
             join pg_class tgt_cls on tgt_cls.oid = c.confrelid \
             join pg_namespace tgt_ns on tgt_ns.oid = tgt_cls.relnamespace \
             cross join lateral unnest(c.conkey, c.confkey) as u(attnum, confattnum) \
             join pg_attribute src_att on src_att.attrelid = c.conrelid \
              and src_att.attnum = u.attnum and not src_att.attisdropped \
             join pg_attribute tgt_att on tgt_att.attrelid = c.confrelid \
              and tgt_att.attnum = u.confattnum and not tgt_att.attisdropped \
             where c.contype = 'f' \
               and src_ns.nspname not in ('pg_catalog', 'information_schema') \
             order by src_ns.nspname, src_cls.relname, c.conname, u.attnum \
             limit $1",
            &[&MAX_FOREIGN_KEY_ROWS],
        ).await.map_err(|error| error.to_string())?;

        Ok(rows.into_iter().map(|row| ForeignKeyEdge {
            from_schema: row.get(0),
            from_table: row.get(1),
            from_column: row.get(2),
            to_schema: row.get(3),
            to_table: row.get(4),
            to_column: row.get(5),
        }).collect())
    }).await
}

#[tauri::command]
pub async fn get_query_editor_metadata(
    app: AppHandle,
    state: State<'_, AppState>,
    connection_id: Option<String>,
) -> Result<QueryEditorMetadata, String> {
    let (connection_id, engine) = resolve_connection_engine(&app, &state, connection_id).await?;

    if engine == DatabaseEngine::Mysql {
        let pool = get_or_create_mysql_pool(&app, &state, &connection_id).await?;
        let database = load_connection(&app, &connection_id)?
            .map(|connection| connection.database).unwrap_or_default();
        let table_rows = sqlx::query(
            "select table_schema, table_name \
             from information_schema.tables \
             where table_type = 'BASE TABLE' \
               and table_schema = ? \
               and table_schema not in ('information_schema', 'mysql', 'performance_schema', 'sys') \
             order by table_schema, table_name \
             limit ?",
        ).bind(&database).bind(MAX_EDITOR_TABLES + 1)
        .fetch_all(&pool).await.map_err(|error| error.to_string())?;

        let truncated_tables = table_rows.len() as i64 > MAX_EDITOR_TABLES;
        let mut tables = Vec::new();
        let mut truncated_columns = false;

        for row in table_rows.into_iter().take(MAX_EDITOR_TABLES as usize) {
            let schema: String = mysql_get_string(&row, 0, "table_schema", "get_query_editor_metadata")?;
            let name: String = mysql_get_string(&row, 1, "table_name", "get_query_editor_metadata")?;
            let column_rows = sqlx::query(
                "select column_name, data_type \
                 from information_schema.columns \
                 where table_schema = ? and table_name = ? \
                 order by ordinal_position limit ?",
            ).bind(&schema).bind(&name).bind(MAX_EDITOR_COLUMNS_PER_TABLE + 1)
            .fetch_all(&pool).await.map_err(|error| error.to_string())?;
            if column_rows.len() as i64 > MAX_EDITOR_COLUMNS_PER_TABLE { truncated_columns = true; }
            let mut columns = Vec::new();
            for column in column_rows.into_iter().take(MAX_EDITOR_COLUMNS_PER_TABLE as usize) {
                columns.push(QueryEditorColumn {
                    name: mysql_get_string(&column, 0, "column_name", "get_query_editor_metadata")?,
                    data_type: mysql_get_string(&column, 1, "data_type", "get_query_editor_metadata")?,
                });
            }
            tables.push(QueryEditorTable { schema, name, columns });
        }

        return Ok(QueryEditorMetadata {
            tables, functions: Vec::new(),
            truncated_tables, truncated_columns, truncated_functions: false,
        });
    }

    if engine == DatabaseEngine::Sqlite {
        let pool = get_or_create_sqlite_pool(&app, &state, &connection_id).await?;
        let table_rows = sqlx::query(
            "select name from sqlite_master \
             where type = 'table' and name not like 'sqlite_%' \
             order by name limit ?",
        ).bind(MAX_EDITOR_TABLES + 1).fetch_all(&pool).await.map_err(|error| error.to_string())?;
        let truncated_tables = table_rows.len() as i64 > MAX_EDITOR_TABLES;
        let mut tables = Vec::new();
        let mut truncated_columns = false;
        for row in table_rows.into_iter().take(MAX_EDITOR_TABLES as usize) {
            let name: String = sqlite_get_idx(&row, 0, "name", "get_query_editor_metadata")?;
            require_safe_identifier(&name, "table name")?;
            let pragma_sql = format!("PRAGMA table_info(\"{}\");", quote_identifier(&name));
            let column_rows = sqlx::query(&pragma_sql).fetch_all(&pool).await
                .map_err(|error| error.to_string())?;
            if column_rows.len() as i64 > MAX_EDITOR_COLUMNS_PER_TABLE { truncated_columns = true; }
            let mut columns = Vec::new();
            for column in column_rows.into_iter().take(MAX_EDITOR_COLUMNS_PER_TABLE as usize) {
                columns.push(QueryEditorColumn {
                    name: sqlite_get_name(&column, "name", "get_query_editor_metadata")?,
                    data_type: sqlite_get_name(&column, "type", "get_query_editor_metadata")?,
                });
            }
            tables.push(QueryEditorTable { schema: "main".to_string(), name, columns });
        }
        return Ok(QueryEditorMetadata {
            tables, functions: Vec::new(),
            truncated_tables, truncated_columns, truncated_functions: false,
        });
    }

    with_pool_client_retry(&app, &state, &connection_id, (), |client, ()| async move {
        let table_rows = client.query(
            "select n.nspname::text as schema_name, c.relname::text as table_name \
             from pg_class c \
             join pg_namespace n on n.oid = c.relnamespace \
             where c.relkind in ('r', 'p', 'v', 'm', 'f') \
               and n.nspname not in ('pg_catalog', 'information_schema') \
             order by n.nspname, c.relname \
             limit $1",
            &[&(MAX_EDITOR_TABLES + 1)],
        ).await.map_err(|error| map_pg_err(error, None))?;

        let truncated_tables = table_rows.len() as i64 > MAX_EDITOR_TABLES;
        let table_rows = if truncated_tables {
            table_rows.into_iter().take(MAX_EDITOR_TABLES as usize).collect::<Vec<_>>()
        } else { table_rows };

        let mut tables = Vec::with_capacity(table_rows.len());
        let mut truncated_columns = false;

        for row in table_rows {
            let schema: String = row.get(0);
            let name: String = row.get(1);
            let column_rows = client.query(
                "select a.attname::text as column_name, format_type(a.atttypid, a.atttypmod)::text as data_type \
                 from pg_attribute a \
                 join pg_class c on c.oid = a.attrelid \
                 join pg_namespace n on n.oid = c.relnamespace \
                 where n.nspname = $1 and c.relname = $2 \
                   and a.attnum > 0 and not a.attisdropped \
                 order by a.attnum limit $3",
                &[&schema, &name, &(MAX_EDITOR_COLUMNS_PER_TABLE + 1)],
            ).await.map_err(|error| map_pg_err(error, None))?;

            if column_rows.len() as i64 > MAX_EDITOR_COLUMNS_PER_TABLE { truncated_columns = true; }
            let columns = column_rows.into_iter().take(MAX_EDITOR_COLUMNS_PER_TABLE as usize)
                .map(|column| QueryEditorColumn { name: column.get(0), data_type: column.get(1) })
                .collect();

            tables.push(QueryEditorTable { schema, name, columns });
        }

        let function_rows = client.query(
            "select n.nspname::text as schema_name, p.proname::text as function_name, \
             coalesce(pg_get_function_identity_arguments(p.oid), '')::text as args, \
             pg_get_function_result(p.oid)::text as return_type \
             from pg_proc p \
             join pg_namespace n on n.oid = p.pronamespace \
             where n.nspname not in ('pg_catalog', 'information_schema') \
             order by n.nspname, p.proname limit $1",
            &[&(MAX_EDITOR_FUNCTIONS + 1)],
        ).await.map_err(|error| map_pg_err(error, None))?;

        let truncated_functions = function_rows.len() as i64 > MAX_EDITOR_FUNCTIONS;
        let functions = function_rows.into_iter().take(MAX_EDITOR_FUNCTIONS as usize)
            .map(|row| {
                let args_raw: String = row.get(2);
                QueryEditorFunction {
                    schema: row.get(0),
                    name: row.get(1),
                    arg_types: if args_raw.trim().is_empty() { Vec::new() }
                        else { args_raw.split(',').map(|value| value.trim().to_string()).collect() },
                    return_type: row.get(3),
                }
            }).collect();

        Ok(QueryEditorMetadata {
            tables, functions,
            truncated_tables, truncated_columns, truncated_functions,
        })
    }).await
}
