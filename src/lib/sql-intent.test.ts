import { describe, expect, it } from "vitest";

import { classifySqlIntent, isReadOnlyRedisCommand, isReadOnlySql } from "@/lib/sql-intent";

describe("classifySqlIntent", () => {
	it("recognizes statement kinds", () => {
		expect(classifySqlIntent("SELECT 1")).toBe("select");
		expect(classifySqlIntent("with x as (select 1) select * from x")).toBe("select");
		expect(classifySqlIntent("INSERT INTO t VALUES (1)")).toBe("insert");
		expect(classifySqlIntent("UPDATE t SET a = 1")).toBe("update");
		expect(classifySqlIntent("DELETE FROM t")).toBe("delete");
		expect(classifySqlIntent("EXPLAIN SELECT 1")).toBe("explain");
		expect(classifySqlIntent("SHOW TABLES")).toBe("show");
		expect(classifySqlIntent("DESCRIBE users")).toBe("describe");
		expect(classifySqlIntent("VALUES (1)")).toBe("values");
		expect(classifySqlIntent("TABLE users")).toBe("table");
		expect(classifySqlIntent("DROP TABLE t")).toBe("unknown");
	});
});

describe("isReadOnlySql", () => {
	it("treats selects and explain as read-only", () => {
		expect(isReadOnlySql("SELECT 1")).toBe(true);
		expect(isReadOnlySql("EXPLAIN ANALYZE SELECT * FROM t")).toBe(true);
		expect(isReadOnlySql("SELECT created_at, last_update FROM orders")).toBe(true);
		expect(isReadOnlySql("SHOW TABLES")).toBe(true);
		expect(isReadOnlySql("DESCRIBE users")).toBe(true);
		expect(isReadOnlySql("VALUES (1)")).toBe(true);
		expect(isReadOnlySql("TABLE users")).toBe(true);
	});

	it("flags writes as not read-only", () => {
		expect(isReadOnlySql("DELETE FROM t")).toBe(false);
		expect(isReadOnlySql("DROP TABLE t")).toBe(false);
		expect(isReadOnlySql("BEGIN; UPDATE t SET a = 1; COMMIT;")).toBe(false);
		expect(isReadOnlySql("SELECT 1; DELETE FROM t")).toBe(false);
		expect(isReadOnlySql("EXPLAIN ANALYZE DELETE FROM t")).toBe(false);
		expect(isReadOnlySql("")).toBe(false);
	});

	it("rejects writes hidden after a select", () => {
		// T-SQL runs both statements of a batch with no semicolon between them.
		expect(isReadOnlySql("SELECT 1 DELETE FROM users", "mssql")).toBe(false);
		expect(isReadOnlySql("SELECT * FROM users WHERE id = 1\nDROP TABLE users", "mssql")).toBe(false);
		expect(isReadOnlySql("SELECT 1 EXEC sp_executesql N'x'", "mssql")).toBe(false);
		expect(isReadOnlySql("SELECT * INTO users_copy FROM users", "postgres")).toBe(false);
		expect(isReadOnlySql("SELECT * FROM users INTO OUTFILE '/tmp/users'", "mysql")).toBe(false);
		expect(isReadOnlySql("TABLE users; TRUNCATE users")).toBe(false);
	});

	it("rejects functions with side effects", () => {
		expect(
			isReadOnlySql("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE pid <> pg_backend_pid()"),
		).toBe(false);
		expect(isReadOnlySql("SELECT lo_export(lo_from_bytea(0, 'x'), '/tmp/x')")).toBe(false);
		expect(isReadOnlySql("SELECT set_config('default_transaction_read_only', 'off', false)")).toBe(false);
		expect(isReadOnlySql("SELECT nextval('orders_id_seq')")).toBe(false);
	});

	it("treats transaction control as a write", () => {
		expect(isReadOnlySql("BEGIN; SELECT 1; COMMIT;")).toBe(false);
		expect(isReadOnlySql("COMMIT; SELECT archive_orders()")).toBe(false);
		expect(isReadOnlySql("START TRANSACTION READ WRITE")).toBe(false);
	});

	it("flags data-modifying CTEs as writes", () => {
		expect(isReadOnlySql("WITH x AS (SELECT 1) SELECT * FROM x")).toBe(true);
		expect(
			isReadOnlySql("WITH moved AS (DELETE FROM t RETURNING *) SELECT * FROM moved"),
		).toBe(false);
		expect(
			isReadOnlySql("with x as (insert into t values (1) returning *) select * from x"),
		).toBe(false);
	});

	it("treats only read-only Redis commands as read-only", () => {
		expect(isReadOnlyRedisCommand("GET user:1")).toBe(true);
		expect(isReadOnlyRedisCommand("HGETALL user:1")).toBe(true);
		expect(isReadOnlyRedisCommand("GET user:1\nTTL user:1")).toBe(true);
		expect(isReadOnlyRedisCommand("SET user:1 bob")).toBe(false);
		expect(isReadOnlyRedisCommand("DEL user:1")).toBe(false);
		expect(isReadOnlyRedisCommand("FLUSHALL")).toBe(false);
		expect(isReadOnlyRedisCommand("")).toBe(false);
		expect(isReadOnlySql("GET user:1", "redis")).toBe(true);
		expect(isReadOnlySql("SET user:1 bob", "redis")).toBe(false);
		expect(isReadOnlySql("DEL user:1", "redis")).toBe(false);
	});

	it("treats all MongoDB queries as read-only", () => {
		expect(isReadOnlySql("db.users.find({})", "mongo")).toBe(true);
		expect(isReadOnlySql('{"status": "active"}', "mongo")).toBe(true);
		expect(isReadOnlySql("", "mongo")).toBe(true);
		expect(isReadOnlySql("DELETE FROM t", "mongo")).toBe(true);
	});

	it("still blocks writes for non-mongo engines", () => {
		expect(isReadOnlySql("DELETE FROM t", "postgres")).toBe(false);
		expect(isReadOnlySql("UPDATE t SET a = 1", "mysql")).toBe(false);
		expect(isReadOnlySql("DELETE FROM t", "sqlite")).toBe(false);
	});

	it("engine parameter is optional (backward compat)", () => {
		expect(isReadOnlySql("SELECT 1")).toBe(true);
		expect(isReadOnlySql("DELETE FROM t")).toBe(false);
	});
});
