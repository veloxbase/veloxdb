use std::collections::{HashMap, HashSet};
use tauri::{AppHandle, State};

use crate::db::{
    get_or_create_mysql_pool, get_or_create_sqlite_pool, quote_identifier,
    require_safe_identifier, resolve_connection_engine, with_pool_client_retry, AppState,
};
use crate::models::{
    ColumnProperties, DatabaseEngine, ForeignKeyEdge,
    IndexInfo, SchemaRequest, TableIndexesResult, TablePropertiesApplyRequest,
};
use crate::pg_error::map_pg_err;

use super::{
    MAX_TABLE_INDEX_ROWS, MAX_FOREIGN_KEY_ROWS,
    mysql_get_string, mysql_get_optional_string, mysql_get_idx,
    sqlite_get_name, sqlite_get_idx,
    veloxdb_unique_constraint_name,
};

#[tauri::command]
pub async fn get_table_properties(
    app: AppHandle,
    state: State<'_, AppState>,
    input: SchemaRequest,
) -> Result<Vec<ColumnProperties>, String> {
    let (connection_id, engine) = resolve_connection_engine(&app, &state, input.connection_id.clone()).await?;
    let ctx = input.clone();

    if engine == DatabaseEngine::Mysql {
        let pool = get_or_create_mysql_pool(&app, &state, &connection_id).await?;
        let rows = sqlx::query(
            "select c.table_schema, c.table_name, c.column_name, c.data_type, \
             c.is_nullable, c.column_default, c.extra \
             from information_schema.columns c \
             where c.table_schema = ? and c.table_name = ? \
             order by c.ordinal_position",
        ).bind(&ctx.table_schema).bind(&ctx.table_name).fetch_all(&pool).await
            .map_err(|error| error.to_string())?;

        let pk_rows = sqlx::query(
            "select column_name from information_schema.key_column_usage \
             where table_schema = ? and table_name = ? and constraint_name = 'PRIMARY'",
        ).bind(&ctx.table_schema).bind(&ctx.table_name).fetch_all(&pool).await
            .map_err(|error| error.to_string())?;
        let pk_cols: HashSet<String> = pk_rows.into_iter()
            .map(|row| mysql_get_string(&row, 0, "column_name", "get_table_properties"))
            .collect::<Result<HashSet<_>, _>>()?;

        let unique_rows = sqlx::query(
            "select index_name, column_name, seq_in_index \
             from information_schema.statistics \
             where table_schema = ? and table_name = ? and non_unique = 0 \
             order by index_name, seq_in_index",
        ).bind(&ctx.table_schema).bind(&ctx.table_name).fetch_all(&pool).await
            .map_err(|error| error.to_string())?;
        let mut unique_by_index: HashMap<String, Vec<String>> = HashMap::new();
        for row in unique_rows {
            let index_name: String = mysql_get_string(&row, 0, "index_name", "get_table_properties")?;
            if index_name == "PRIMARY" { continue; }
            let column_name: String = mysql_get_string(&row, 1, "column_name", "get_table_properties")?;
            unique_by_index.entry(index_name).or_default().push(column_name);
        }
        let mut unique_cols: HashSet<String> = HashSet::new();
        let mut composite_unique_cols: HashSet<String> = HashSet::new();
        for cols in unique_by_index.values() {
            for col in cols { unique_cols.insert(col.clone()); }
            if cols.len() > 1 { for col in cols { composite_unique_cols.insert(col.clone()); } }
        }

        let mut properties = Vec::new();
        for row in rows {
            let column_name: String = mysql_get_string(&row, 2, "column_name", "get_table_properties")?;
            let is_primary_key = pk_cols.contains(&column_name);
            let is_unique = is_primary_key || unique_cols.contains(&column_name);
            let is_part_of_composite_unique = composite_unique_cols.contains(&column_name);
            let extra: String = mysql_get_string(&row, 6, "extra", "get_table_properties")?;
            let lower_extra = extra.to_lowercase();
            properties.push(ColumnProperties {
                table_schema: mysql_get_string(&row, 0, "table_schema", "get_table_properties")?,
                table_name: mysql_get_string(&row, 1, "table_name", "get_table_properties")?,
                column_name,
                data_type: mysql_get_string(&row, 3, "data_type", "get_table_properties")?,
                is_nullable: mysql_get_string(&row, 4, "is_nullable", "get_table_properties")? == "YES",
                is_primary_key, is_unique, is_part_of_composite_unique,
                column_default: mysql_get_optional_string(&row, 5, "column_default", "get_table_properties")?,
                is_identity: lower_extra.contains("auto_increment"),
                identity_generation: if lower_extra.contains("auto_increment") { Some("BY DEFAULT".to_string()) } else { None },
                is_generated: if lower_extra.contains("generated") { Some("ALWAYS".to_string()) } else { None },
            });
        }
        return Ok(properties);
    }

    if engine == DatabaseEngine::Sqlite {
        let pool = get_or_create_sqlite_pool(&app, &state, &connection_id).await?;
        require_safe_identifier(&ctx.table_name, "table name")?;
        let pragma_sql = format!("PRAGMA table_info(\"{}\");", quote_identifier(&ctx.table_name));
        let rows = sqlx::query(&pragma_sql).fetch_all(&pool).await.map_err(|error| error.to_string())?;
        let index_list_sql = format!("PRAGMA index_list(\"{}\");", quote_identifier(&ctx.table_name));
        let index_rows = sqlx::query(&index_list_sql).fetch_all(&pool).await.map_err(|error| error.to_string())?;
        let mut unique_cols: HashSet<String> = HashSet::new();
        let mut composite_unique_cols: HashSet<String> = HashSet::new();
        for index in index_rows {
            let is_unique = sqlite_get_name::<i64>(&index, "unique", "get_table_properties")? == 1;
            if !is_unique { continue; }
            let origin = sqlite_get_name::<String>(&index, "origin", "get_table_properties")?;
            if origin == "pk" { continue; }
            let index_name = sqlite_get_name::<String>(&index, "name", "get_table_properties")?;
            require_safe_identifier(&index_name, "index name")?;
            let info_sql = format!("PRAGMA index_info(\"{}\");", quote_identifier(&index_name));
            let info_rows = sqlx::query(&info_sql).fetch_all(&pool).await.map_err(|error| error.to_string())?;
            let mut cols: Vec<String> = Vec::new();
            for info in info_rows {
                if let Ok(name) = sqlite_get_name::<String>(&info, "name", "get_table_properties") { cols.push(name); }
            }
            for col in &cols { unique_cols.insert(col.clone()); }
            if cols.len() > 1 { for col in cols { composite_unique_cols.insert(col); } }
        }
        let mut properties = Vec::new();
        for row in rows {
            let column_name: String = sqlite_get_name(&row, "name", "get_table_properties")?;
            let is_primary_key = sqlite_get_name::<i64>(&row, "pk", "get_table_properties")? == 1;
            let is_unique = is_primary_key || unique_cols.contains(&column_name);
            let is_part_of_composite_unique = composite_unique_cols.contains(&column_name);
            properties.push(ColumnProperties {
                table_schema: "main".to_string(),
                table_name: ctx.table_name.clone(),
                column_name,
                data_type: sqlite_get_name(&row, "type", "get_table_properties")?,
                is_nullable: sqlite_get_name::<i64>(&row, "notnull", "get_table_properties")? == 0,
                is_primary_key, is_unique, is_part_of_composite_unique,
                column_default: sqlite_get_name::<Option<String>>(&row, "dflt_value", "get_table_properties")?,
                is_identity: false,
                identity_generation: None,
                is_generated: None,
            });
        }
        return Ok(properties);
    }

    if engine == DatabaseEngine::Duckdb {
        return crate::commands::duckdb::duckdb_get_table_properties(app, state, ctx).await;
    }

    if engine == DatabaseEngine::Mongo || engine == DatabaseEngine::Redis {
        return Err("Table properties are not supported for this engine type.".to_string());
    }

    with_pool_client_retry(&app, &state, &connection_id, ctx, |client, input| async move {
        let columns = client.query(
            "select c.table_schema, c.table_name, c.column_name, c.data_type, \
             c.is_nullable, c.column_default, c.is_identity, c.identity_generation, c.is_generated \
             from information_schema.columns c \
             where c.table_schema = $1 and c.table_name = $2 \
             order by c.ordinal_position",
            &[&input.table_schema, &input.table_name],
        ).await.map_err(|error| map_pg_err(error, None))?;

        let primary_keys = client.query(
            "select kcu.column_name \
             from information_schema.table_constraints tc \
             join information_schema.key_column_usage kcu \
               on tc.constraint_name = kcu.constraint_name \
              and tc.table_schema = kcu.table_schema \
             where tc.table_schema = $1 and tc.table_name = $2 \
               and tc.constraint_type = 'PRIMARY KEY' \
             order by kcu.ordinal_position",
            &[&input.table_schema, &input.table_name],
        ).await.map_err(|error| map_pg_err(error, None))?;

        let primary_key_columns: HashSet<String> = primary_keys.into_iter()
            .map(|row| row.get::<_, String>(0)).collect();

        let unique_constraints = client.query(
            "select tc.constraint_name, kcu.column_name, kcu.ordinal_position \
             from information_schema.table_constraints tc \
             join information_schema.key_column_usage kcu \
               on tc.constraint_name = kcu.constraint_name \
              and tc.table_schema = kcu.table_schema \
             where tc.table_schema = $1 and tc.table_name = $2 \
               and tc.constraint_type = 'UNIQUE' \
             order by tc.constraint_name, kcu.ordinal_position",
            &[&input.table_schema, &input.table_name],
        ).await.map_err(|error| map_pg_err(error, None))?;

        let mut unique_by_name: HashMap<String, Vec<String>> = HashMap::new();
        for row in unique_constraints {
            let constraint_name: String = row.get(0);
            let column_name: String = row.get(1);
            unique_by_name.entry(constraint_name).or_default().push(column_name);
        }

        let mut unique_columns: HashSet<String> = HashSet::new();
        let mut composite_unique_columns: HashSet<String> = HashSet::new();
        for (_constraint_name, cols) in unique_by_name {
            for c in &cols { unique_columns.insert(c.clone()); }
            if cols.len() > 1 { for c in &cols { composite_unique_columns.insert(c.clone()); } }
        }

        Ok(columns.into_iter().map(|row| {
            let column_name: String = row.get(2);
            let is_primary_key = primary_key_columns.contains(&column_name);
            let is_unique = is_primary_key || unique_columns.contains(&column_name);
            let is_part_of_composite_unique = composite_unique_columns.contains(&column_name);
            ColumnProperties {
                table_schema: row.get(0),
                table_name: row.get(1),
                column_name,
                data_type: row.get(3),
                is_nullable: row.get::<_, String>(4) == "YES",
                is_primary_key, is_unique, is_part_of_composite_unique,
                column_default: row.get(5),
                is_identity: row.get::<_, Option<String>>(6).as_deref() == Some("YES"),
                identity_generation: row.get(7),
                is_generated: row.get(8),
            }
        }).collect())
    }).await.map_err(String::from)
}

