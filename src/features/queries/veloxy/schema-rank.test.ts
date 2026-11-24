import { describe, expect, it } from "vitest";

import type { ForeignKeyEdge, QueryEditorMetadata } from "@/data/types";
import {
	rankSchemaContext,
	tokenizeQuery,
	VELOXY_MAX_CONTEXT_TABLES,
	VELOXY_SEARCH_CHAR_BUDGET,
} from "@/features/queries/veloxy/schema-rank";

function metadata(tables: QueryEditorMetadata["tables"]): QueryEditorMetadata {
	return {
		tables,
		functions: [],
		truncatedTables: false,
		truncatedColumns: false,
		truncatedFunctions: false,
	};
}

describe("tokenizeQuery", () => {
	it("drops stop words and adds singular forms", () => {
		const tokens = tokenizeQuery("show me the top orders per customer");
		expect(tokens).toContain("orders");
		expect(tokens).toContain("order");
		expect(tokens).toContain("customer");
		expect(tokens).not.toContain("show");
		expect(tokens).not.toContain("the");
	});
});

describe("rankSchemaContext", () => {
	it("puts the selected table first even without a keyword match", () => {
		const result = rankSchemaContext({
			metadata: metadata([
				{ schema: "public", name: "events", columns: [{ name: "id", dataType: "int" }] },
				{ schema: "public", name: "orders", columns: [{ name: "id", dataType: "int" }] },
			]),
			foreignKeys: [],
			query: "show me rows",
			targetTable: { schema: "public", name: "orders" },
		});
		expect(result.tables[0]?.name).toBe("orders");
	});

	it("ranks tables whose names appear in the prompt", () => {
		const result = rankSchemaContext({
			metadata: metadata([
				{ schema: "public", name: "users", columns: [{ name: "id", dataType: "int" }] },
				{ schema: "public", name: "orders", columns: [{ name: "id", dataType: "int" }] },
			]),
			foreignKeys: [],
			query: "what tables mention orders?",
		});
		expect(result.tables[0]?.name).toBe("orders");
	});

	it("matches tables through column names and comments", () => {
		const result = rankSchemaContext({
			metadata: metadata([
				{
					schema: "public",
					name: "t_accounts",
					columns: [{ name: "signup_date", dataType: "date" }],
				},
				{
					schema: "public",
					name: "t_misc",
					comment: "archived payloads",
					columns: [{ name: "blob", dataType: "bytea" }],
				},
			]),
			foreignKeys: [],
			query: "signups over time",
		});
		expect(result.tables[0]?.name).toBe("t_accounts");
	});

	it("pulls in FK neighbors of matched tables", () => {
		const foreignKeys: ForeignKeyEdge[] = [
			{
				fromSchema: "public",
				fromTable: "orders",
				fromColumn: "customer_id",
				toSchema: "public",
				toTable: "customers",
				toColumn: "id",
			},
		];
		const result = rankSchemaContext({
			metadata: metadata([
				{ schema: "public", name: "orders", columns: [{ name: "customer_id", dataType: "int" }] },
				{ schema: "public", name: "customers", columns: [{ name: "id", dataType: "int" }] },
				{ schema: "public", name: "unrelated", columns: [{ name: "id", dataType: "int" }] },
			]),
			foreignKeys,
			query: "revenue by order",
		});
		const names = result.tables.map((table) => table.name);
		expect(names).toContain("orders");
		expect(names).toContain("customers");
		expect(names).not.toContain("unrelated");
	});

	it("includes row estimates and comments in the output", () => {
		const result = rankSchemaContext({
			metadata: metadata([
				{
					schema: "public",
					name: "orders",
					estimatedRows: 51234,
					comment: "one row per checkout",
					columns: [{ name: "id", dataType: "int", comment: "pk" }],
				},
			]),
			foreignKeys: [],
			query: "orders",
		});
		expect(result.tables[0]?.estimatedRows).toBe(51234);
		expect(result.tables[0]?.comment).toBe("one row per checkout");
		expect(result.tables[0]?.columns[0]?.comment).toBe("pk");
	});

	it("stays within the char budget and flags truncation on huge schemas", () => {
		const tables = Array.from({ length: 60 }, (_, idx) => ({
			schema: "public",
			name: `t_${idx}`,
			columns: Array.from({ length: 30 }, (__, col) => ({
				name: `some_long_column_name_${col}`,
				dataType: "character varying(255)",
			})),
		}));
		const foreignKeys: ForeignKeyEdge[] = Array.from({ length: 50 }, (_, idx) => ({
			fromSchema: "public",
			fromTable: `t_${idx}`,
			fromColumn: "id",
			toSchema: "public",
			toTable: "t_0",
			toColumn: "id",
		}));
		const result = rankSchemaContext({
			metadata: metadata(tables),
			foreignKeys,
			query: "t_0",
		});
		expect(result.tables[0]?.name).toBe("t_0");
		expect(result.tables.length).toBeLessThanOrEqual(VELOXY_MAX_CONTEXT_TABLES);
		expect(JSON.stringify(result.tables).length).toBeLessThanOrEqual(
			VELOXY_SEARCH_CHAR_BUDGET + 2_000,
		);
		expect(result.truncated).toBe(true);
	});
});
