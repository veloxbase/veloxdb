import type { ForeignKeyEdge, QueryEditorMetadata, QueryEditorTable } from "@/data/types";

/** Hard ceilings; the serialized-size budget below usually cuts earlier. */
export const VELOXY_MAX_CONTEXT_TABLES = 24;
export const VELOXY_MAX_CONTEXT_COLUMNS = 40;
export const VELOXY_MAX_CONTEXT_RELATIONSHIPS = 60;
/** Approximate cap on the serialized tool output sent back to the model. */
export const VELOXY_SEARCH_CHAR_BUDGET = 5_000;

export type RankedSchemaTable = {
	schema: string;
	name: string;
	estimatedRows?: number | null;
	comment?: string | null;
	columns: Array<{ name: string; dataType: string; comment?: string | null }>;
};

export type RankedSchemaResult = {
	tables: RankedSchemaTable[];
	foreignKeys: ForeignKeyEdge[];
	truncated: boolean;
};

const STOP_WORDS = new Set([
	"the", "and", "for", "with", "from", "into", "that", "this", "show", "list",
	"get", "find", "all", "any", "per", "top", "how", "many", "much", "what",
	"which", "where", "when", "who", "table", "tables", "column", "columns",
	"count", "give", "database", "schema", "select", "query", "rows", "data",
]);

export function tokenizeQuery(query: string): string[] {
	const seen = new Set<string>();
	for (const raw of query.toLowerCase().split(/[^a-z0-9_]+/)) {
		if (raw.length < 3 || STOP_WORDS.has(raw)) continue;
		seen.add(raw);
		// Naive singularization so "orders" matches a table named "order" and vice versa.
		if (raw.endsWith("s") && raw.length > 3) seen.add(raw.slice(0, -1));
	}
	return [...seen];
}

function nameMatchScore(name: string, token: string, exact: number, partial: number): number {
	if (name === token) return exact;
	if (name.includes(token) || (token.length >= 4 && token.includes(name))) return partial;
	return 0;
}

export function tableRelevanceScore(
	table: QueryEditorTable,
	promptLower: string,
	tokens: string[],
): number {
	const tableName = table.name.toLowerCase();
	const fullName = `${table.schema.toLowerCase()}.${tableName}`;
	const commentLower = table.comment?.toLowerCase() ?? "";
	let score = 0;
	if (promptLower.includes(fullName)) score += 8;
	else if (promptLower.includes(tableName)) score += 6;

	let columnScore = 0;
	let commentScore = 0;
	for (const token of tokens) {
		score += nameMatchScore(tableName, token, 5, 3);
		for (const column of table.columns) {
			columnScore += nameMatchScore(column.name.toLowerCase(), token, 2, 1);
			if (column.comment?.toLowerCase().includes(token)) commentScore += 1;
		}
		if (commentLower.includes(token)) commentScore += 1;
	}
	return score + Math.min(columnScore, 8) + Math.min(commentScore, 3);
}

export function tableMatchesTarget(
	table: QueryEditorTable,
	targetTable?: { schema: string; name: string } | null,
): boolean {
	if (!targetTable) return false;
	return (
		table.schema.toLowerCase() === targetTable.schema.toLowerCase() &&
		table.name.toLowerCase() === targetTable.name.toLowerCase()
	);
}

function toRankedTable(table: QueryEditorTable): {
	ranked: RankedSchemaTable;
	columnsTruncated: boolean;
} {
	return {
		ranked: {
			schema: table.schema,
			name: table.name,
			...(table.estimatedRows != null ? { estimatedRows: table.estimatedRows } : {}),
			...(table.comment ? { comment: table.comment } : {}),
			columns: table.columns.slice(0, VELOXY_MAX_CONTEXT_COLUMNS).map((column) => ({
				name: column.name,
				dataType: column.dataType,
				...(column.comment ? { comment: column.comment } : {}),
			})),
		},
		columnsTruncated: table.columns.length > VELOXY_MAX_CONTEXT_COLUMNS,
	};
}

function rankedTableSize(table: RankedSchemaTable): number {
	return JSON.stringify(table).length;
}

function tableKey(schema: string, name: string): string {
	return `${schema.toLowerCase()}.${name.toLowerCase()}`;
}

export function rankSchemaContext(input: {
	metadata: QueryEditorMetadata;
	foreignKeys: ForeignKeyEdge[];
	query: string;
	targetTable?: { schema: string; name: string } | null;
}): RankedSchemaResult {
	const promptLower = input.query.toLowerCase();
	const tokens = tokenizeQuery(input.query);

	const scored = input.metadata.tables
		.map((table) => ({
			table,
			score: tableRelevanceScore(table, promptLower, tokens),
			isTarget: tableMatchesTarget(table, input.targetTable),
		}))
		.sort(
			(a, b) =>
				Number(b.isTarget) - Number(a.isTarget) ||
				b.score - a.score ||
				(b.table.estimatedRows ?? 0) - (a.table.estimatedRows ?? 0),
		);

	// Direct matches first; when nothing matches, fall back to the largest
	// tables (usually the core business tables) so the model still sees data.
	const matches = scored.filter((entry) => entry.isTarget || entry.score > 0);
	const candidates = matches.length > 0 ? matches : scored;

	// One hop along the FK graph: tables joined to a match are almost always
	// needed for the query the user is really asking for.
	const neighborKeys = new Set<string>();
	if (matches.length > 0) {
		const matchKeys = new Set(matches.map(({ table }) => tableKey(table.schema, table.name)));
		for (const edge of input.foreignKeys) {
			const fromKey = tableKey(edge.fromSchema, edge.fromTable);
			const toKey = tableKey(edge.toSchema, edge.toTable);
			if (matchKeys.has(fromKey) && !matchKeys.has(toKey)) neighborKeys.add(toKey);
			if (matchKeys.has(toKey) && !matchKeys.has(fromKey)) neighborKeys.add(fromKey);
		}
	}
	const neighbors = scored.filter(
		(entry) =>
			entry.score === 0 &&
			!entry.isTarget &&
			neighborKeys.has(tableKey(entry.table.schema, entry.table.name)),
	);

	const ordered = matches.length > 0 ? [...candidates, ...neighbors] : candidates;

	let truncated =
		input.metadata.truncatedTables || input.metadata.truncatedColumns;
	let usedChars = 0;
	const tables: RankedSchemaTable[] = [];
	const selectedKeys = new Set<string>();
	for (const { table } of ordered) {
		if (tables.length >= VELOXY_MAX_CONTEXT_TABLES) {
			truncated = true;
			break;
		}
		const { ranked, columnsTruncated } = toRankedTable(table);
		const size = rankedTableSize(ranked);
		if (tables.length > 0 && usedChars + size > VELOXY_SEARCH_CHAR_BUDGET) {
			truncated = true;
			break;
		}
		if (columnsTruncated) truncated = true;
		tables.push(ranked);
		selectedKeys.add(tableKey(table.schema, table.name));
		usedChars += size;
	}
	if (tables.length < ordered.length) truncated = true;

	// Only relationships that touch a returned table are useful to the model.
	const relevantEdges = input.foreignKeys.filter(
		(edge) =>
			selectedKeys.has(tableKey(edge.fromSchema, edge.fromTable)) ||
			selectedKeys.has(tableKey(edge.toSchema, edge.toTable)),
	);
	if (relevantEdges.length > VELOXY_MAX_CONTEXT_RELATIONSHIPS) truncated = true;

	return {
		tables,
		foreignKeys: relevantEdges.slice(0, VELOXY_MAX_CONTEXT_RELATIONSHIPS),
		truncated,
	};
}
