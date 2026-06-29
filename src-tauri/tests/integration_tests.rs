//! Baseline regression tests for VeloxDB refactor.
//!
//! These tests exercise the public library API that backs every Tauri command.
//! They guard against accidental behavior changes during the refactor.
//!
//! Engines covered:
//!   SQLite  – full round-trip (in-memory): connect → DDL → DML → query → schema → disconnect
//!   DuckDB  – full round-trip (in-memory): connect → DDL → DML → query → schema → disconnect
//!   PostgreSQL – connection builder, error formatting, identifier validation
//!   MySQL    – connection/URL builder, port defaults
//!   MongoDB  – connection string builder, port defaults
//!   Redis    – URL builder, port defaults

use std::collections::HashMap;

use sqlx::Column;
use sqlx::Row;
use veloxdb_lib::db::{
    build_duckdb_connection, build_mongo_connection_string, build_redis_url,
    build_sqlite_pool, is_retryable_connection_error, is_safe_identifier, mysql_url,
    quote_identifier, require_safe_identifier,
};
use veloxdb_lib::models::{
    ConnectionInput, ConnectionSslMode, DatabaseEngine, StoredConnection,
};
use veloxdb_lib::sql_split::split_sql_statements;

// ── Helper builders ────────────────────────────────────────────

fn sqlite_input_memory() -> ConnectionInput {
    ConnectionInput {
        id: Some("test-sqlite".into()),
        name: "test-sqlite".into(),
        engine: DatabaseEngine::Sqlite,
        host: String::new(),
        port: 0,
        database: String::new(),
        file_path: Some(":memory:".into()),
        user: String::new(),
        password: String::new(),
            srv_enabled: false,
        ssl_mode: ConnectionSslMode::Disable,
        ssh_config: None,
        extra_params: None,
    }
}

fn duckdb_input_memory() -> ConnectionInput {
    ConnectionInput {
        id: Some("test-duckdb".into()),
        name: "test-duckdb".into(),
        engine: DatabaseEngine::Duckdb,
        host: String::new(),
        port: 0,
        database: String::new(),
        file_path: Some(":memory:".into()),
        user: String::new(),
        password: String::new(),
            srv_enabled: false,
        ssl_mode: ConnectionSslMode::Disable,
        ssh_config: None,
        extra_params: None,
    }
}

fn mysql_input_default() -> ConnectionInput {
    ConnectionInput {
        id: None,
        name: "test-mysql".into(),
        engine: DatabaseEngine::Mysql,
        host: "db.example.com".into(),
        port: 3306,
        database: "app".into(),
        file_path: None,
        user: "root".into(),
        password: "secret".into(),
            srv_enabled: false,
        ssl_mode: ConnectionSslMode::Prefer,
        ssh_config: None,
        extra_params: None,
    }
}

fn postgres_input_default() -> ConnectionInput {
    ConnectionInput {
        id: None,
        name: "test-pg".into(),
        engine: DatabaseEngine::Postgres,
        host: "pg.example.com".into(),
        port: 5432,
        database: "app".into(),
        file_path: None,
        user: "postgres".into(),
        password: "secret".into(),
            srv_enabled: false,
        ssl_mode: ConnectionSslMode::Prefer,
        ssh_config: None,
        extra_params: None,
    }
}

fn mongo_input_default() -> ConnectionInput {
    ConnectionInput {
        id: None,
        name: "test-mongo".into(),
        engine: DatabaseEngine::Mongo,
        host: "mongo.example.com".into(),
        port: 27017,
        database: "admin".into(),
        file_path: None,
        user: "admin".into(),
        password: "secret".into(),
            srv_enabled: false,
        ssl_mode: ConnectionSslMode::Disable,
        ssh_config: None,
        extra_params: None,
    }
}

fn redis_input_default() -> ConnectionInput {
    ConnectionInput {
        id: None,
        name: "test-redis".into(),
        engine: DatabaseEngine::Redis,
        host: "redis.example.com".into(),
        port: 6379,
        database: "0".into(),
        file_path: None,
        user: String::new(),
        password: String::new(),
            srv_enabled: false,
        ssl_mode: ConnectionSslMode::Disable,
        ssh_config: None,
        extra_params: None,
    }
}