#[tauri::command]
pub async fn apply_table_properties(
    app: AppHandle,
    state: State<'_, AppState>,
    input: TablePropertiesApplyRequest,
) -> Result<(), String> {
    let (connection_id, engine) = resolve_connection_engine(&app, &state, input.connection_id.clone()).await?;
    if engine != DatabaseEngine::Postgres && engine != DatabaseEngine::Duckdb {
        return Err(format!(
            "Table property editing is not supported for {} connections yet.",
            match engine {
                DatabaseEngine::Postgres => "PostgreSQL",
                DatabaseEngine::Mysql => "MySQL",
                DatabaseEngine::Sqlite => "SQLite",
                DatabaseEngine::Mongo => "MongoDB",
                DatabaseEngine::Duckdb => "DuckDB",
                DatabaseEngine::Redis => "Redis",
            }
        ));
    }

    if engine == DatabaseEngine::Duckdb {
        return crate::commands::duckdb::duckdb_apply_table_properties(app, state, input).await;
    }

    with_pool_client_retry(&app, &state, &connection_id, input, |mut client, input| async move {
        let table_schema = input.table_schema;
        let table_name = input.table_name;
        let columns = input.columns;

        require_safe_identifier(&table_schema, "schema name")?;
        require_safe_identifier(&table_name, "table name")?;

        let current_columns = client.query(
            "select column_name, is_nullable \
             from information_schema.columns \
             where table_schema = $1 and table_name = $2",
            &[&table_schema, &table_name],
        ).await.map_err(|error| map_pg_err(error, None))?;

        let mut current_nullable: HashMap<String, bool> = HashMap::new();
        for row in current_columns {
            let column_name: String = row.get(0);
            let is_nullable = row.get::<_, String>(1) == "YES";
            current_nullable.insert(column_name, is_nullable);
        }

        let primary_keys = client.query(
            "select kcu.column_name \
             from information_schema.table_constraints tc \
             join information_schema.key_column_usage kcu \
               on tc.constraint_name = kcu.constraint_name \
              and tc.table_schema = kcu.table_schema \
             where tc.table_schema = $1 and tc.table_name = $2 \
               and tc.constraint_type = 'PRIMARY KEY'",
            &[&table_schema, &table_name],
        ).await.map_err(|error| map_pg_err(error, None))?;

        let primary_key_columns: HashSet<String> = primary_keys.into_iter()
            .map(|row| row.get::<_, String>(0)).collect();

        let unique_constraints = client.query(
            "select tc.constraint_name, kcu.column_name, kcu.ordinal_position \
             from information_schema.table_constraints tc \
             join information_schema.key_column_usage kcu \
               on tc.constraint_name = kcu.constraint_name \
              and tc.table_schema = kcu.table_schema \
             where tc.table_schema = $1 and tc.table_name = $2 \
               and tc.constraint_type = 'UNIQUE' \
             order by tc.constraint_name, kcu.ordinal_position",
            &[&table_schema, &table_name],
        ).await.map_err(|error| map_pg_err(error, None))?;

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
                for c in cols { composite_unique_columns.insert(c.clone()); }
            } else if cols.len() == 1 {
                let c = &cols[0];
                single_unique_constraint_names_by_column.entry(c.clone()).or_default().push(constraint_name.clone());
            }
        }

        let mut desired_by_column: HashMap<String, (bool, bool)> = HashMap::new();
        for update in columns {
            desired_by_column.insert(update.column_name, (update.is_nullable, update.is_unique));
        }

        let txn = client.transaction().await.map_err(|error| map_pg_err(error, None))?;

        for (column_name, (desired_is_nullable, _desired_is_unique)) in &desired_by_column {
            let current_is_nullable = current_nullable.get(column_name)
                .ok_or_else(|| format!("Unknown column: {}", column_name))?;
            if *current_is_nullable == *desired_is_nullable { continue; }

            let qualified_table = format!("\"{}\".\"{}\"", quote_identifier(&table_schema), quote_identifier(&table_name));
            require_safe_identifier(column_name, "column name")?;
            let qualified_column = format!("\"{}\"", quote_identifier(column_name));

            if *desired_is_nullable {
                let sql = format!("ALTER TABLE {} ALTER COLUMN {} DROP NOT NULL", qualified_table, qualified_column);
                txn.execute(sql.as_str(), &[]).await.map_err(|error| map_pg_err(error, Some(sql.as_str())))?;
            } else {
                let sql = format!("ALTER TABLE {} ALTER COLUMN {} SET NOT NULL", qualified_table, qualified_column);
                txn.execute(sql.as_str(), &[]).await.map_err(|error| map_pg_err(error, Some(sql.as_str())))?;
            }
        }

        for (column_name, (_desired_is_nullable, desired_is_unique)) in &desired_by_column {
            let is_primary_key = primary_key_columns.contains(column_name);
            let is_part_of_composite_unique = composite_unique_columns.contains(column_name);

            if !*desired_is_unique {
                if is_primary_key {
                    return Err(format!("Cannot disable UNIQUE for primary key column: {}", column_name));
                }
                if is_part_of_composite_unique {
                    return Err(format!("Cannot disable UNIQUE for column in a composite UNIQUE constraint: {}", column_name));
                }
            }

            let has_single_unique = single_unique_constraint_names_by_column.get(column_name)
                .map(|names| !names.is_empty()).unwrap_or(false);
            let current_is_unique = is_primary_key || has_single_unique || is_part_of_composite_unique;

            if *desired_is_unique == current_is_unique { continue; }

            let qualified_table = format!("\"{}\".\"{}\"", quote_identifier(&table_schema), quote_identifier(&table_name));
            require_safe_identifier(column_name, "column name")?;
            let qualified_column = format!("\"{}\"", quote_identifier(column_name));

            if *desired_is_unique {
                if current_is_unique { continue; }
                let generated_name = veloxdb_unique_constraint_name(&table_name, column_name);
                if let Some(existing_cols) = unique_by_name.get(&generated_name) {
                    if existing_cols.len() != 1 || existing_cols[0] != *column_name {
                        return Err(format!(
                            "Cannot create UNIQUE constraint due to name collision ({}). Rename the existing constraint.",
                            generated_name
                        ));
                    }
                }
                let sql = format!("ALTER TABLE {} ADD CONSTRAINT \"{}\" UNIQUE ({})",
                    qualified_table, quote_identifier(&generated_name), qualified_column);
                txn.execute(sql.as_str(), &[]).await.map_err(|error| map_pg_err(error, Some(sql.as_str())))?;
            } else {
                let constraint_names = single_unique_constraint_names_by_column.get(column_name)
                    .cloned().unwrap_or_default();
                for constraint_name in constraint_names {
                    require_safe_identifier(&constraint_name, "constraint name")?;
                    let sql = format!("ALTER TABLE {} DROP CONSTRAINT \"{}\"",
                        qualified_table, quote_identifier(&constraint_name));
                    txn.execute(sql.as_str(), &[]).await.map_err(|error| map_pg_err(error, Some(sql.as_str())))?;
                }
            }
        }

        txn.commit().await.map_err(|error| map_pg_err(error, None))?;
        Ok(())
    }).await.map_err(String::from)
}

