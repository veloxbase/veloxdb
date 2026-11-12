import type {
	DatabaseEngine,
	ForeignKeyEdge,
	QueryEditorMetadata,
	QueryEditorTable,
} from "@/data/types";
import { VELOXY_MAX_CHART_ROWS, VELOXY_SAMPLE_ROWS } from "@/data/types";
import { veloxDbRepository } from "@/data/repositories";
import { buildExplainSql } from "@/features/queries/queries";
import {
	peekVeloxyForeignKeys,
	peekVeloxyMetadata,
	preloadVeloxyCatalog,
	withTimeout,
} from "@/features/queries/veloxy/metadata-cache";
import { buildProposeChartResult } from "@/features/queries/veloxy/propose-chart";
import { rankSchemaContext } from "@/features/queries/veloxy/schema-rank";
import { assertVeloxySqlEngine } from "@/features/queries/veloxy/sql-engines";
import {
	describeTableTool,
	explainSqlTool,
	lintSqlTool,
	proposeChartTool,
	runReadonlyTool,
	searchSchemaTool,
} from "@/features/queries/veloxy/tools";

export type VeloxyToolContext = {
	connectionId: string;
	engine: DatabaseEngine;
	targetTable?: { schema: string; name: string } | null;
};

function requireContext(context: { context: VeloxyToolContext }): VeloxyToolContext {
	const current = context.context;
	if (!current?.connectionId) {
		throw new Error("Select a database connection first.");
	}
	assertVeloxySqlEngine(current.engine);
	return current;
}

export const searchSchema = searchSchemaTool.server<VeloxyToolContext>(async (input, context) => {
	const { connectionId, targetTable } = requireContext(context);
	const metadata = peekVeloxyMetadata(connectionId);
	const foreignKeys = peekVeloxyForeignKeys(connectionId) ?? [];
	if (!metadata) {
		preloadVeloxyCatalog(connectionId);
		return { tables: [], foreignKeys, truncated: true };
	}
	return rankSchemaContext({
		metadata,
		foreignKeys,
		query: input.query,
		targetTable,
	});
});

/** Enum labels for a column whose data type names an enum (e.g. `public.order_status`). */
function enumValuesForType(
	metadata: QueryEditorMetadata | null,
	dataType: string,
): string[] | undefined {
	const enums = metadata?.enums;
	if (!enums?.length) return undefined;
	const normalized = dataType.trim().toLowerCase().replace(/\[\]$/, "");
	const match = enums.find((item) => {
		const enumName = item.name.toLowerCase();
		return enumName === normalized || enumName.endsWith(`.${normalized}`);
	});
	return match?.values;
}

function findCatalogTable(
	metadata: QueryEditorMetadata | null,
	schema: string,
	name: string,
): QueryEditorTable | undefined {
	return metadata?.tables.find(
		(candidate) =>
			candidate.schema.toLowerCase() === schema.toLowerCase() &&
			candidate.name.toLowerCase() === name.toLowerCase(),
	);
}

function relatedForeignKeys(
	foreignKeys: ForeignKeyEdge[],
	schema: string,
	name: string,
) {
	return foreignKeys.filter(
		(edge) =>
			(edge.fromSchema.toLowerCase() === schema.toLowerCase() &&
				edge.fromTable.toLowerCase() === name.toLowerCase()) ||
			(edge.toSchema.toLowerCase() === schema.toLowerCase() &&
				edge.toTable.toLowerCase() === name.toLowerCase()),
	);
}

function describeFromCatalog(
	schema: string,
	name: string,
	catalogTable: QueryEditorTable,
	metadata: QueryEditorMetadata | null,
	foreignKeys: ForeignKeyEdge[],
) {
	return {
		schema,
		name,
		estimatedRows: catalogTable.estimatedRows ?? null,
		comment: catalogTable.comment ?? null,
		columns: catalogTable.columns.map((column) => {
			const enumValues = enumValuesForType(metadata, column.dataType);
			return {
				columnName: column.name,
				dataType: column.dataType,
				isNullable: column.isNullable ?? true,
				isPrimaryKey: column.isPrimaryKey ?? false,
				isUnique: column.isPrimaryKey ?? false,
				columnDefault: null,
				comment: column.comment ?? null,
				...(enumValues ? { enumValues } : {}),
			};
		}),
		indexes: [] as Array<{
			name: string;
			definition: string;
			isPrimary: boolean;
			isUnique: boolean;
		}>,
		foreignKeys: relatedForeignKeys(foreignKeys, schema, name),
	};
}