// ── SQLite full round-trip ─────────────────────────────────────

#[tokio::test]
async fn sqlite_connect_query_schema_disconnect() {
    let input = sqlite_input_memory();
    let pool = build_sqlite_pool(&input)
        .await
        .expect("SQLite pool should build");

    // DDL
    let mut conn = pool.acquire().await.expect("acquire connection");
    sqlx::query("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, age INTEGER)")
        .execute(&mut *conn)
        .await
        .expect("create table");

    // DML (insert)
    let result = sqlx::query("INSERT INTO users (name, age) VALUES ('Alice', 30)")
        .execute(&mut *conn)
        .await
        .expect("insert");
    assert_eq!(result.rows_affected(), 1);

    // Insert another
    sqlx::query("INSERT INTO users (name, age) VALUES ('Bob', 25)")
        .execute(&mut *conn)
        .await
        .expect("insert bob");

    // SELECT
    let rows = sqlx::query("SELECT id, name, age FROM users ORDER BY id")
        .fetch_all(&mut *conn)
        .await
        .expect("select");
    assert_eq!(rows.len(), 2);

    // Verify column names and values
    let col_names: Vec<String> = rows[0]
        .columns()
        .iter()
        .map(|c| c.name().to_string())
        .collect();
    assert_eq!(col_names, vec!["id", "name", "age"]);

    let name_a: String = rows[0].try_get("name").expect("get name");
    let age_a: i64 = rows[0].try_get("age").expect("get age");
    assert_eq!(name_a, "Alice");
    assert_eq!(age_a, 30);

    let name_b: String = rows[1].try_get("name").expect("get name");
    let age_b: i64 = rows[1].try_get("age").expect("get age");
    assert_eq!(name_b, "Bob");
    assert_eq!(age_b, 25);

    // Schema inspection — list tables
    let tables = sqlx::query(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .fetch_all(&mut *conn)
    .await
    .expect("list tables");
    let table_names: Vec<String> = tables
        .iter()
        .map(|r| r.try_get::<String, _>("name").unwrap())
        .collect();
    assert!(table_names.contains(&"users".to_string()));

    // Schema inspection — PRAGMA table_info
    let columns = sqlx::query("PRAGMA table_info('users')")
        .fetch_all(&mut *conn)
        .await
        .expect("pragma");
    assert_eq!(columns.len(), 3);
    let col0: String = columns[0].try_get("name").expect("col0 name");
    assert_eq!(col0, "id");

    drop(conn);
}

#[tokio::test]
async fn sqlite_empty_result_set() {
    let input = sqlite_input_memory();
    let pool = build_sqlite_pool(&input).await.expect("pool");
    let mut conn = pool.acquire().await.expect("acquire");

    sqlx::query("CREATE TABLE t (x INTEGER)")
        .execute(&mut *conn)
        .await
        .expect("create");

    let rows = sqlx::query("SELECT * FROM t WHERE x > 999")
        .fetch_all(&mut *conn)
        .await
        .expect("select");
    assert!(rows.is_empty());

    drop(conn);
}

#[tokio::test]
async fn sqlite_nullable_columns() {
    let input = sqlite_input_memory();
    let pool = build_sqlite_pool(&input).await.expect("pool");
    let mut conn = pool.acquire().await.expect("acquire");

    sqlx::query("CREATE TABLE t (id INTEGER, maybe TEXT)")
        .execute(&mut *conn)
        .await
        .expect("create");

    sqlx::query("INSERT INTO t (id) VALUES (1)")
        .execute(&mut *conn)
        .await
        .expect("insert");

    let rows = sqlx::query("SELECT * FROM t")
        .fetch_all(&mut *conn)
        .await
        .expect("select");

    let id: i64 = rows[0].try_get("id").expect("id");
    let maybe: Option<String> = rows[0].try_get("maybe").expect("maybe");
    assert_eq!(id, 1);
    assert!(maybe.is_none());

    drop(conn);
}

#[tokio::test]
async fn sqlite_multiple_statements_within_tx() {
    let input = sqlite_input_memory();
    let pool = build_sqlite_pool(&input).await.expect("pool");
    let mut conn = pool.acquire().await.expect("acquire");

    sqlx::query(
        "CREATE TABLE a (x INTEGER); CREATE TABLE b (y TEXT);",
    )
    .execute(&mut *conn)
    .await
    .expect("multi-ddl");

    let tables = sqlx::query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .fetch_all(&mut *conn)
    .await
    .expect("list");
    let names: Vec<String> = tables.iter().map(|r| r.try_get("name").unwrap()).collect();
    assert!(names.contains(&"a".to_string()));
    assert!(names.contains(&"b".to_string()));

    drop(conn);
}

// ── DuckDB full round-trip ─────────────────────────────────────

#[test]
fn duckdb_connect_query_schema() {
    let input = duckdb_input_memory();
    let conn = build_duckdb_connection(&input).expect("DuckDB connect");

    // DDL — DuckDB does not auto-increment INTEGER PRIMARY KEY; use explicit IDs
    conn.execute_batch(
        "CREATE TABLE products (id INTEGER PRIMARY KEY, name VARCHAR, price DOUBLE)",
    )
    .expect("create table");

    // DML — provide explicit IDs
    let inserted = conn
        .execute(
            "INSERT INTO products (id, name, price) VALUES (1, 'Widget', 9.99), (2, 'Gadget', 19.50)",
            [],
        )
        .expect("insert");
    assert_eq!(inserted, 2);

    // SELECT
    let mut stmt = conn
        .prepare("SELECT id, name, price FROM products ORDER BY id")
        .expect("prepare");
    let rows: Vec<(i32, String, f64)> = stmt
        .query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })
        .expect("query")
        .filter_map(|r| r.ok())
        .collect();

    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].1, "Widget");
    assert_eq!(rows[0].2, 9.99);
    assert_eq!(rows[1].1, "Gadget");
    assert_eq!(rows[1].2, 19.50);

    // Schema — list tables
    let mut stmt = conn
        .prepare("SELECT table_name FROM information_schema.tables WHERE table_schema='main' ORDER BY table_name")
        .expect("list tables");
    let table_names: Vec<String> = stmt
        .query_map([], |row| row.get(0))
        .expect("query")
        .filter_map(|r| r.ok())
        .collect();
    assert!(table_names.contains(&"products".to_string()));

    // Schema — describe columns
    let mut stmt = conn
        .prepare("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='products' ORDER BY ordinal_position")
        .expect("list columns");
    let cols: Vec<(String, String)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .expect("query")
        .filter_map(|r| r.ok())
        .collect();
    assert_eq!(cols.len(), 3);
    assert_eq!(cols[0].0, "id");
    assert_eq!(cols[1].0, "name");
    assert_eq!(cols[2].0, "price");
}

