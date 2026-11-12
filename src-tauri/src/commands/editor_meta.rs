use std::collections::HashMap;
use mongodb::bson::{doc, Bson, Document};

use tauri::{AppHandle, State};

use crate::db::{
    get_or_create_duckdb_connection, get_or_create_mongo_client, get_or_create_mysql_pool,
    get_or_create_sqlite_pool, load_connection, quote_identifier, require_safe_identifier,
    resolve_connection_engine, with_pool_client_retry, AppState,
};
use crate::engines::{get_engine, DatabaseEngineOps};
use crate::models::{
    DatabaseEngine, ForeignKeyEdge, QueryEditorColumn, QueryEditorEnum, QueryEditorFunction,
    QueryEditorMetadata, QueryEditorTable,
};
use crate::pg_error::map_pg_err;

use super::{
    MAX_EDITOR_TABLES, MAX_EDITOR_COLUMNS_PER_TABLE, MAX_EDITOR_ENUMS, MAX_EDITOR_FUNCTIONS,
    MAX_FOREIGN_KEY_ROWS, mysql_get_string, sqlite_get_idx, sqlite_get_name,
};

fn infer_bson_type(value: &Bson) -> &'static str {
    match value {
        Bson::String(_) => "string",
        Bson::Int32(_) | Bson::Int64(_) => "integer",
        Bson::Double(_) => "double",
        Bson::Boolean(_) => "boolean",
        Bson::ObjectId(_) => "objectId",
        Bson::DateTime(_) => "date",
        Bson::Array(_) => "array",
        Bson::Document(_) => "object",
        Bson::Null => "null",
        Bson::Binary(_) => "binary",
        Bson::RegularExpression(_) => "regex",
        Bson::Decimal128(_) => "decimal",
        _ => "unknown",
    }
}

