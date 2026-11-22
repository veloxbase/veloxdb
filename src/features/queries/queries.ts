import { useMutation, useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/data/query-keys";
import { veloxDbRepository } from "@/data/repositories";
import type {
	DatabaseEngine,
	LintSqlResult,
	QueryEditorMetadata,
	QueryRequest,
	QueryResult,
} from "@/data/types";
import {
  buildInsertStatement,
  buildUpdateStatements,
  buildDeleteStatements,
  type InsertRowRequest,
  type SaveResultEditsRequest,
  type DeleteRowsRequest,
} from "@/features/queries/result-edits";
import i18n from "i18next";
import { shouldRetryTransientDbInvoke } from "@/lib/transient-invoke-retry";
import { useSettings } from "@/lib/settings";

export function buildTransactionalSql(
	engine: DatabaseEngine | undefined,
	statements: string[],
): string {
	const body = statements.join("\n");
	if (
		engine === "mysql" ||
		engine === "clickhouse" ||
		engine === "redis" ||
		engine === "mongo" ||
		engine === "cassandra" ||
		engine === "scylladb"
	) {
		return body;
	}
	if (engine === "mssql" || engine === "azuresql") {
		return `BEGIN TRANSACTION;\n${body}\nCOMMIT TRANSACTION;`;
	}
	return `BEGIN;\n${body}\nCOMMIT;`;
}

async function runTransactionalStatements(
	connectionId: string | undefined,
	engine: DatabaseEngine | undefined,
	statements: string[],
) {
	const sql = buildTransactionalSql(engine, statements);
	if (!sql || !connectionId) {
		return;
	}

	try {
		await veloxDbRepository.runQuery({
			connectionId,
			sql,
			allowWrite: true,
		});
	} catch (error) {
		if (
			engine !== "mysql" &&
			engine !== "clickhouse" &&
			engine !== "redis" &&
			engine !== "mongo" &&
			engine !== "cassandra" &&
			engine !== "scylladb"
		) {
			try {
				await veloxDbRepository.runQuery({
					connectionId,
					sql: engine === "mssql" || engine === "azuresql" ? "ROLLBACK TRANSACTION;" : "ROLLBACK;",
					allowWrite: true,
				});
			} catch {
				// Ignore rollback failure; surface original save failure to the UI.
			}
		}
		throw error;
	}
}

/** UI-only fields for correlating mutation results with a query tab. Stripped before IPC. */
export type RunQueryTabVariables = QueryRequest & {
	tabId: string;
	flightId: number;
};

type UseRunQueryMutationOptions = {
	onSuccess?: (result: QueryResult, variables: RunQueryTabVariables) => void;
	onError?: (error: unknown, variables: RunQueryTabVariables) => void;
	onSettled?: (
		data: QueryResult | undefined,
		error: unknown,
		variables: RunQueryTabVariables,
	) => void;
};

/** Postgres SQLSTATE 25006: a write was attempted inside a read-only transaction. */
export function isReadOnlyTransactionViolation(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return /SQLSTATE:\s*25006\b/.test(message);
}

export function useRunQueryMutation(options: UseRunQueryMutationOptions = {}) {
	const maxQueryRows = useSettings((s) => s.maxQueryRows);

	return useMutation({
		retry: shouldRetryTransientDbInvoke,
		mutationFn: async ({ connectionId, sql, allowWrite }: RunQueryTabVariables) => {
			try {
				return await veloxDbRepository.runQuery({ connectionId, sql, allowWrite, maxRows: maxQueryRows });
			} catch (error) {
				// The database refused a write that the read-only check did not
				// spot (e.g. a function that modifies data). Let the user decide.
				if (
					!allowWrite &&
					isReadOnlyTransactionViolation(error) &&
					window.confirm(i18n.t("editor.confirmWriteAfterReadOnly"))
				) {
					return veloxDbRepository.runQuery({ connectionId, sql, allowWrite: true, maxRows: maxQueryRows });
				}
				throw error;
			}
		},
		onSuccess: (result, variables) => {
			options.onSuccess?.(result, variables);
		},
		onError: (error, variables) => {
			options.onError?.(error, variables);
		},
		onSettled: (data, error, variables) => {
			options.onSettled?.(data, error, variables);
		},
	});
}

export function useQueryEditorMetadata(connectionId: string | null) {
	return useQuery<QueryEditorMetadata>({
		queryKey: queryKeys.queryEditorMetadata(connectionId),
		queryFn: () =>
			veloxDbRepository.getQueryEditorMetadata(connectionId ?? undefined),
		enabled: Boolean(connectionId),
		staleTime: 5 * 60 * 1000,
	});
}

export function useLintSqlMutation() {
	return useMutation<LintSqlResult, unknown, { connectionId?: string; sql: string }>({
		retry: 0,
		mutationFn: ({ connectionId, sql }) =>
			veloxDbRepository.lintSql({ connectionId, sql }),
	});
}

export type ExplainPlanTabVariables = {
	connectionId: string;
	engine: DatabaseEngine;
	sql: string;
	allowWrite?: boolean;
	tabId: string;
	flightId: number;
};

type UseExplainPlanMutationOptions = {
	onSuccess?: (result: QueryResult, variables: ExplainPlanTabVariables) => void;
	onError?: (error: unknown, variables: ExplainPlanTabVariables) => void;
	onSettled?: (
		data: QueryResult | undefined,
		error: unknown,
		variables: ExplainPlanTabVariables,
	) => void;
};

export function buildExplainSql(engine: DatabaseEngine, sql: string): string {
	const trimmed = sql.trim();
	const upper = trimmed.toUpperCase();
	if (upper.startsWith("EXPLAIN") || upper.startsWith("PREPARE")) {
		return trimmed;
	}
	if (engine === "postgres") {
		return `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)\n${trimmed}`;
	}
	if (engine === "mysql") {
		return `EXPLAIN FORMAT=TRADITIONAL\n${trimmed}`;
	}
	if (engine === "clickhouse") {
		return `EXPLAIN SYNTAX\n${trimmed}`;
	}
	if (engine === "mssql" || engine === "azuresql") {
		return `SET SHOWPLAN_ALL ON;\n${trimmed}`;
	}
	if (engine === "cassandra" || engine === "scylladb" || engine === "mongo" || engine === "redis") {
		return trimmed;
	}
	return `EXPLAIN QUERY PLAN\n${trimmed}`;
}

/** Runs engine-aware EXPLAIN unless SQL already starts with EXPLAIN/PREPARE. */
export function useExplainPlanMutation(
	options: UseExplainPlanMutationOptions = {},
) {
	return useMutation({
		retry: shouldRetryTransientDbInvoke,
		mutationFn: ({ connectionId, sql, engine, allowWrite }: ExplainPlanTabVariables) => {
			const body = buildExplainSql(engine, sql);
			return veloxDbRepository.runQuery({ connectionId, sql: body, allowWrite });
		},
		onSuccess: (result, variables) => {
			options.onSuccess?.(result, variables);
		},
		onError: (error, variables) => {
			options.onError?.(error, variables);
		},
		onSettled: (data, error, variables) => {
			options.onSettled?.(data, error, variables);
		},
	});
}

type UseSaveResultEditsMutationOptions = {
	onError?: (error: unknown, variables: SaveResultEditsRequest) => void;
};

export function useSaveResultEditsMutation(
	options: UseSaveResultEditsMutationOptions = {},
) {
	return useMutation({
		retry: shouldRetryTransientDbInvoke,
		mutationFn: async (request: SaveResultEditsRequest) => {
			const statements = buildUpdateStatements(request);

			if (statements.length === 0) {
				return;
			}

			await runTransactionalStatements(
				request.connectionId,
				request.engine,
				statements,
			);
		},
		onError: (error, variables) => {
			options.onError?.(error, variables);
		},
	});
}

type UseInsertRowMutationOptions = {
	onError?: (error: unknown, variables: InsertRowRequest) => void;
};

export function useInsertRowMutation(
	options: UseInsertRowMutationOptions = {},
) {
	return useMutation({
		retry: shouldRetryTransientDbInvoke,
		mutationFn: async (request: InsertRowRequest) => {
			const sql = buildInsertStatement(request);
			await veloxDbRepository.runQuery({
				connectionId: request.connectionId,
				sql,
				allowWrite: true,
			});
		},
		onError: (error, variables) => {
			options.onError?.(error, variables);
		},
	});
}

type UseDeleteRowsMutationOptions = {
  onError?: (error: unknown, variables: DeleteRowsRequest) => void;
};

export function useDeleteRowsMutation(
  options: UseDeleteRowsMutationOptions = {},
) {
  return useMutation({
    retry: shouldRetryTransientDbInvoke,
    mutationFn: async (request: DeleteRowsRequest) => {
      const statements = buildDeleteStatements(request);
      if (!statements) {
        return;
      }
      await runTransactionalStatements(
        request.connectionId,
        request.engine,
        statements.split("\n").filter(Boolean),
      );
    },
    onError: (error, variables) => {
      options.onError?.(error, variables);
    },
  });
}