#[tauri::command]
pub async fn get_foreign_keys(
    app: AppHandle,
    state: State<'_, AppState>,
    connection_id: Option<String>,
) -> Result<Vec<ForeignKeyEdge>, String> {
    let (connection_id, engine) = resolve_connection_engine(&app, &state, connection_id).await?;

    if engine == DatabaseEngine::Mysql {
        let pool = get_or_create_mysql_pool(&app, &state, &connection_id).await?;
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
        let pool = get_or_create_sqlite_pool(&app, &state, &connection_id).await?;
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
                    from_schema: "main".to_string(), from_table: table_name.clone(),
                    from_column: sqlite_get_name(&row, "from", "get_foreign_keys")?,
                    to_schema: "main".to_string(),
                    to_table: sqlite_get_name(&row, "table", "get_foreign_keys")?,
                    to_column: sqlite_get_name(&row, "to", "get_foreign_keys")?,
                });
                if edges.len() >= MAX_FOREIGN_KEY_ROWS as usize { return Ok(edges); }
            }
        }
        return Ok(edges);
    }

    if engine == DatabaseEngine::Duckdb {
        return crate::commands::duckdb::duckdb_get_foreign_keys(app, state, Some(connection_id)).await;
    }

    if engine == DatabaseEngine::Mongo || engine == DatabaseEngine::Redis {
        return Ok(Vec::new());
    }

    with_pool_client_retry(&app, &state, &connection_id, (), |client, ()| async move {
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
            from_schema: row.get(0), from_table: row.get(1), from_column: row.get(2),
            to_schema: row.get(3), to_table: row.get(4), to_column: row.get(5),
        }).collect())
    }).await.map_err(String::from)
}

