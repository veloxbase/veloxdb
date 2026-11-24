import { describe, expect, it } from "vitest";

import type { QueryResult } from "@/data/types";
import { coerceQueryResult } from "@/features/dashboards/data/typed-rows";

function makeResult(overrides: Partial<QueryResult> = {}): QueryResult {
	return {
		columns: [],
		rows: [],
		rowCount: 0,
		executionMs: 1,
		truncated: false,
		commandTag: null,
		...overrides,
	};
}

describe("coerceQueryResult", () => {
	it("coerces numeric strings to numbers", () => {
		const result = makeResult({
			columns: ["id", "amount"],
			rows: [{ id: "1", amount: "42.5" }],
			rowCount: 1,
		});
		const typed = coerceQueryResult(result);
		expect(typed.rows[0]).toEqual({ id: 1, amount: 42.5 });
	});

	it("coerces ISO date strings to Date instances", () => {
		const result = makeResult({
			columns: ["created_at"],
			rows: [{ created_at: "2024-01-15T10:30:00Z" }],
			rowCount: 1,
		});
		const typed = coerceQueryResult(result);
		expect(typed.rows[0].created_at).toBeInstanceOf(Date);
	});

	it("preserves nulls", () => {
		const result = makeResult({
			columns: ["name"],
			rows: [{ name: null }],
			rowCount: 1,
		});
		const typed = coerceQueryResult(result);
		expect(typed.rows[0].name).toBeNull();
	});

	it("leaves non-numeric, non-date strings as text", () => {
		const result = makeResult({
			columns: ["name"],
			rows: [{ name: "Ada Lovelace" }],
			rowCount: 1,
		});
		const typed = coerceQueryResult(result);
		expect(typed.rows[0].name).toBe("Ada Lovelace");
	});

	it("handles an empty result", () => {
		const typed = coerceQueryResult(makeResult());
		expect(typed.rows).toEqual([]);
		expect(typed.rowCount).toBe(0);
	});

	it("passes through the truncated flag", () => {
		const result = makeResult({ truncated: true });
		expect(coerceQueryResult(result).truncated).toBe(true);
	});
});
