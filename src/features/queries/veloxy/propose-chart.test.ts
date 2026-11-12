import { beforeAll, describe, expect, it } from "vitest";

import type { QueryResult } from "@/data/types";
import { registerBuiltInPlugins } from "@/features/plugins/bootstrap";
import { buildProposeChartResult } from "@/features/queries/veloxy/propose-chart";

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

describe("buildProposeChartResult", () => {
	it("defaults a categorical + numeric result to bar encodings", () => {
		const result = makeResult({
			columns: ["status", "count"],
			rows: [
				{ status: "open", count: "12" },
				{ status: "closed", count: "8" },
				{ status: "pending", count: "3" },
			],
			rowCount: 3,
		});

		const proposed = buildProposeChartResult({
			sql: "SELECT status, count(*) FROM orders GROUP BY 1",
			title: "Orders by status",
			result,
		});

		expect(proposed.viz.chartType).toBe("bar");
		expect(proposed.viz.encodings.x?.column).toBe("status");
		expect(proposed.viz.encodings.y?.map((ref) => ref.column)).toEqual(["count"]);
		expect(proposed.title).toBe("Orders by status");
		expect(proposed.sampleRows).toHaveLength(3);
	});

	it("honors an explicit kpi chart type", () => {
		const result = makeResult({
			columns: ["total"],
			rows: [{ total: "42" }],
			rowCount: 1,
		});

		const proposed = buildProposeChartResult({
			sql: "SELECT count(*) AS total FROM orders",
			chartType: "kpi",
			result,
		});

		expect(proposed.viz.chartType).toBe("kpi");
		expect(proposed.viz.encodings.y?.map((ref) => ref.column)).toEqual(["total"]);
		expect(proposed.title).toBe("Chart");
	});

	it("keeps the model sample small but stores full rows for rendering", async () => {
		const rows = Array.from({ length: 120 }, (_, idx) => ({
			day: `2024-01-${String((idx % 28) + 1).padStart(2, "0")}`,
			count: String(idx),
		}));
		const proposed = buildProposeChartResult({
			sql: "SELECT day, count(*) FROM events GROUP BY 1",
			result: makeResult({ columns: ["day", "count"], rows, rowCount: 120 }),
		});

		expect(proposed.sampleRows).toHaveLength(20);
		expect(proposed.rowCount).toBe(120);
		expect(proposed.chartDataKey).toBeTruthy();
		const { getChartRows } = await import("@/features/queries/veloxy/chart-data-cache");
		expect(getChartRows(proposed.chartDataKey)).toHaveLength(120);
	});

	it("honors an explicit bar chart type over a time-series recommendation", () => {
		const result = makeResult({
			columns: ["month", "count"],
			rows: [
				{ month: "2024-01-01", count: "10" },
				{ month: "2024-02-01", count: "14" },
				{ month: "2024-03-01", count: "9" },
			],
			rowCount: 3,
		});

		const proposed = buildProposeChartResult({
			sql: "SELECT date_trunc('month', created_at) AS month, count(*) FROM orders GROUP BY 1",
			chartType: "bar",
			result,
		});

		expect(proposed.viz.chartType).toBe("bar");
		expect(proposed.viz.encodings.x?.column).toBe("month");
		expect(proposed.viz.encodings.y?.map((ref) => ref.column)).toEqual(["count"]);
	});

	it("honors model-supplied encodings when the columns exist", () => {
		const result = makeResult({
			columns: ["month", "revenue", "region"],
			rows: [
				{ month: "2024-01-01", revenue: "10", region: "west" },
				{ month: "2024-02-01", revenue: "14", region: "east" },
			],
			rowCount: 2,
		});

		const proposed = buildProposeChartResult({
			sql: "SELECT month, revenue, region FROM sales",
			chartType: "line",
			encodings: { x: "month", y: ["revenue"], series: "region" },
			result,
		});

		expect(proposed.viz.chartType).toBe("line");
		expect(proposed.viz.encodings.x?.column).toBe("month");
		expect(proposed.viz.encodings.y?.map((ref) => ref.column)).toEqual(["revenue"]);
		expect(proposed.viz.encodings.series?.column).toBe("region");
	});

	it("falls back to default encodings when requested columns are unknown", () => {
		const result = makeResult({
			columns: ["status", "count"],
			rows: [
				{ status: "open", count: "12" },
				{ status: "closed", count: "8" },
			],
			rowCount: 2,
		});

		const proposed = buildProposeChartResult({
			sql: "SELECT status, count(*) FROM orders GROUP BY 1",
			chartType: "bar",
			encodings: { x: "missing_dim", y: ["missing_measure"], series: "nope" },
			result,
		});

		expect(proposed.viz.chartType).toBe("bar");
		expect(proposed.viz.encodings.x?.column).toBe("status");
		expect(proposed.viz.encodings.y?.map((ref) => ref.column)).toEqual(["count"]);
		expect(proposed.viz.encodings.series).toBeUndefined();
	});
});
