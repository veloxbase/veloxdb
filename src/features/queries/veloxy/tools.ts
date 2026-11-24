import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";

import { VELOXY_CHAT_CHART_TYPES } from "@/features/queries/veloxy/propose-chart";

const sqlInput = z.object({
	sql: z.string().min(1).describe("A single SQL statement"),
});

export const searchSchemaTool = toolDefinition({
	name: "search_schema",
	description:
		"Search the cached catalog for tables, columns, and foreign keys matching a keyword. Instant — does not query the live database. Call once per turn; do not describe many tables.",
	inputSchema: z.object({
		query: z.string().min(1).describe("Keywords from the user question (table or column names)"),
	}),
	outputSchema: z.object({
		tables: z.array(
			z.object({
				schema: z.string(),
				name: z.string(),
				estimatedRows: z.number().nullable().optional(),
				comment: z.string().nullable().optional(),
				columns: z.array(
					z.object({
						name: z.string(),
						dataType: z.string(),
						comment: z.string().nullable().optional(),
					}),
				),
			}),
		),
		foreignKeys: z.array(
			z.object({
				fromSchema: z.string(),
				fromTable: z.string(),
				fromColumn: z.string(),
				toSchema: z.string(),
				toTable: z.string(),
				toColumn: z.string(),
			}),
		),
		truncated: z.boolean(),
	}),
});

export const describeTableTool = toolDefinition({
	name: "describe_table",
	description:
		"Read one table from the cached catalog (columns, keys, foreign keys). Instant — does not query the database. For relationships, missing indexes, or several tables, call search_schema once instead of describing many tables.",
	inputSchema: z.object({
		schema: z.string().min(1).describe("Schema name, e.g. public"),
		name: z.string().optional().describe("Table name"),
		table: z.string().optional().describe("Alias for name"),
	}),
	outputSchema: z.object({
		schema: z.string(),
		name: z.string(),
		estimatedRows: z.number().nullable().optional(),
		comment: z.string().nullable().optional(),
		columns: z.array(
			z.object({
				columnName: z.string(),
				dataType: z.string(),
				isNullable: z.boolean(),
				isPrimaryKey: z.boolean(),
				isUnique: z.boolean(),
				columnDefault: z.string().nullable().optional(),
				comment: z.string().nullable().optional(),
				enumValues: z.array(z.string()).optional(),
			}),
		),
		indexes: z.array(
			z.object({
				name: z.string(),
				definition: z.string(),
				isPrimary: z.boolean(),
				isUnique: z.boolean(),
			}),
		),
		foreignKeys: z.array(
			z.object({
				fromSchema: z.string(),
				fromTable: z.string(),
				fromColumn: z.string(),
				toSchema: z.string(),
				toTable: z.string(),
				toColumn: z.string(),
			}),
		),
	}),
});

export const runReadonlyTool = toolDefinition({
	name: "run_readonly",
	description:
		"Execute a single read-only SELECT or EXPLAIN against the connected database. Writes are rejected. Results are capped to a small sample. Do not use this to list schema, foreign keys, or constraints — call search_schema instead.",
	inputSchema: sqlInput,
	outputSchema: z.object({
		columns: z.array(z.string()),
		rowCount: z.number(),
		truncated: z.boolean(),
		executionMs: z.number(),
		sampleRows: z.array(z.record(z.string(), z.string().nullable())),
	}),
});

export const explainSqlTool = toolDefinition({
	name: "explain_sql",
	description:
		"Return a query plan without executing the statement (no ANALYZE). Use this to check cost or join strategy.",
	inputSchema: sqlInput,
	outputSchema: z.object({
		planSql: z.string(),
		columns: z.array(z.string()),
		rows: z.array(z.record(z.string(), z.string().nullable())),
		executionMs: z.number(),
	}),
});

export const lintSqlTool = toolDefinition({
	name: "lint_sql",
	description: "Lint a SQL statement and return diagnostics (errors, warnings, info).",
	inputSchema: sqlInput,
	outputSchema: z.object({
		diagnostics: z.array(
			z.object({
				message: z.string(),
				severity: z.enum(["error", "warning", "info"]),
				line: z.number().nullable().optional(),
				column: z.number().nullable().optional(),
			}),
		),
	}),
});

const columnRefSchema = z.object({
	column: z.string(),
	role: z.enum(["temporal", "categorical", "numeric"]).optional(),
});

export const proposeChartTool = toolDefinition({
	name: "propose_chart",
	description:
		"Run a read-only aggregate query and render an inline chart in the Ask Veloxy sidebar. Supports line, area, bar, horizontalBar, pie, donut, scatter, heatmap, histogram, box, combo, treemap, gauge, waterfall, and kpi. The chart binds to the full query result (up to 500 rows), not just the sample rows returned here. Required whenever the user asked to show, plot, chart, graph, visualize, or compare values.",
	inputSchema: z.object({
		sql: z.string().min(1).describe("A single read-only SQL statement that returns chartable rows"),
		title: z.string().optional().describe("Short chart title"),
		chartType: z
			.enum(VELOXY_CHAT_CHART_TYPES)
			.optional()
			.describe("Optional chart type; omitted uses a recommendation from the result columns"),
		encodings: z
			.object({
				x: z.string().optional().describe("Category or time column for the X axis"),
				y: z.array(z.string()).optional().describe("Numeric measure columns for Y"),
				series: z.string().optional().describe("Optional series / grouping column"),
				size: z.string().optional().describe("Optional bubble size column for scatter"),
			})
			.optional()
			.describe("Optional axis bindings; omitted or unknown columns fall back to a recommendation"),
	}),
	outputSchema: z.object({
		title: z.string(),
		sql: z.string(),
		viz: z.object({
			chartType: z.enum(VELOXY_CHAT_CHART_TYPES),
			encodings: z.object({
				x: columnRefSchema.optional(),
				y: z.array(columnRefSchema).optional(),
				series: columnRefSchema.optional(),
				size: columnRefSchema.optional(),
			}),
			options: z.record(z.string(), z.unknown()),
		}),
		columns: z.array(z.string()),
		rowCount: z.number(),
		truncated: z.boolean(),
		sampleRows: z.array(z.record(z.string(), z.string().nullable())),
		chartDataKey: z.string().optional(),
	}),
});
