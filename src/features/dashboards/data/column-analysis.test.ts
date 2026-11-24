import { beforeAll, describe, expect, it } from "vitest";

import type { QueryResult } from "@/data/types";
import { analyzeColumns, recommendChartType } from "@/features/dashboards/data/column-analysis";
import { coerceQueryResult } from "@/features/dashboards/data/typed-rows";
import { registerBuiltInPlugins } from "@/features/plugins/bootstrap";

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

beforeAll(() => {
	registerBuiltInPlugins();
});

describe("analyzeColumns", () => {
	it("detects a temporal + numeric time-series shape", () => {
		const result = makeResult({
			columns: ["day", "total"],
			rows: [
				{ day: "2024-01-01", total: "10" },
				{ day: "2024-01-02", total: "12" },
				{ day: "2024-01-03", total: "9" },
			],
			rowCount: 3,
		});
		expect(analyzeColumns(coerceQueryResult(result))).toEqual([
			{ name: "day", role: "temporal", sampleSize: 3, distinctCount: 3 },
			{ name: "total", role: "numeric", sampleSize: 3, distinctCount: 3 },
		]);
	});

	it("detects a single numeric metric", () => {
		const result = makeResult({ columns: ["count"], rows: [{ count: "42" }], rowCount: 1 });
		expect(analyzeColumns(coerceQueryResult(result))).toEqual([{ name: "count", role: "numeric", sampleSize: 1, distinctCount: 1 }]);
	});

	it("flags a high-cardinality categorical column", () => {
		const rows = Array.from({ length: 30 }, (_, i) => ({ id: `user-${i}`, amount: String(i) }));
		const result = makeResult({ columns: ["id", "amount"], rows, rowCount: rows.length });
		const columns = analyzeColumns(coerceQueryResult(result));
		expect(columns.find((c) => c.name === "id")).toEqual({ name: "id", role: "categorical", cardinality: "high", sampleSize: 30, distinctCount: 30 });
	});

	it("flags a low-cardinality categorical column", () => {
		const statuses = ["active", "inactive", "pending"];
		const rows = Array.from({ length: 30 }, (_, i) => ({ status: statuses[i % 3], amount: String(i) }));
		const result = makeResult({ columns: ["status", "amount"], rows, rowCount: rows.length });
		const columns = analyzeColumns(coerceQueryResult(result));
		expect(columns.find((c) => c.name === "status")).toEqual({ name: "status", role: "categorical", cardinality: "low", sampleSize: 30, distinctCount: 3 });
	});

	it("returns unknown for an all-null column", () => {
		const result = makeResult({ columns: ["note"], rows: [{ note: null }, { note: null }], rowCount: 2 });
		expect(analyzeColumns(coerceQueryResult(result))).toEqual([{ name: "note", role: "unknown", sampleSize: 0, distinctCount: 0 }]);
	});

	it("handles an empty result", () => {
		expect(analyzeColumns(coerceQueryResult(makeResult()))).toEqual([]);
	});
});

describe("recommendChartType", () => {
	it("recommends a line chart for time-series data", () => {
		const columns = analyzeColumns(coerceQueryResult(makeResult({
			columns: ["day", "total"],
			rows: [{ day: "2024-01-01", total: "10" }, { day: "2024-01-02", total: "12" }],
			rowCount: 2,
		})));
		expect(recommendChartType(columns)).toBe("line");
	});

	it("recommends a kpi for a single numeric metric", () => {
		const columns = analyzeColumns(coerceQueryResult(makeResult({
			columns: ["count"], rows: [{ count: "42" }], rowCount: 1,
		})));
		expect(recommendChartType(columns)).toBe("kpi");
	});

	it("recommends a bar chart for one low-cardinality category + one metric", () => {
		const columns = analyzeColumns(coerceQueryResult(makeResult({
			columns: ["region", "revenue"],
			rows: [{ region: "east", revenue: "100" }, { region: "west", revenue: "80" }],
			rowCount: 2,
		})));
		expect(recommendChartType(columns)).toBe("bar");
	});

	it("falls back to table for two categorical columns with no numeric metric", () => {
		const columns = analyzeColumns(coerceQueryResult(makeResult({
			columns: ["first_name", "last_name"],
			rows: [{ first_name: "Ada", last_name: "Lovelace" }, { first_name: "Alan", last_name: "Turing" }],
			rowCount: 2,
		})));
		expect(recommendChartType(columns)).toBe("table");
	});

	it("falls back to table for an empty result", () => {
		expect(recommendChartType([])).toBe("table");
	});

	it("recommends a scatter chart for two numeric columns", () => {
		const columns = analyzeColumns(coerceQueryResult(makeResult({
			columns: ["price", "quantity"],
			rows: [
				{ price: "10", quantity: "4" },
				{ price: "12", quantity: "7" },
				{ price: "9", quantity: "3" },
			],
			rowCount: 3,
		})));
		expect(recommendChartType(columns)).toBe("scatter");
	});

	it("recommends a heatmap for two categories plus a measure", () => {
		const columns = analyzeColumns(coerceQueryResult(makeResult({
			columns: ["day", "region", "revenue"],
			rows: [
				{ day: "mon", region: "east", revenue: "10" },
				{ day: "tue", region: "west", revenue: "12" },
			],
			rowCount: 2,
		})));
		expect(recommendChartType(columns)).toBe("heatmap");
	});

	it("recommends a combo chart for a time series with two metrics", () => {
		const columns = analyzeColumns(coerceQueryResult(makeResult({
			columns: ["day", "revenue", "orders"],
			rows: [
				{ day: "2024-01-01", revenue: "10", orders: "2" },
				{ day: "2024-01-02", revenue: "12", orders: "3" },
			],
			rowCount: 2,
		})));
		expect(recommendChartType(columns)).toBe("combo");
	});

	it("recommends a histogram for a single numeric distribution", () => {
		const rows = Array.from({ length: 20 }, (_, i) => ({ amount: String(i * 3) }));
		const columns = analyzeColumns(coerceQueryResult(makeResult({
			columns: ["amount"],
			rows,
			rowCount: rows.length,
		})));
		expect(recommendChartType(columns)).toBe("histogram");
	});
});
