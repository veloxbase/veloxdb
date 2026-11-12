import { describe, expect, it } from "vitest";

import {
	extractSqlFences,
	extractSqlFromParts,
	latestSqlFromParts,
} from "@/features/queries/veloxy/sql-preview";

describe("extractSqlFences", () => {
	it("extracts completed sql fences", () => {
		expect(
			extractSqlFences("Here:\n```sql\nSELECT 1;\n```\nand more"),
		).toEqual(["SELECT 1;"]);
	});

	it("ignores a half-open fence", () => {
		expect(extractSqlFences("```sql\nSELECT 1;")).toEqual([]);
	});
});

describe("extractSqlFromParts", () => {
	it("reads sql from run_readonly tool input", () => {
		const sql = extractSqlFromParts([
			{
				type: "tool-call",
				id: "1",
				name: "run_readonly",
				arguments: '{"sql":"SELECT * FROM orders LIMIT 5"}',
				input: { sql: "SELECT * FROM orders LIMIT 5" },
				state: "complete",
			},
		]);
		expect(sql).toEqual(["SELECT * FROM orders LIMIT 5"]);
	});

	it("returns the latest sql draft from mixed parts", () => {
		const latest = latestSqlFromParts([
			{ type: "text", content: "```sql\nSELECT 1;\n```" },
			{
				type: "tool-call",
				id: "2",
				name: "run_readonly",
				arguments: '{"sql":"SELECT 2"}',
				input: { sql: "SELECT 2" },
				state: "complete",
			},
		]);
		expect(latest).toBe("SELECT 2");
	});
});