export const describeTable = describeTableTool.server<VeloxyToolContext>(async (input, context) => {
	const { connectionId } = requireContext(context);
	const schema = input.schema;
	const name = (input.name ?? input.table ?? "").trim();
	if (!name) {
		throw new Error("Table name is required.");
	}

	const peekedKeys = peekVeloxyForeignKeys(connectionId);
	const peekedMeta = peekVeloxyMetadata(connectionId);
	if (!peekedMeta) {
		preloadVeloxyCatalog(connectionId);
	}
	const foreignKeys = peekedKeys ?? [];
	const metadata = peekedMeta;
	const catalogTable = findCatalogTable(metadata, schema, name);
	if (catalogTable && catalogTable.columns.length > 0) {
		return describeFromCatalog(schema, name, catalogTable, metadata, foreignKeys);
	}

	return {
		schema,
		name,
		estimatedRows: catalogTable?.estimatedRows ?? null,
		comment:
			catalogTable?.comment ??
			"This table is not in the cached catalog. Use the database overview or search_schema instead of waiting on another describe.",
		columns: (catalogTable?.columns ?? []).map((column) => ({
			columnName: column.name,
			dataType: column.dataType,
			isNullable: column.isNullable ?? true,
			isPrimaryKey: column.isPrimaryKey ?? false,
			isUnique: column.isPrimaryKey ?? false,
			columnDefault: null,
			comment: column.comment ?? null,
		})),
		indexes: [],
		foreignKeys: relatedForeignKeys(foreignKeys, schema, name),
	};
});

export const runReadonly = runReadonlyTool.server<VeloxyToolContext>(async (input, context) => {
	const { connectionId } = requireContext(context);
	const result = await withTimeout(
		veloxDbRepository.veloxyRunReadonly({
			connectionId,
			sql: input.sql,
		}),
		20_000,
		"Query",
	);
	return {
		columns: result.columns,
		rowCount: result.rowCount,
		truncated: result.truncated || result.rows.length > VELOXY_SAMPLE_ROWS,
		executionMs: result.executionMs,
		sampleRows: result.rows.slice(0, VELOXY_SAMPLE_ROWS),
	};
});

export const explainSql = explainSqlTool.server<VeloxyToolContext>(async (input, context) => {
	const { connectionId, engine } = requireContext(context);
	const planSql = buildExplainSql(engine, input.sql, { analyze: false });
	const result = await withTimeout(
		veloxDbRepository.veloxyRunReadonly({
			connectionId,
			sql: planSql,
		}),
		20_000,
		"Query plan",
	);
	return {
		planSql,
		columns: result.columns,
		rows: result.rows.slice(0, VELOXY_SAMPLE_ROWS),
		executionMs: result.executionMs,
	};
});

export const lintSql = lintSqlTool.server<VeloxyToolContext>(async (input, context) => {
	const { connectionId } = requireContext(context);
	const result = await withTimeout(
		veloxDbRepository.lintSql({
			connectionId,
			sql: input.sql,
		}),
		12_000,
		"SQL lint",
	);
	return {
		diagnostics: result.diagnostics.map((diagnostic) => ({
			message: diagnostic.message,
			severity: diagnostic.severity,
			line: diagnostic.line ?? null,
			column: diagnostic.column ?? null,
		})),
	};
});

export const proposeChart = proposeChartTool.server<VeloxyToolContext>(async (input, context) => {
	const { connectionId } = requireContext(context);
	const result = await withTimeout(
		veloxDbRepository.veloxyRunReadonly({
			connectionId,
			sql: input.sql,
			maxRows: VELOXY_MAX_CHART_ROWS,
		}),
		20_000,
		"Chart query",
	);
	return buildProposeChartResult({
		sql: input.sql,
		title: input.title,
		chartType: input.chartType,
		encodings: input.encodings,
		result,
	});
});

export const veloxyServerTools = [
	searchSchema,
	describeTable,
	runReadonly,
	explainSql,
	lintSql,
	proposeChart,
];
