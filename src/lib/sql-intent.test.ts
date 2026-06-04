import { describe, expect, it } from "vitest";

import { classifySqlIntent, isReadOnlySql } from "@/lib/sql-intent";

describe("classifySqlIntent", () => {
	it("recognizes statement kinds", () => {
		expect(classifySqlIntent("SELECT 1")).toBe("select");
		expect(classifySqlIntent("with x as (select 1) select * from x")).toBe("select");
		expect(classifySqlIntent("INSERT INTO t VALUES (1)")).toBe("insert");
		expect(classifySqlIntent("UPDATE t SET a = 1")).toBe("update");
		expect(classifySqlIntent("DELETE FROM t")).toBe("delete");
		expect(classifySqlIntent("EXPLAIN SELECT 1")).toBe("explain");
		expect(classifySqlIntent("DROP TABLE t")).toBe("unknown");
	});
});

describe("isReadOnlySql", () => {
	it("treats selects and explain as read-only", () => {
		expect(isReadOnlySql("SELECT 1")).toBe(true);
		expect(isReadOnlySql("EXPLAIN ANALYZE SELECT * FROM t")).toBe(true);
		expect(isReadOnlySql("BEGIN; SELECT 1; COMMIT;")).toBe(true);
	});

	it("flags writes as not read-only", () => {
		expect(isReadOnlySql("DELETE FROM t")).toBe(false);
		expect(isReadOnlySql("DROP TABLE t")).toBe(false);
		expect(isReadOnlySql("BEGIN; UPDATE t SET a = 1; COMMIT;")).toBe(false);
		expect(isReadOnlySql("SELECT 1; DELETE FROM t")).toBe(false);
		expect(isReadOnlySql("")).toBe(false);
	});
});
