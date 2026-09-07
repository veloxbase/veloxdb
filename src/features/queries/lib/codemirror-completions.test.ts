import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import {
	buildSqlSchema,
	createMongoCompletionSource,
	createRedisCompletionSource,
} from "./codemirror-completions";
import type { QueryEditorMetadata } from "@/data/types";

const sampleMetadata: QueryEditorMetadata = {
	tables: [
		{
			schema: "public",
			name: "users",
			columns: [
				{ name: "id", dataType: "integer" },
				{ name: "name", dataType: "varchar" },
				{ name: "email", dataType: "varchar" },
			],
		},
		{
			schema: "public",
			name: "orders",
			columns: [
				{ name: "id", dataType: "integer" },
				{ name: "user_id", dataType: "integer" },
				{ name: "total", dataType: "numeric" },
			],
		},
	],
	functions: [],
	truncatedTables: false,
	truncatedColumns: false,
	truncatedFunctions: false,
};

describe("buildSqlSchema", () => {
	it("returns empty schema and tables when metadata is empty or undefined", () => {
		const empty = buildSqlSchema(undefined);
		expect(empty.schema).toEqual({});
		expect(empty.tables).toEqual([]);
	});

	it("converts QueryEditorMetadata into CodeMirror SQL schema format", () => {
		const result = buildSqlSchema(sampleMetadata);
		expect(result.schema.users).toBeDefined();
		expect(result.schema["public.users"]).toBeDefined();
		expect(result.schema.orders).toBeDefined();

		const userCols = result.schema.users as { label: string }[];
		expect(userCols.map((c) => c.label)).toEqual(["id", "name", "email"]);

		const tableLabels = result.tables.map((t) => t.label);
		expect(tableLabels).toContain("users");
		expect(tableLabels).toContain("orders");
	});
});

describe("createMongoCompletionSource", () => {
	it("suggests collections when typing db.", () => {
		const source = createMongoCompletionSource(sampleMetadata);
		const doc = "db.";
		const state = EditorState.create({ doc });
		const context = new CompletionContext(state, doc.length, false);

		const result = source(context) as unknown as CompletionResult;
		expect(result).not.toBeNull();
		const labels = result.options.map((o) => o.label);
		expect(labels).toContain("users");
		expect(labels).toContain("orders");
	});

	it("suggests mongo methods after db.<collection>.", () => {
		const source = createMongoCompletionSource(sampleMetadata);
		const doc = "db.users.";
		const state = EditorState.create({ doc });
		const context = new CompletionContext(state, doc.length, false);

		const result = source(context) as unknown as CompletionResult;
		expect(result).not.toBeNull();
		const labels = result.options.map((o) => o.label);
		expect(labels).toContain("find");
		expect(labels).toContain("aggregate");
		expect(labels).toContain("countDocuments");
		expect(labels).toContain("updateOne");
	});

	it("suggests mongo operators when typing $", () => {
		const source = createMongoCompletionSource(sampleMetadata);
		const doc = "db.users.find({ $";
		const state = EditorState.create({ doc });
		const context = new CompletionContext(state, doc.length, false);

		const result = source(context) as unknown as CompletionResult;
		expect(result).not.toBeNull();
		const labels = result.options.map((o) => o.label);
		expect(labels).toContain("$gt");
		expect(labels).toContain("$match");
		expect(labels).toContain("$in");
		expect(labels).toContain("$set");
	});

	it("suggests collection fields and BSON types inside document", () => {
		const source = createMongoCompletionSource(sampleMetadata);
		const doc = "db.users.find({ ";
		const state = EditorState.create({ doc });
		const context = new CompletionContext(state, doc.length, true);

		const result = source(context) as unknown as CompletionResult;
		expect(result).not.toBeNull();
		const labels = result.options.map((o) => o.label);
		expect(labels).toContain("id");
		expect(labels).toContain("name");
		expect(labels).toContain("email");
		expect(labels).toContain("ObjectId");
		expect(labels).toContain("ISODate");
	});
});

describe("createRedisCompletionSource", () => {
	it("suggests Redis commands", () => {
		const source = createRedisCompletionSource();
		const doc = "GE";
		const state = EditorState.create({ doc });
		const context = new CompletionContext(state, doc.length, false);

		const result = source(context) as unknown as CompletionResult;
		expect(result).not.toBeNull();
		const labels = result.options.map((o) => o.label);
		expect(labels).toContain("GET");
		expect(labels).toContain("SET");
		expect(labels).toContain("HGETALL");
	});
});
