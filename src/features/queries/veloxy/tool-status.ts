import type { MessagePart, ToolCallPart } from "@tanstack/ai-client";

const SCHEMA_TOOLS = new Set(["describe_table", "search_schema"]);
/** Agent internals; only surface them when they fail. */
const QUIET_TOOLS = new Set(["lint_sql", "explain_sql"]);

/** Schema tools are cache-only; if they sit this long the agent loop is stuck. */
export const TOOL_STALL_MS = 8_000;
/** SQL tools can legitimately run up to their own 20s timeout. */
export const QUERY_TOOL_STALL_MS = 25_000;
/** Hung argument streams (model never finishes the tool call) use a longer window. */
export const TOOL_ARG_STREAM_STALL_MS = 12_000;

export function isSchemaTool(name: string): boolean {
	return SCHEMA_TOOLS.has(name);
}

export function isQuietTool(name: string): boolean {
	return QUIET_TOOLS.has(name);
}

/**
 * Parts are recreated on every stream update, so wall-clock tracking is keyed
 * by tool-call id. Bounded FIFO to avoid growing across long sessions.
 */
const executionStart = new Map<string, number>();
const MAX_TRACKED = 200;

function markExecutionStart(part: ToolCallPart): number {
	const existing = executionStart.get(part.id);
	if (existing) return existing;
	const now = Date.now();
	executionStart.set(part.id, now);
	if (executionStart.size > MAX_TRACKED) {
		const oldest = executionStart.keys().next().value;
		if (oldest) executionStart.delete(oldest);
	}
	return now;
}

export type ToolStatus = "running" | "success" | "error" | "stalled";

/**
 * When (epoch ms) this part should be considered stalled, or null when it is
 * finished or its args are still streaming.
 */
export function toolStallDeadline(part: ToolCallPart): number | null {
	if (part.state === "error" || part.state === "complete") return null;
	if (part.output != null) return null;
	const started = markExecutionStart(part);
	// Model is still writing the arguments; allow a longer window than execution.
	if (part.state === "awaiting-input" || part.state === "input-streaming") {
		return started + TOOL_ARG_STREAM_STALL_MS;
	}
	return started + (isSchemaTool(part.name) ? TOOL_STALL_MS : QUERY_TOOL_STALL_MS);
}

export function toolStatusLabel(part: ToolCallPart): ToolStatus {
	if (part.state === "error") return "error";
	if (part.state === "complete" || part.output != null) return "success";
	const deadline = toolStallDeadline(part);
	if (deadline != null && Date.now() >= deadline) return "stalled";
	return "running";
}

export function isToolRunning(part: ToolCallPart): boolean {
	return toolStatusLabel(part) === "running";
}

function tableFromInput(input: unknown): string | null {
	if (!input || typeof input !== "object") return null;
	const obj = input as Record<string, unknown>;
	const name =
		(typeof obj.name === "string" && obj.name) ||
		(typeof obj.table === "string" && obj.table) ||
		"";
	if (!name) return null;
	const schema = typeof obj.schema === "string" ? obj.schema : "";
	return schema ? `${schema}.${name}` : name;
}

export function toolSql(part: ToolCallPart): string | null {
	const input = part.input;
	if (input && typeof input === "object" && "sql" in input && typeof input.sql === "string") {
		const sql = input.sql.trim();
		if (sql) return sql;
	}
	try {
		const parsed = JSON.parse(part.arguments) as { sql?: unknown };
		if (typeof parsed.sql === "string" && parsed.sql.trim()) return parsed.sql.trim();
	} catch {
		// Arguments may still be streaming.
	}
	return null;
}

/** Card title in user language; tense follows completion. */
export function toolHeadline(part: ToolCallPart): string {
	const done = toolStatusLabel(part) === "success";
	if (part.name === "describe_table") {
		const table = tableFromInput(part.input);
		if (table) return done ? `Looked at ${table}` : `Looking at ${table}`;
		return done ? "Looked at a table" : "Looking at a table";
	}
	if (part.name === "search_schema") {
		const input = part.input as { query?: unknown } | undefined;
		const query = typeof input?.query === "string" ? input.query.trim() : "";
		if (query) return done ? `Searched tables for “${query}”` : `Searching tables for “${query}”`;
		return done ? "Searched tables" : "Searching tables";
	}
	if (part.name === "run_readonly") return done ? "Query result" : "Querying";
	if (part.name === "explain_sql") return done ? "Query plan" : "Checking the query plan";
	if (part.name === "lint_sql") return done ? "SQL checked" : "Checking the SQL";
	if (part.name === "propose_chart") return done ? "Chart" : "Drawing a chart";
	return part.name.replaceAll("_", " ");
}

export function schemaToolSummary(part: ToolCallPart): string {
	if (part.name === "search_schema") {
		const input = part.input as { query?: unknown } | undefined;
		return typeof input?.query === "string" && input.query.trim()
			? `Search “${input.query.trim()}”`
			: "Search schema";
	}
	return tableFromInput(part.input) ?? "Table";
}

/** The single live status line under the last assistant message. */
export function activityLine(parts: Array<MessagePart>, pending: boolean): string | null {
	if (!pending) return null;
	const tools = parts.filter((part): part is ToolCallPart => part.type === "tool-call");
	const statuses = tools.map((part) => ({ part, status: toolStatusLabel(part) }));

	if (statuses.some(({ status }) => status === "stalled")) {
		return "A query stalled — you can still copy or insert its SQL.";
	}

	const running = statuses.filter(({ status }) => status === "running").map(({ part }) => part);
	if (running.length > 0) {
		if (running.every((part) => isSchemaTool(part.name))) return "Looking at tables…";
		if (running.some((part) => part.name === "propose_chart")) return "Drawing a chart…";
		if (running.some((part) => part.name === "run_readonly")) return "Running a query…";
		return "Working…";
	}

	if (tools.length > 0) return "Writing the answer…";
	return "Thinking…";
}