#[test]
fn duckdb_empty_table() {
    let input = duckdb_input_memory();
    let conn = build_duckdb_connection(&input).expect("connect");

    conn.execute_batch("CREATE TABLE e (x INTEGER)")
        .expect("create");

    let mut stmt = conn.prepare("SELECT * FROM e").expect("prepare");
    let rows: Vec<i32> = stmt
        .query_map([], |row| row.get(0))
        .expect("query")
        .filter_map(|r| r.ok())
        .collect();
    assert!(rows.is_empty());
}

#[test]
fn duckdb_type_preservation() {
    let input = duckdb_input_memory();
    let conn = build_duckdb_connection(&input).expect("connect");

    conn.execute_batch(
        "CREATE TABLE types (i BIGINT, f DOUBLE, s VARCHAR)",
    )
    .expect("create");

    conn.execute(
        "INSERT INTO types VALUES (42, 3.14, 'hello')",
        [],
    )
    .expect("insert");

    // DuckDB uses its own timestamp type; verify core types only
    let mut stmt = conn.prepare("SELECT i, f, s FROM types").expect("prepare");
    let row: (i64, f64, String) = stmt
        .query_row([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .expect("query");

    assert_eq!(row.0, 42);
    #[allow(clippy::approx_constant)]
    {
        assert!((row.1 - 3.14).abs() < 0.001);
    }
    assert_eq!(row.2, "hello");

    // Verify boolean handling works (0/1 integer equivalent)
    conn.execute_batch("CREATE TABLE flags (active INTEGER)")
        .expect("create flags");
    conn.execute("INSERT INTO flags VALUES (1)", [])
        .expect("insert flag");

    let mut stmt = conn.prepare("SELECT active FROM flags").expect("prepare flags");
    let active: i32 = stmt
        .query_row([], |row| row.get(0))
        .expect("query flag");
    assert_eq!(active, 1);
}

// ── PostgreSQL — connection builder / error formatting ────────

/// Pool creation is lazy — the pool object is created without connecting.
/// This test verifies the config is accepted and a pool is returned.
#[test]
fn postgres_build_pool_creates_lazy_pool() {
    let input = ConnectionInput {
            srv_enabled: false,
        ssl_mode: ConnectionSslMode::Disable,
        ..postgres_input_default()
    };
    // Pool creation should succeed (lazy — no connection attempted yet)
    let pool = veloxdb_lib::db::build_pool(&input)
        .expect("Pool creation with Disable SSL should succeed");
    // Verify we can close it without errors
    pool.close();
}

#[test]
fn postgres_build_pool_prefer_ssl() {
    let input = ConnectionInput {
            srv_enabled: false,
        ssl_mode: ConnectionSslMode::Prefer,
        ..postgres_input_default()
    };
    let pool = veloxdb_lib::db::build_pool(&input)
        .expect("Pool creation with Prefer SSL should succeed");
    pool.close();
}

#[test]
fn postgres_build_pool_require_ssl() {
    let input = ConnectionInput {
            srv_enabled: false,
        ssl_mode: ConnectionSslMode::Require,
        ..postgres_input_default()
    };
    let pool = veloxdb_lib::db::build_pool(&input)
        .expect("Pool creation with Require SSL should succeed");
    pool.close();
}

#[test]
fn postgres_tls_connector_is_cached() {
    // Verify the OnceLock TLS connector works repeatedly
    let input = ConnectionInput {
            srv_enabled: false,
        ssl_mode: ConnectionSslMode::Prefer,
        ..postgres_input_default()
    };

    let pool1 = veloxdb_lib::db::build_pool(&input).expect("first pool");
    let pool2 = veloxdb_lib::db::build_pool(&input).expect("second pool");

    // Both should produce valid pool objects (TLS connector is cached via OnceLock)
    pool1.close();
    pool2.close();
}

// ── MySQL — URL builder / port defaults ───────────────────────

#[test]
fn mysql_url_includes_ssl_mode() {
    let input = mysql_input_default();
    let url = mysql_url(&input.host, input.port, &input);
    assert!(url.starts_with("mysql://"));
    assert!(url.contains("@db.example.com:3306/app"));
    assert!(url.contains("ssl-mode=PREFERRED"));
}

#[test]
fn mysql_url_disable_ssl() {
    let input = ConnectionInput {
            srv_enabled: false,
        ssl_mode: ConnectionSslMode::Disable,
        ..mysql_input_default()
    };
    let url = mysql_url(&input.host, input.port, &input);
    assert!(url.ends_with("ssl-mode=DISABLED"));
}

#[test]
fn mysql_url_require_ssl() {
    let input = ConnectionInput {
            srv_enabled: false,
        ssl_mode: ConnectionSslMode::Require,
        ..mysql_input_default()
    };
    let url = mysql_url(&input.host, input.port, &input);
    assert!(url.ends_with("ssl-mode=REQUIRED"));
}

#[test]
fn mysql_url_encodes_special_chars() {
    let input = ConnectionInput {
        host: "db.example.com".into(),
        port: 3306,
        database: "my-app".into(),
        user: "user@domain".into(),
        password: "p@ss:word".into(),
        ..mysql_input_default()
    };
    let url = mysql_url(&input.host, input.port, &input);
    // Should be URL-encoded, not raw special chars
    assert!(url.contains("%40")); // @ encoded
    assert!(!url.contains("p@ss"));
}

// ── MongoDB — connection string builder ────────────────────────

#[test]
fn mongo_connection_string_no_auth() {
    let input = ConnectionInput {
        user: String::new(),
        password: String::new(),
        ..mongo_input_default()
    };
    let uri = build_mongo_connection_string(&input);
    assert_eq!(uri, "mongodb://mongo.example.com:27017/admin");
}

#[test]
fn mongo_connection_string_with_auth() {
    let input = mongo_input_default();
    let uri = build_mongo_connection_string(&input);
    assert!(uri.starts_with("mongodb://"));
    assert!(uri.contains("admin:secret@mongo.example.com:27017/admin"));
}

#[test]
fn mongo_connection_string_defaults() {
    let input = ConnectionInput {
        host: String::new(),
        port: 0,
        database: String::new(),
        user: String::new(),
        password: String::new(),
        ..mongo_input_default()
    };
    let uri = build_mongo_connection_string(&input);
    assert_eq!(uri, "mongodb://localhost:27017/admin");
}

#[test]
fn mongo_connection_string_with_extra_params() {
    let mut params = HashMap::new();
    params.insert("replicaSet".to_string(), "rs0".to_string());
    params.insert("authSource".to_string(), "admin".to_string());
    let input = ConnectionInput {
        extra_params: Some(params),
        ..mongo_input_default()
    };
    let uri = build_mongo_connection_string(&input);
    assert!(uri.contains("?"));
    assert!(uri.contains("replicaSet=rs0"));
    assert!(uri.contains("authSource=admin"));
}

#[test]
fn mongo_connection_string_custom_port() {
    let input = ConnectionInput {
        port: 27018,
        ..mongo_input_default()
    };
    let uri = build_mongo_connection_string(&input);
    assert!(uri.contains(":27018/"));
}

// ── Redis — URL builder ────────────────────────────────────────

#[test]
fn redis_url_no_auth() {
    let input = redis_input_default();
    let url = build_redis_url(&input);
    assert_eq!(url, "redis://redis.example.com:6379");
}

#[test]
fn redis_url_with_auth() {
    let input = ConnectionInput {
        user: "default".into(),
        password: "secret".into(),
        ..redis_input_default()
    };
    let url = build_redis_url(&input);
    assert_eq!(url, "redis://default:secret@redis.example.com:6379");
}

#[test]
fn redis_url_defaults_to_localhost() {
    let input = ConnectionInput {
        host: String::new(),
        port: 0,
        ..redis_input_default()
    };
    let url = build_redis_url(&input);
    assert_eq!(url, "redis://127.0.0.1:6379");
}

// ── Identifier safety ──────────────────────────────────────────

#[test]
fn accepts_valid_identifiers() {
    assert!(is_safe_identifier("users"));
    assert!(is_safe_identifier("_internal"));
    assert!(is_safe_identifier("Table123"));
    assert!(is_safe_identifier("a"));
    assert!(is_safe_identifier("snake_case_name"));
    assert_eq!(require_safe_identifier("users", "table"), Ok("users"));
}

#[test]
fn rejects_sql_injection_identifiers() {
    assert!(!is_safe_identifier("\"; DROP TABLE users; --"));
    assert!(!is_safe_identifier("foo; DELETE FROM bar"));
    assert!(!is_safe_identifier("a\0b"));
    assert!(!is_safe_identifier(""));
    assert!(!is_safe_identifier("foo bar"));
    assert!(!is_safe_identifier("table-name"));
    assert!(require_safe_identifier("foo);", "table name").is_err());
    assert!(require_safe_identifier("", "column name").is_err());
}

#[test]
fn rejects_overly_long_identifiers() {
    let long = "a".repeat(129);
    assert!(!is_safe_identifier(&long));
}

#[test]
fn quote_identifier_escapes_double_quotes() {
    assert_eq!(quote_identifier("hello"), "hello");
    assert_eq!(quote_identifier("it\"s"), "it\"\"s");
    assert_eq!(quote_identifier("\"\""), "\"\"\"\"");
    assert_eq!(quote_identifier("normal_name"), "normal_name");
}

// ── SQL statement splitting ────────────────────────────────────

#[test]
fn splits_simple_statements() {
    let parts = split_sql_statements("select 1; select 2;");
    assert_eq!(parts, vec!["select 1", "select 2"]);
}

#[test]
fn splits_trailing_semicolon() {
    let parts = split_sql_statements("select 1;");
    assert_eq!(parts, vec!["select 1"]);
}

#[test]
fn ignores_semicolons_in_single_quoted_strings() {
    let parts = split_sql_statements("select 'a;b'; select 'c';");
    assert_eq!(parts, vec!["select 'a;b'", "select 'c'"]);
}

#[test]
fn ignores_semicolons_in_double_quoted_strings() {
    let parts = split_sql_statements(r#"select "a;b"; select "c";"#);
    assert_eq!(parts, vec![r#"select "a;b""#, r#"select "c""#]);
}

#[test]
fn ignores_semicolons_in_block_comments() {
    let parts = split_sql_statements("select 1 /* this; is; a; comment */; select 2;");
    assert_eq!(parts, vec!["select 1 /* this; is; a; comment */", "select 2"]);
}

#[test]
fn ignores_semicolons_in_line_comments() {
    let parts = split_sql_statements("select 1 -- ; still comment\n; select 2;");
    // line comment absorbs the first ';' and 'still comment' up to \n,
    // then the ';' after \n splits, producing two statements
    assert_eq!(parts.len(), 2);
    assert!(parts[0].contains("select 1"));
    assert!(parts[0].contains("--"));
    assert_eq!(parts[1], "select 2");
}

#[test]
fn handles_escaped_quotes() {
    let parts = split_sql_statements("select 'it''s'; select 2;");
    assert_eq!(parts, vec!["select 'it''s'", "select 2"]);
}

#[test]
fn handles_escaped_double_quotes() {
    let parts = split_sql_statements(r#"select "it""s"; select 2;"#);
    assert_eq!(parts, vec![r#"select "it""s""#, "select 2"]);
}

#[test]
fn handles_dollar_quoting() {
    let parts = split_sql_statements("select $$hello; world$$; select 2;");
    assert_eq!(parts, vec!["select $$hello; world$$", "select 2"]);
}

#[test]
fn handles_named_dollar_quoting() {
    let parts = split_sql_statements("select $tag$hello; world$tag$; select 2;");
    assert_eq!(parts, vec!["select $tag$hello; world$tag$", "select 2"]);
}

#[test]
fn handles_nested_block_comments() {
    let parts = split_sql_statements(
        "select 1 /* outer /* inner */ still comment */; select 2;",
    );
    assert_eq!(parts.len(), 2);
    assert!(parts[0].contains("select 1"));
    assert!(parts[1].contains("select 2"));
}

#[test]
fn handles_empty_input() {
    let parts = split_sql_statements("");
    assert!(parts.is_empty());
}

#[test]
fn handles_whitespace_only() {
    let parts = split_sql_statements("   \n  \t  ");
    assert!(parts.is_empty());
}

#[test]
fn single_statement_no_semicolon() {
    let parts = split_sql_statements("select 1");
    assert_eq!(parts, vec!["select 1"]);
}

// ── Model type conversions ─────────────────────────────────────

#[test]
fn connection_input_to_stored_connection() {
    let input = postgres_input_default();
    let stored = StoredConnection::from_input("conn-1".into(), input.clone());

    assert_eq!(stored.id, "conn-1");
    assert_eq!(stored.name, "test-pg");
    assert_eq!(stored.engine, DatabaseEngine::Postgres);
    assert_eq!(stored.host, "pg.example.com");
    assert_eq!(stored.port, 5432);
    assert_eq!(stored.database, "app");
    assert_eq!(stored.user, "postgres");
    assert!(stored.password.is_none()); // password stripped in from_input
    assert!(stored.connected_at.parse::<u64>().is_ok());
}

#[test]
fn stored_connection_to_summary() {
    let input = postgres_input_default();
    let stored = StoredConnection::from_input("conn-1".into(), input);
    let summary = stored.summary();

    assert_eq!(summary.id, "conn-1");
    assert_eq!(summary.name, "test-pg");
    assert_eq!(summary.engine, DatabaseEngine::Postgres);
    assert!(summary.table_property_editing_supported);
}

#[test]
fn stored_connection_to_input_roundtrip() {
    let input = postgres_input_default();
    let stored = StoredConnection::from_input("conn-1".into(), input.clone());
    let roundtripped = stored.to_input();

    assert_eq!(roundtripped.id, Some("conn-1".into()));
    assert_eq!(roundtripped.host, input.host);
    assert_eq!(roundtripped.port, input.port);
    assert_eq!(roundtripped.engine, input.engine);
}

#[test]
fn table_property_editing_only_for_postgres() {
    let pg = StoredConnection::from_input("pg".into(), postgres_input_default());
    let mysql = StoredConnection::from_input("my".into(), mysql_input_default());
    let sqlite = StoredConnection::from_input("sl".into(), sqlite_input_memory());
    let mongo = StoredConnection::from_input("mg".into(), mongo_input_default());

    assert!(pg.summary().table_property_editing_supported);
    assert!(!mysql.summary().table_property_editing_supported);
    assert!(!sqlite.summary().table_property_editing_supported);
    assert!(!mongo.summary().table_property_editing_supported);
}

// ── DatabaseEngine enum variants ────────────────────────────────

#[test]
fn database_engine_default_is_postgres() {
    let engine = DatabaseEngine::default();
    assert_eq!(engine, DatabaseEngine::Postgres);
}

#[test]
fn database_engine_all_variants_exist() {
    // Verify each variant can be constructed and compared
    let engines = vec![
        DatabaseEngine::Postgres,
        DatabaseEngine::Mysql,
        DatabaseEngine::Sqlite,
        DatabaseEngine::Mongo,
        DatabaseEngine::Duckdb,
        DatabaseEngine::Redis,
    ];
    assert_eq!(engines.len(), 6);
    for engine in &engines {
        assert_eq!(engine, engine);
    }
}

// ── ConnectionSslMode enum ─────────────────────────────────────

#[test]
fn ssl_mode_default_is_prefer() {
    assert_eq!(ConnectionSslMode::default(), ConnectionSslMode::Prefer);
}

#[test]
fn ssl_mode_all_variants() {
    let modes = [
        ConnectionSslMode::Disable,
        ConnectionSslMode::Prefer,
        ConnectionSslMode::Require,
    ];
    assert_eq!(modes.len(), 3);
}

// ── Retryable error classification ─────────────────────────────

#[test]
fn classifies_broken_pipe_as_retryable() {
    assert!(is_retryable_connection_error("Broken pipe (os error 32)"));
    assert!(is_retryable_connection_error("broken PIPE"));
}

#[test]
fn classifies_connection_reset_as_retryable() {
    assert!(is_retryable_connection_error("Connection reset by peer"));
    assert!(is_retryable_connection_error("connection RESET"));
}

#[test]
fn classifies_connection_refused_as_retryable() {
    assert!(is_retryable_connection_error("Connection refused"));
}

#[test]
fn classifies_eof_as_retryable() {
    assert!(is_retryable_connection_error("unexpected EOF"));
    assert!(is_retryable_connection_error("EOF has been reached"));
    assert!(is_retryable_connection_error("unexpected end of file"));
}

#[test]
fn classifies_server_closed_as_retryable() {
    assert!(is_retryable_connection_error("server closed the connection"));
    assert!(is_retryable_connection_error("connection closed"));
    assert!(is_retryable_connection_error("closed the connection unexpectedly"));
}

#[test]
fn classifies_communication_error_as_retryable() {
    assert!(is_retryable_connection_error(
        "error communicating with the server"
    ));
    assert!(is_retryable_connection_error("could not receive data from server"));
    assert!(is_retryable_connection_error("could not send data to server"));
}

#[test]
fn classifies_timeout_as_retryable() {
    assert!(is_retryable_connection_error(
        "timeout occurred while waiting"
    ));
    assert!(is_retryable_connection_error(
        "timeout occurred while creating"
    ));
    assert!(is_retryable_connection_error(
        "timeout occurred while recycling"
    ));
}

#[test]
fn does_not_classify_syntax_error_as_retryable() {
    assert!(!is_retryable_connection_error("syntax error at or near SELECT"));
    assert!(!is_retryable_connection_error("column does not exist"));
    assert!(!is_retryable_connection_error("permission denied"));
}

#[test]
fn retryable_error_is_case_insensitive() {
    assert!(is_retryable_connection_error("BROKEN PIPE"));
    assert!(is_retryable_connection_error("Connection Refused"));
    assert!(is_retryable_connection_error("Unexpected EOF"));
}

// ── SSH config validation ──────────────────────────────────────

#[test]
fn ssh_config_inactive_when_disabled() {
    let config = veloxdb_lib::models::SshConfig {
        enabled: false,
        host: "jump.example.com".into(),
        port: 22,
        user: "deploy".into(),
        auth_method: veloxdb_lib::models::SshAuthMethod::KeyFile,
        password: None,
        private_key_path: Some("~/.ssh/id_rsa".into()),
        passphrase: None,
    };
    assert!(!config.is_active());
}

#[test]
fn ssh_config_inactive_when_host_empty() {
    let config = veloxdb_lib::models::SshConfig {
        enabled: true,
        host: String::new(),
        port: 22,
        user: "deploy".into(),
        auth_method: veloxdb_lib::models::SshAuthMethod::KeyFile,
        password: None,
        private_key_path: None,
        passphrase: None,
    };
    assert!(!config.is_active());
}

#[test]
fn ssh_config_active_with_key_file() {
    let config = veloxdb_lib::models::SshConfig {
        enabled: true,
        host: "jump.example.com".into(),
        port: 22,
        user: "deploy".into(),
        auth_method: veloxdb_lib::models::SshAuthMethod::KeyFile,
        password: None,
        private_key_path: None,
        passphrase: None,
    };
    assert!(config.is_active());
}

#[test]
fn ssh_config_active_with_password() {
    let config = veloxdb_lib::models::SshConfig {
        enabled: true,
        host: "jump.example.com".into(),
        port: 22,
        user: "deploy".into(),
        auth_method: veloxdb_lib::models::SshAuthMethod::Password,
        password: Some("secret".into()),
        private_key_path: None,
        passphrase: None,
    };
    assert!(config.is_active());
}

#[test]
fn ssh_config_inactive_without_password_when_password_method() {
    let config = veloxdb_lib::models::SshConfig {
        enabled: true,
        host: "jump.example.com".into(),
        port: 22,
        user: "deploy".into(),
        auth_method: veloxdb_lib::models::SshAuthMethod::Password,
        password: None,
        private_key_path: None,
        passphrase: None,
    };
    assert!(!config.is_active());
}

// ── max_query_rows constant ────────────────────────────────────

#[test]
fn max_query_rows_is_positive() {
    const _: () = assert!(veloxdb_lib::db::MAX_QUERY_ROWS > 0);
}

// ── Default port constants ─────────────────────────────────────

#[test]
fn default_port_constants_are_correct() {
    assert_eq!(veloxdb_lib::db::DEFAULT_MYSQL_PORT, 3306);
    assert_eq!(veloxdb_lib::db::DEFAULT_MONGO_PORT, 27017);
    assert_eq!(veloxdb_lib::db::DEFAULT_REDIS_PORT, 6379);
}