#[tauri::command]
pub async fn get_table_indexes(
    app: AppHandle,
    state: State<'_, AppState>,
    input: SchemaRequest,
) -> Result<TableIndexesResult, String> {
    let (connection_id, engine) = resolve_connection_engine(&app, &state, input.connection_id.clone()).await?;
    let ctx = input.clone();

    if engine == DatabaseEngine::Mysql {
        let pool = get_or_create_mysql_pool(&app, &state, &connection_id).await?;
        let fetch_limit = MAX_TABLE_INDEX_ROWS + 1;
        let rows = sqlx::query(
            "select table_schema as index_schema, index_name, table_schema, table_name, \
             non_unique = 0 as is_unique, index_name = 'PRIMARY' as is_primary, \
             true as is_valid, false as is_partial, \
             concat(index_name, ' (', group_concat(column_name order by seq_in_index separator ', '), ')') as definition, \
             0 as index_bytes, 0 as idx_scan, 0 as idx_tup_read, 0 as idx_tup_fetch \
             from information_schema.statistics \
             where table_schema = ? and table_name = ? \
             group by table_schema, table_name, index_name, non_unique \
             order by index_name limit ?",
        ).bind(&ctx.table_schema).bind(&ctx.table_name).bind(fetch_limit)
        .fetch_all(&pool).await.map_err(|error| error.to_string())?;
        let truncated = rows.len() as i64 > MAX_TABLE_INDEX_ROWS;
        let mut indexes = Vec::new();
        for row in rows.into_iter().take(MAX_TABLE_INDEX_ROWS as usize) {
            indexes.push(IndexInfo {
                index_schema: mysql_get_string(&row, 0, "index_schema", "get_table_indexes")?,
                index_name: mysql_get_string(&row, 1, "index_name", "get_table_indexes")?,
                table_schema: mysql_get_string(&row, 2, "table_schema", "get_table_indexes")?,
                table_name: mysql_get_string(&row, 3, "table_name", "get_table_indexes")?,
                is_unique: mysql_get_idx(&row, 4, "is_unique", "get_table_indexes")?,
                is_primary: mysql_get_idx(&row, 5, "is_primary", "get_table_indexes")?,
                is_valid: true, is_partial: false,
                definition: mysql_get_string(&row, 8, "definition", "get_table_indexes")?,
                index_bytes: 0, idx_scan: 0, idx_tup_read: 0, idx_tup_fetch: 0,
            });
        }
        return Ok(TableIndexesResult { indexes, truncated });
    }

    if engine == DatabaseEngine::Sqlite {
        let pool = get_or_create_sqlite_pool(&app, &state, &connection_id).await?;
        require_safe_identifier(&ctx.table_name, "table name")?;
        let pragma_sql = format!("PRAGMA index_list(\"{}\");", quote_identifier(&ctx.table_name));
        let rows = sqlx::query(&pragma_sql).fetch_all(&pool).await.map_err(|error| error.to_string())?;
        let truncated = rows.len() as i64 > MAX_TABLE_INDEX_ROWS;
        let mut indexes = Vec::new();
        for row in rows.into_iter().take(MAX_TABLE_INDEX_ROWS as usize) {
            let index_name: String = sqlite_get_name(&row, "name", "get_table_indexes")?;
            require_safe_identifier(&index_name, "index name")?;
            let index_info_sql = format!("PRAGMA index_info(\"{}\");", quote_identifier(&index_name));
            let index_info_rows = sqlx::query(&index_info_sql).fetch_all(&pool).await
                .map_err(|error| error.to_string())?;
            let index_columns = index_info_rows.into_iter()
                .filter_map(|idx| sqlite_get_name::<String>(&idx, "name", "get_table_indexes").ok())
                .collect::<Vec<_>>();
            indexes.push(IndexInfo {
                index_schema: "main".to_string(), index_name: index_name.clone(),
                table_schema: "main".to_string(), table_name: ctx.table_name.clone(),
                is_unique: sqlite_get_name::<i64>(&row, "unique", "get_table_indexes")? == 1,
                is_primary: sqlite_get_name::<String>(&row, "origin", "get_table_indexes")? == "pk",
                is_valid: true,
                is_partial: sqlite_get_name::<i64>(&row, "partial", "get_table_indexes")? == 1,
                definition: if index_columns.is_empty() {
                    format!("index {}", index_name)
                } else {
                    format!("index {} ({})", index_name, index_columns.join(", "))
                },
                index_bytes: 0, idx_scan: 0, idx_tup_read: 0, idx_tup_fetch: 0,
            });
        }
        return Ok(TableIndexesResult { indexes, truncated });
    }

    if engine == DatabaseEngine::Duckdb {
        return crate::commands::duckdb::duckdb_get_table_indexes(app, state, ctx).await;
    }

    if engine == DatabaseEngine::Mongo {
        return crate::commands::mongo::mongo_get_table_indexes(&app, &state, &connection_id, &ctx.table_schema, &ctx.table_name).await;
    }

    if engine == DatabaseEngine::Redis {
        return Ok(TableIndexesResult { indexes: Vec::new(), truncated: false });
    }

    with_pool_client_retry(&app, &state, &connection_id, ctx, |client, input| async move {
        let table_schema = input.table_schema;
        let table_name = input.table_name;
        let fetch_limit = MAX_TABLE_INDEX_ROWS + 1;

        let rows = client.query(
            "select ins.nspname::text as index_schema, ic.relname::text as index_name, \
             tn.nspname::text as table_schema, tc.relname::text as table_name, \
             i.indisunique as is_unique, i.indisprimary as is_primary, \
             i.indisvalid as is_valid, (i.indpred is not null) as is_partial, \
             pg_get_indexdef(i.indexrelid) as definition, \
             coalesce(pg_relation_size(i.indexrelid::regclass), 0)::bigint as index_bytes, \
             coalesce(s.idx_scan, 0)::bigint as idx_scan, \
             coalesce(s.idx_tup_read, 0)::bigint as idx_tup_read, \
             coalesce(s.idx_tup_fetch, 0)::bigint as idx_tup_fetch \
             from pg_index i \
             join pg_class ic on ic.oid = i.indexrelid \
             join pg_namespace ins on ins.oid = ic.relnamespace \
             join pg_class tc on tc.oid = i.indrelid \
             join pg_namespace tn on tn.oid = tc.relnamespace \
             left join pg_stat_user_indexes s on s.indexrelid = i.indexrelid \
             where tn.nspname = $1 and tc.relname = $2 \
               and ins.nspname not in ('pg_catalog', 'information_schema') \
             order by ic.relname limit $3",
            &[&table_schema, &table_name, &fetch_limit],
        ).await.map_err(|error| error.to_string())?;

        let truncated = rows.len() as i64 > MAX_TABLE_INDEX_ROWS;
        let take = if truncated { MAX_TABLE_INDEX_ROWS as usize } else { rows.len() };
        let mut indexes = Vec::with_capacity(take);
        for row in rows.into_iter().take(take) {
            indexes.push(IndexInfo {
                index_schema: row.get(0), index_name: row.get(1),
                table_schema: row.get(2), table_name: row.get(3),
                is_unique: row.get(4), is_primary: row.get(5),
                is_valid: row.get(6), is_partial: row.get(7),
                definition: row.get(8),
                index_bytes: row.get(9), idx_scan: row.get(10),
                idx_tup_read: row.get(11), idx_tup_fetch: row.get(12),
            });
        }
        Ok(TableIndexesResult { indexes, truncated })
    }).await.map_err(String::from)
}
