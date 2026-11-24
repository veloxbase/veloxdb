import { VELOXY_SAMPLE_ROWS } from "@/data/types";
import type { VeloxyChatState } from "@/data/types";

const ROW_KEYS = new Set(["rows", "sampleRows"]);

function cloneJson<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

function capRowArrays(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(capRowArrays);
	}
	if (!value || typeof value !== "object") {
		return value;
	}
	const source = value as Record<string, unknown>;
	const next: Record<string, unknown> = {};
	for (const [key, child] of Object.entries(source)) {
		if (ROW_KEYS.has(key) && Array.isArray(child) && child.length > VELOXY_SAMPLE_ROWS) {
			next[key] = child.slice(0, VELOXY_SAMPLE_ROWS);
			continue;
		}
		next[key] = capRowArrays(child);
	}
	return next;
}

function sanitizePart(part: unknown): unknown {
	if (!part || typeof part !== "object") return part;
	const record = part as Record<string, unknown>;
	if (record.type !== "tool-call") return part;
	if (!("output" in record)) return part;
	return { ...record, output: capRowArrays(record.output) };
}

function sanitizeMessage(message: unknown): unknown {
	if (!message || typeof message !== "object") return message;
	const record = message as Record<string, unknown>;
	if (!Array.isArray(record.parts)) return message;
	return { ...record, parts: record.parts.map(sanitizePart) };
}

export function isPersistedChatState(value: unknown): value is VeloxyChatState {
	return (
		typeof value === "object" &&
		value !== null &&
		"messages" in value &&
		Array.isArray((value as VeloxyChatState).messages)
	);
}

export function normalizePersistedChatState(value: unknown): VeloxyChatState | null {
	if (Array.isArray(value)) {
		return { messages: value };
	}
	if (isPersistedChatState(value)) {
		return value;
	}
	return null;
}

/** Drop fat query-result grids before writing chat state to SQLite. */
export function sanitizePersistedChatState(state: VeloxyChatState): VeloxyChatState {
	const cloned = cloneJson(state);
	return {
		...cloned,
		messages: cloned.messages.map(sanitizeMessage),
	};
}
