import type { MessagePart, ToolCallPart } from "@tanstack/ai-client";

const SQL_FENCE_RE = /```(?:sql|postgresql|postgres|mysql|sqlite|duckdb)\s*\r?\n([\s\S]*?)```/gi;
const SQL_TOOL_NAMES = new Set(["run_readonly", "explain_sql", "lint_sql", "propose_chart"]);

export function isSqlLanguage(lang: string | null | undefined): boolean {
	const normalized = (lang ?? "").trim().toLowerCase();
	return (
		normalized === "sql" ||
		normalized === "postgresql" ||
		normalized === "postgres" ||
		normalized === "mysql" ||
		normalized === "sqlite" ||
		normalized === "duckdb"
	);
}

export function extractSqlFences(markdown: string): string[] {
	const matches: string[] = [];
	SQL_FENCE_RE.lastIndex = 0;
	let match: RegExpExecArray | null = SQL_FENCE_RE.exec(markdown);
	while (match) {
		const sql = match[1]?.trim();
		if (sql) matches.push(sql);
		match = SQL_FENCE_RE.exec(markdown);
	}
	return matches;
}

function toolCallSql(part: ToolCallPart): string | null {
	if (!SQL_TOOL_NAMES.has(part.name)) return null;
	const input = part.input;
	if (input && typeof input === "object" && "sql" in input && typeof input.sql === "string") {
		const sql = input.sql.trim();
		return sql.length > 0 ? sql : null;
	}
	try {
		const parsed = JSON.parse(part.arguments) as { sql?: unknown };
		if (typeof parsed.sql === "string" && parsed.sql.trim()) {
			return parsed.sql.trim();
		}
	} catch {
		// Arguments may still be streaming.
	}
	return null;
}

export function extractSqlFromParts(parts: Array<MessagePart>): string[] {
	const found: string[] = [];
	for (const part of parts) {
		if (part.type === "text") {
			found.push(...extractSqlFences(part.content));
			continue;
		}
		if (part.type === "tool-call") {
			const sql = toolCallSql(part);
			if (sql) found.push(sql);
		}
	}
	return found;
}

export function latestSqlFromParts(parts: Array<MessagePart>): string | null {
	const all = extractSqlFromParts(parts);
	return all.at(-1) ?? null;
}