pub(crate) async fn fetch_query_editor_metadata_for_connection(
    app: &AppHandle,
    state: &AppState,
    connection_id: &str,
    engine: DatabaseEngine,
) -> Result<QueryEditorMetadata, String> {
    if matches!(
        engine,
        DatabaseEngine::Clickhouse
            | DatabaseEngine::Libsql
            | DatabaseEngine::Turso
            | DatabaseEngine::Scylladb
            | DatabaseEngine::Cassandra
            | DatabaseEngine::Mssql
            | DatabaseEngine::Azuresql
    ) {
        let engine_ops = get_engine(engine);
        let table_infos = engine_ops
            .get_tables(app, state, connection_id)
            .await
            .map_err(|e| e.to_string())?;
        let truncated_tables = table_infos.len() as i64 > MAX_EDITOR_TABLES;
        let mut tables = Vec::new();
        let mut truncated_columns = false;

        for t in table_infos.into_iter().take(MAX_EDITOR_TABLES as usize) {
            let col_infos = engine_ops
                .get_schema(app, state, connection_id, &t.schema, &t.name)
                .await
                .map_err(|e| e.to_string())?;
            if col_infos.len() as i64 > MAX_EDITOR_COLUMNS_PER_TABLE {
                truncated_columns = true;
            }
            let columns = col_infos
                .into_iter()
                .take(MAX_EDITOR_COLUMNS_PER_TABLE as usize)
                .map(|c| QueryEditorColumn {
                    name: c.column_name,
                    data_type: c.data_type,
                    comment: None,
                    is_nullable: Some(c.is_nullable),
                    is_primary_key: None,
                })
                .collect();
            tables.push(QueryEditorTable {
                schema: t.schema,
                name: t.name,
                columns,
                estimated_rows: None,
                comment: None,
            });
        }

        return Ok(QueryEditorMetadata {
            tables,
            functions: Vec::new(),
            enums: Vec::new(),
            truncated_tables,
            truncated_columns,
            truncated_functions: false,
        });
    }

    if engine == DatabaseEngine::Mongo {
        let client = get_or_create_mongo_client(app, state, connection_id).await
            .map_err(|e| e.to_string())?;
        let stored = load_connection(app, connection_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Stored connection details were not found.".to_string())?;
        let db_name = if !stored.database.trim().is_empty() {
            stored.database.clone()
        } else {
            client.default_database().map(|d| d.name().to_string()).unwrap_or_else(|| "test".to_string())
        };
        let db = client.database(&db_name);
        let collection_names = db.list_collection_names().await
            .map_err(|e| format!("Failed to list MongoDB collections: {}", e))?;

        let truncated_tables = collection_names.len() as i64 > MAX_EDITOR_TABLES;
        let mut tables = Vec::new();
        let mut truncated_columns = false;

        for coll_name in collection_names.into_iter().take(MAX_EDITOR_TABLES as usize) {
            let coll = db.collection::<Document>(&coll_name);
            let mut cursor = coll.find(doc! {}).limit(50).await
                .map_err(|e| format!("Failed to sample collection {}: {}", coll_name, e))?;

            let mut field_names = Vec::new();
            let mut field_types = std::collections::BTreeMap::new();

            while let Ok(true) = cursor.advance().await {
                if let Ok(doc) = cursor.deserialize_current() {
                    for (key, val) in &doc {
                        if !field_types.contains_key(key) {
                            field_names.push(key.clone());
                            let btype = infer_bson_type(val);
                            if btype != "null" {
                                field_types.insert(key.clone(), btype);
                            }
                        }
                    }
                }
            }

            if field_names.len() as i64 > MAX_EDITOR_COLUMNS_PER_TABLE {
                truncated_columns = true;
            }

            let columns = field_names.into_iter().take(MAX_EDITOR_COLUMNS_PER_TABLE as usize).map(|name| {
                let data_type = field_types.get(&name).copied().unwrap_or("unknown").to_string();
                QueryEditorColumn {
                    name,
                    data_type,
                    comment: None,
                    is_nullable: None,
                    is_primary_key: None,
                }
            }).collect();

            tables.push(QueryEditorTable {
                schema: db_name.clone(),
                name: coll_name,
                columns,
                estimated_rows: None,
                comment: None,
            });
        }

        let mongo_methods = [
            ("find", "filter, projection", "Cursor"),
            ("findOne", "filter, projection", "Document"),
            ("aggregate", "pipeline", "Cursor"),
            ("countDocuments", "filter", "number"),
            ("distinct", "field, filter", "Array"),
            ("insertOne", "document", "InsertOneResult"),
            ("insertMany", "documents", "InsertManyResult"),
            ("updateOne", "filter, update", "UpdateResult"),
            ("updateMany", "filter, update", "UpdateResult"),
            ("deleteOne", "filter", "DeleteResult"),
            ("deleteMany", "filter", "DeleteResult"),
        ];

        let functions = mongo_methods.iter().map(|(name, args, ret)| QueryEditorFunction {
            schema: "db".to_string(),
            name: name.to_string(),
            arg_types: args.split(", ").map(|s| s.to_string()).collect(),
            return_type: ret.to_string(),
        }).collect();

        return Ok(QueryEditorMetadata {
            tables,
            functions,
            enums: Vec::new(),
            truncated_tables,
            truncated_columns,
            truncated_functions: false,
        });
    }

    if engine == DatabaseEngine::Duckdb {
        get_or_create_duckdb_connection(app, state, connection_id).await
            .map_err(|e| e.to_string())?;
        let conns = state.duckdb_connections.read().await;
        let conn_mutex = conns.get(connection_id)
            .ok_or_else(|| "DuckDB connection not found".to_string())?;
        let conn = conn_mutex.lock().await;

        let mut stmt = conn.prepare(
            "select table_name from information_schema.tables where table_schema = 'main' order by table_name limit ?"
        ).map_err(|e| e.to_string())?;
        let table_names: Vec<String> = stmt.query_map([MAX_EDITOR_TABLES + 1], |row| row.get(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();

        let truncated_tables = table_names.len() as i64 > MAX_EDITOR_TABLES;
        let mut tables = Vec::new();
        let mut truncated_columns = false;

        for name in table_names.into_iter().take(MAX_EDITOR_TABLES as usize) {
            let mut col_stmt = conn.prepare(
                "select column_name, data_type from information_schema.columns where table_schema = 'main' and table_name = ? order by ordinal_position limit ?"
            ).map_err(|e| e.to_string())?;
            let col_rows: Vec<(String, String)> = col_stmt.query_map(duckdb::params![name, MAX_EDITOR_COLUMNS_PER_TABLE + 1], |row| {
                Ok((row.get(0)?, row.get(1)?))
            }).map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();

            if col_rows.len() as i64 > MAX_EDITOR_COLUMNS_PER_TABLE {
                truncated_columns = true;
            }

            let columns = col_rows.into_iter().take(MAX_EDITOR_COLUMNS_PER_TABLE as usize)
                .map(|(col_name, data_type)| QueryEditorColumn {
                    name: col_name,
                    data_type,
                    comment: None,
                    is_nullable: None,
                    is_primary_key: None,
                })
                .collect();

            tables.push(QueryEditorTable {
                schema: "main".to_string(),
                name,
                columns,
                estimated_rows: None,
                comment: None,
            });
        }

        return Ok(QueryEditorMetadata {
            tables,
            functions: Vec::new(),
            enums: Vec::new(),
            truncated_tables,
            truncated_columns,
            truncated_functions: false,
        });
    }

    if engine == DatabaseEngine::Redis {
        let redis_commands = [
            "GET", "SET", "DEL", "EXISTS", "EXPIRE", "TTL", "KEYS", "SCAN", "TYPE",
            "HGET", "HSET", "HGETALL", "HDEL", "HEXISTS", "HKEYS", "HLEN",
            "LPUSH", "RPUSH", "LPOP", "RPOP", "LRANGE", "LLEN",
            "SADD", "SMEMBERS", "SREM", "SISMEMBER", "SCARD",
            "ZADD", "ZRANGE", "ZREM", "ZCARD", "ZSCORE",
            "PING", "INFO", "DBSIZE", "FLUSHDB"
        ];
        let functions = redis_commands.iter().map(|cmd| QueryEditorFunction {
            schema: "cmd".to_string(),
            name: cmd.to_string(),
            arg_types: vec![],
            return_type: "".to_string(),
        }).collect();
        return Ok(QueryEditorMetadata {
            tables: Vec::new(),
            functions,
            enums: Vec::new(),
            truncated_tables: false,
            truncated_columns: false,
            truncated_functions: false,
        });
    }

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
                    comment: None, is_nullable: None, is_primary_key: None,
                });
            }
            tables.push(QueryEditorTable {
                schema, name, columns,
                estimated_rows: None, comment: None,
            });
        }

        return Ok(QueryEditorMetadata {
            tables, functions: Vec::new(), enums: Vec::new(),
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
                    comment: None, is_nullable: None, is_primary_key: None,
                });
            }
            tables.push(QueryEditorTable {
                schema: "main".to_string(), name, columns,
                estimated_rows: None, comment: None,
            });
        }
        return Ok(QueryEditorMetadata {
            tables, functions: Vec::new(), enums: Vec::new(),
            truncated_tables, truncated_columns, truncated_functions: false,
        });
    }

    with_pool_client_retry(app, state, connection_id, (), |client, ()| async move {
        // Bound catalog work so Veloxy describe/search cannot hold a pool
        // client indefinitely on a large database.
        client
            .batch_execute(&format!("SET statement_timeout = '{}'", super::CATALOG_STATEMENT_TIMEOUT))
            .await
            .map_err(|error| map_pg_err(error, None))?;

        let catalog = async {
        // Tables with planner row estimates and comments, one round-trip.
        let table_rows = client.query(
            "select n.nspname::text as schema_name, c.relname::text as table_name, \
             greatest(c.reltuples, 0)::bigint as estimated_rows, \
             obj_description(c.oid, 'pg_class') as table_comment, \
             c.oid as table_oid \
             from pg_class c \
             join pg_namespace n on n.oid = c.relnamespace \
             where c.relkind in ('r', 'p', 'v', 'm', 'f') \
               and n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast') \
               and n.nspname not like 'pg_temp%' \
               and n.nspname not like 'pg_toast_temp%' \
             order by n.nspname, c.relname \
             limit $1",
            &[&(MAX_EDITOR_TABLES + 1)],
        ).await.map_err(|error| map_pg_err(error, None))?;

        let truncated_tables = table_rows.len() as i64 > MAX_EDITOR_TABLES;
        let table_rows = if truncated_tables {
            table_rows.into_iter().take(MAX_EDITOR_TABLES as usize).collect::<Vec<_>>()
        } else { table_rows };

        let table_oids: Vec<u32> = table_rows.iter().map(|row| row.get::<_, u32>(4)).collect();

        // Columns only for the listed tables (not the whole database).
        let mut truncated_columns = false;
        let mut columns_by_table: HashMap<(String, String), Vec<QueryEditorColumn>> = HashMap::new();
        if !table_oids.is_empty() {
            let column_rows = client.query(
                "select schema_name, table_name, column_name, data_type, col_comment, \
                        is_nullable, is_primary_key, rn from ( \
                   select n.nspname::text as schema_name, c.relname::text as table_name, \
                          a.attname::text as column_name, \
                          format_type(a.atttypid, a.atttypmod)::text as data_type, \
                          col_description(c.oid, a.attnum) as col_comment, \
                          (not a.attnotnull) as is_nullable, \
                          exists ( \
                            select 1 from pg_index i \
                            where i.indrelid = c.oid and i.indisprimary \
                              and a.attnum = any(i.indkey) \
                          ) as is_primary_key, \
                          row_number() over (partition by c.oid order by a.attnum) as rn \
                   from pg_attribute a \
                   join pg_class c on c.oid = a.attrelid \
                   join pg_namespace n on n.oid = c.relnamespace \
                   where c.oid = any($1::oid[]) \
                     and a.attnum > 0 and not a.attisdropped \
                 ) cols where rn <= $2 \
                 order by schema_name, table_name, rn",
                &[&table_oids, &(MAX_EDITOR_COLUMNS_PER_TABLE + 1)],
            ).await.map_err(|error| map_pg_err(error, None))?;

            for row in column_rows {
                let schema: String = row.get(0);
                let name: String = row.get(1);
                let rn: i64 = row.get(7);
                if rn > MAX_EDITOR_COLUMNS_PER_TABLE {
                    truncated_columns = true;
                    continue;
                }
                columns_by_table.entry((schema, name)).or_default().push(QueryEditorColumn {
                    name: row.get(2),
                    data_type: row.get(3),
                    comment: row.get::<_, Option<String>>(4),
                    is_nullable: Some(row.get(5)),
                    is_primary_key: Some(row.get(6)),
                });
            }
        }

        let tables = table_rows.into_iter().map(|row| {
            let schema: String = row.get(0);
            let name: String = row.get(1);
            let estimated_rows: i64 = row.get(2);
            let comment: Option<String> = row.get(3);
            let columns = columns_by_table.remove(&(schema.clone(), name.clone())).unwrap_or_default();
            QueryEditorTable {
                schema, name, columns,
                estimated_rows: Some(estimated_rows),
                comment,
            }
        }).collect::<Vec<_>>();

        let enum_rows = client.query(
            "select (n.nspname || '.' || t.typname)::text as name, \
             array_agg(e.enumlabel::text order by e.enumsortorder) as labels \
             from pg_type t \
             join pg_enum e on e.enumtypid = t.oid \
             join pg_namespace n on n.oid = t.typnamespace \
             group by n.nspname, t.typname \
             order by n.nspname, t.typname \
             limit $1",
            &[&MAX_EDITOR_ENUMS],
        ).await.map_err(|error| map_pg_err(error, None))?;

        let enums = enum_rows.into_iter().map(|row| QueryEditorEnum {
            name: row.get(0),
            values: row.get::<_, Vec<String>>(1),
        }).collect::<Vec<_>>();

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
            tables, functions, enums,
            truncated_tables, truncated_columns, truncated_functions,
        })
        };

        let result = catalog.await;
        let _ = client.batch_execute("SET statement_timeout = '0'").await;
        result
    }).await.map_err(String::from)
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

    if engine != DatabaseEngine::Postgres {
        return Ok(Vec::new());
    }

    with_pool_client_retry(app, state, connection_id, (), |client, ()| async move {
        client
            .batch_execute(&format!("SET statement_timeout = '{}'", super::CATALOG_STATEMENT_TIMEOUT))
            .await
            .map_err(|error| error.to_string())?;
        let result = async {
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
        }.await;
        let _ = client.batch_execute("SET statement_timeout = '0'").await;
        result
    }).await.map_err(String::from)
}

#[tauri::command]
pub async fn get_query_editor_metadata(
    app: AppHandle,
    state: State<'_, AppState>,
    connection_id: Option<String>,
) -> Result<QueryEditorMetadata, String> {
    let (connection_id, engine) = resolve_connection_engine(&app, &state, connection_id).await?;
    fetch_query_editor_metadata_for_connection(&app, &state, &connection_id, engine).await
}
