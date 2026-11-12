import { useCallback, useEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { chat, maxIterations } from "@tanstack/ai";
import type { ChatFetcher } from "@tanstack/ai-client";
import { createOpenRouterText } from "@tanstack/ai-openrouter";
import { useChat } from "@tanstack/ai-react";

import { queryKeys } from "@/data/query-keys";
import type { DatabaseEngine } from "@/data/types";
import { isLocalAiEndpoint } from "@/lib/settings";
import { createVeloxySqlitePersistence } from "@/features/queries/veloxy/sqlite-persistence";
import {
	peekVeloxyForeignKeys,
	peekVeloxyMetadata,
	preloadVeloxyCatalog,
} from "@/features/queries/veloxy/metadata-cache";
import { buildSchemaBrief } from "@/features/queries/veloxy/schema-brief";
import { veloxySystemPrompt } from "@/features/queries/veloxy/system-prompt";
import { veloxyServerTools } from "@/features/queries/veloxy/tool-impl";

const VELOXY_MAX_TOOL_ROUNDS = 6;
/** Hard cap for one user turn (model stream + tools). Prevents 20-minute hangs. */
const VELOXY_TURN_TIMEOUT_MS = 45_000;

function loadSchemaBrief(connectionId: string): string | null {
	const metadata = peekVeloxyMetadata(connectionId);
	if (!metadata) {
		preloadVeloxyCatalog(connectionId);
		return null;
	}
	return buildSchemaBrief({
		metadata,
		foreignKeys: peekVeloxyForeignKeys(connectionId) ?? [],
	});
}

export type UseVeloxyChatOptions = {
	threadId: string;
	connectionId: string | null;
	engine: DatabaseEngine | null;
	databaseName?: string | null;
	targetTable?: { schema: string; name: string } | null;
	model: string;
	apiKey: string;
	baseUrl?: string | null;
};

export function useVeloxyChat({
	threadId,
	connectionId,
	engine,
	databaseName,
	targetTable,
	model,
	apiKey,
	baseUrl,
}: UseVeloxyChatOptions) {
	const queryClient = useQueryClient();
	const ctxRef = useRef({
		connectionId,
		engine,
		databaseName,
		targetTable,
		model,
		apiKey,
		baseUrl,
	});
	useEffect(() => {
		ctxRef.current = {
			connectionId,
			engine,
			databaseName,
			targetTable,
			model,
			apiKey,
			baseUrl,
		};
	}, [connectionId, engine, databaseName, targetTable, model, apiKey, baseUrl]);

	useEffect(() => {
		if (!connectionId) return;
		preloadVeloxyCatalog(connectionId);
	}, [connectionId]);

	const fetcher = useCallback<ChatFetcher>(async ({ messages }, { signal }) => {
		const current = ctxRef.current;
		const abortController = new AbortController();
		const onAbort = () => abortController.abort();
		if (signal.aborted) onAbort();
		else signal.addEventListener("abort", onAbort, { once: true });
		const turnTimer = setTimeout(onAbort, VELOXY_TURN_TIMEOUT_MS);

		if (!current.connectionId || !current.engine) {
			clearTimeout(turnTimer);
			throw new Error("Select a database connection first.");
		}
		const isLocal = isLocalAiEndpoint(current.baseUrl);
		if (!isLocal && !current.apiKey.trim()) {
			clearTimeout(turnTimer);
			throw new Error("Add an API key in Settings, or point Veloxy at a local model.");
		}
		if (!current.model.trim()) {
			clearTimeout(turnTimer);
			throw new Error("Choose a Veloxy model in Settings.");
		}

		const effectiveApiKey = current.apiKey.trim() || (isLocal ? "ollama" : "");
		const openRouterConfig: Record<string, unknown> = {
			httpReferer: "https://github.com/veloxbase/veloxdb",
			appTitle: "VeloxDB",
		};
		if (current.baseUrl?.trim()) {
			openRouterConfig.serverURL = current.baseUrl.trim();
			openRouterConfig.baseURL = current.baseUrl.trim();
		}

		const adapter = createOpenRouterText(
			current.model as Parameters<typeof createOpenRouterText>[0],
			effectiveApiKey,
			openRouterConfig as Parameters<typeof createOpenRouterText>[2],
		);

		const schemaBrief = loadSchemaBrief(current.connectionId);

		return chat({
			adapter,
			messages,
			systemPrompts: [
				veloxySystemPrompt({
					engine: current.engine,
					database: current.databaseName,
					targetTable: current.targetTable,
					schemaBrief,
				}),
			],
			tools: veloxyServerTools,
			context: {
				connectionId: current.connectionId,
				engine: current.engine,
				targetTable: current.targetTable,
			},
			abortController,
			agentLoopStrategy: maxIterations(VELOXY_MAX_TOOL_ROUNDS),
		});
	}, [queryClient]);

	const persistence = useMemo(
		() =>
			createVeloxySqlitePersistence({
				getConnectionId: () => ctxRef.current.connectionId,
				getDatabaseName: () => ctxRef.current.databaseName,
				onSaved: () => {
					const id = ctxRef.current.connectionId;
					if (!id) return;
					void queryClient.invalidateQueries({ queryKey: queryKeys.veloxyThreads(id) });
				},
			}),
		[queryClient],
	);

	return useChat({
		threadId,
		persistence,
		fetcher,
	});
}
