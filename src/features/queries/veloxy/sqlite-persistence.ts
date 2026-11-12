import type { ChatClientPersistence, ChatPersistedState } from "@tanstack/ai-client";

import type { VeloxyChatState, VeloxyThread } from "@/data/types";
import { veloxDbRepository } from "@/data/repositories";
import {
	normalizePersistedChatState,
	sanitizePersistedChatState,
} from "@/features/queries/veloxy/sanitize-persisted-state";

const SAVE_DEBOUNCE_MS = 300;
export const VELOXY_LOCAL_STORAGE_PREFIX = "veloxy:";

type PendingWrite = {
	connectionId: string;
	databaseName?: string | null;
	state: VeloxyChatState;
	timer: ReturnType<typeof setTimeout>;
};

const pendingWrites = new Map<string, PendingWrite>();

export function cancelPendingVeloxyWrite(id: string): void {
	const write = pendingWrites.get(id);
	if (!write) return;
	clearTimeout(write.timer);
	pendingWrites.delete(id);
}

export function legacyVeloxyLocalStorageKey(connectionId: string): string {
	return `${VELOXY_LOCAL_STORAGE_PREFIX}veloxy-${connectionId}`;
}

export async function importLegacyVeloxyThread(
	connectionId: string,
	databaseName?: string | null,
): Promise<boolean> {
	if (typeof localStorage === "undefined") return false;
	const key = legacyVeloxyLocalStorageKey(connectionId);
	const raw = localStorage.getItem(key);
	if (!raw) return false;

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		localStorage.removeItem(key);
		return false;
	}

	const state = normalizePersistedChatState(parsed);
	if (!state || state.messages.length === 0) {
		localStorage.removeItem(key);
		return false;
	}

	await veloxDbRepository.saveVeloxyThread({
		id: crypto.randomUUID(),
		connectionId,
		databaseName,
		state: sanitizePersistedChatState(state),
	});
	localStorage.removeItem(key);
	return true;
}

export type VeloxySqlitePersistenceOptions = {
	getConnectionId: () => string | null;
	getDatabaseName: () => string | null | undefined;
	onSaved?: (thread: VeloxyThread) => void;
};

export function createVeloxySqlitePersistence(
	options: VeloxySqlitePersistenceOptions,
): ChatClientPersistence {
	const pending = pendingWrites;

	const flush = (id: string) => {
		const write = pending.get(id);
		if (!write) return;
		pending.delete(id);
		void veloxDbRepository
			.saveVeloxyThread({
				id,
				connectionId: write.connectionId,
				databaseName: write.databaseName,
				state: write.state,
			})
			.then((thread) => {
				options.onSaved?.(thread);
			})
			.catch((error) => {
				console.error("Failed to save Veloxy chat thread", error);
			});
	};

	const queue = (id: string, connectionId: string, state: VeloxyChatState) => {
		const existing = pending.get(id);
		if (existing) clearTimeout(existing.timer);
		pending.set(id, {
			connectionId,
			databaseName: options.getDatabaseName(),
			state,
			timer: setTimeout(() => flush(id), SAVE_DEBOUNCE_MS),
		});
	};

	return {
		async getItem(id) {
			const queued = pending.get(id);
			if (queued) return queued.state as ChatPersistedState;
			try {
				const thread = await veloxDbRepository.loadVeloxyThread(id);
				return thread?.state as ChatPersistedState | undefined;
			} catch {
				return null;
			}
		},
		setItem(id, state) {
			const connectionId = options.getConnectionId();
			if (!connectionId) return;
			if (!state.messages.length) return;
			queue(id, connectionId, sanitizePersistedChatState(state));
		},
		async removeItem(id) {
			cancelPendingVeloxyWrite(id);
			try {
				await veloxDbRepository.deleteVeloxyThread(id);
			} catch (error) {
				console.error("Failed to delete Veloxy chat thread", error);
			}
		},
	};
}
