import { useMutation } from "@tanstack/react-query";

import { veloxDbRepository } from "@/data/repositories";
import type { QueryRequest, QueryResult } from "@/data/types";
import {
	buildUpdateStatements,
	type SaveResultEditsRequest,
} from "@/features/queries/result-edits";
import { shouldRetryTransientDbInvoke } from "@/lib/transient-invoke-retry";

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

export function useRunQueryMutation(options: UseRunQueryMutationOptions = {}) {
	return useMutation({
		retry: shouldRetryTransientDbInvoke,
		mutationFn: ({ connectionId, sql }: RunQueryTabVariables) =>
			veloxDbRepository.runQuery({ connectionId, sql }),
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

export type ExplainPlanTabVariables = {
	connectionId: string;
	sql: string;
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

/** Runs EXPLAIN (ANALYZE, BUFFERS) unless the SQL already starts with EXPLAIN or PREPARE. */
export function useExplainPlanMutation(
	options: UseExplainPlanMutationOptions = {},
) {
	return useMutation({
		retry: shouldRetryTransientDbInvoke,
		mutationFn: ({ connectionId, sql }: ExplainPlanTabVariables) => {
			const trimmed = sql.trim();
			const upper = trimmed.toUpperCase();
			const body =
				upper.startsWith("EXPLAIN") || upper.startsWith("PREPARE")
					? trimmed
					: `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)\n${trimmed}`;
			return veloxDbRepository.runQuery({ connectionId, sql: body });
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

export function useSaveResultEditsMutation() {
	return useMutation({
		retry: shouldRetryTransientDbInvoke,
		mutationFn: async (request: SaveResultEditsRequest) => {
			const statements = buildUpdateStatements(request);

			if (statements.length === 0) {
				return;
			}

			try {
				await veloxDbRepository.runQuery({
					connectionId: request.connectionId,
					sql: `BEGIN;\n${statements.join("\n")}\nCOMMIT;`,
				});
			} catch (error) {
				// Best-effort rollback in case the previous transaction failed mid-flight.
				try {
					await veloxDbRepository.runQuery({
						connectionId: request.connectionId,
						sql: "ROLLBACK;",
					});
				} catch {
					// Ignore rollback failure; surface original save failure to the UI.
				}
				throw error;
			}
		},
	});
}
