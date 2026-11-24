import type { ForeignKeyEdge, QueryEditorMetadata, QueryEditorTable } from "@/data/types";

export const VELOXY_SCHEMA_BRIEF_CHAR_BUDGET = 6_000;

function formatRowEstimate(estimate: number | null | undefined): string {
	if (estimate == null || estimate <= 0) return "";
	if (estimate >= 1_000_000) return `~${(estimate / 1_000_000).toFixed(1)}M rows`;
	if (estimate >= 1_000) return `~${Math.round(estimate / 1_000)}k rows`;
	return `~${Math.round(estimate)} rows`;
}

function tableLine(table: QueryEditorTable, withColumns: boolean): string {
	const parts: string[] = [`${table.schema}.${table.name}`];
	const rows = formatRowEstimate(table.estimatedRows);
	if (rows) parts.push(`(${rows})`);
	if (table.comment?.trim()) parts.push(`// ${table.comment.trim().replace(/\s+/g, " ")}`);
	let line = parts.join(" ");
	if (withColumns && table.columns.length > 0) {
		line += `: ${table.columns.map((column) => column.name).join(", ")}`;
	}
	return line;
}

function foreignKeyLine(edge: ForeignKeyEdge): string {
	return `${edge.fromSchema}.${edge.fromTable}.${edge.fromColumn} -> ${edge.toSchema}.${edge.toTable}.${edge.toColumn}`;
}

function render(input: {
	metadata: QueryEditorMetadata;
	foreignKeys: ForeignKeyEdge[];
	withColumns: boolean;
	withForeignKeys: boolean;
}): string {
	const sections: string[] = [];
	sections.push(
		input.withColumns
			? "Database overview (every table with its columns; use describe_table for types/keys):"
			: "Database overview (table names only; use search_schema / describe_table for columns):",
	);
	for (const table of input.metadata.tables) {
		sections.push(tableLine(table, input.withColumns));
	}
	if (input.withForeignKeys && input.foreignKeys.length > 0) {
		sections.push("Relationships (foreign keys):");
		for (const edge of input.foreignKeys) {
			sections.push(foreignKeyLine(edge));
		}
	}
	const enums = input.metadata.enums ?? [];
	if (enums.length > 0) {
		sections.push(
			`Enum types: ${enums
				.map((item) => `${item.name}(${item.values.join("|")})`)
				.join("; ")}`,
		);
	}
	if (input.metadata.truncatedTables) {
		sections.push(
			"Note: the catalog listing above is truncated; more tables exist. Use search_schema to find anything not listed.",
		);
	}
	return sections.join("\n");
}

/**
 * Compact, budgeted overview of the connected database that is always in the
 * system prompt, so the model knows what exists before its first tool call.
 * Degrades gracefully: full columns -> table names + FKs -> table names only.
 */
export function buildSchemaBrief(input: {
	metadata: QueryEditorMetadata;
	foreignKeys: ForeignKeyEdge[];
	charBudget?: number;
}): string {
	const budget = input.charBudget ?? VELOXY_SCHEMA_BRIEF_CHAR_BUDGET;
	if (input.metadata.tables.length === 0) return "";

	const attempts: Array<{ withColumns: boolean; withForeignKeys: boolean }> = [
		{ withColumns: true, withForeignKeys: true },
		{ withColumns: false, withForeignKeys: true },
		{ withColumns: false, withForeignKeys: false },
	];
	for (const attempt of attempts) {
		const brief = render({
			metadata: input.metadata,
			foreignKeys: input.foreignKeys,
			...attempt,
		});
		if (brief.length <= budget) return brief;
	}

	// Last resort: truncated table-name list within budget.
	const lines: string[] = [
		"Database overview (partial table list; use search_schema for the rest):",
	];
	let used = lines[0].length;
	let listed = 0;
	for (const table of input.metadata.tables) {
		const line = tableLine(table, false);
		if (used + line.length + 1 > budget - 80) break;
		lines.push(line);
		used += line.length + 1;
		listed += 1;
	}
	const remaining = input.metadata.tables.length - listed;
	if (remaining > 0) {
		lines.push(`…and ${remaining} more tables. Call search_schema to find them.`);
	}
	return lines.join("\n");
}
