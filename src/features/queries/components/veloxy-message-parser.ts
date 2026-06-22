import type { AskVeloxyConversationMessage, AskVeloxyResponse } from "@/data/types";

export type AskVeloxySubmitResult = {
	response: AskVeloxyResponse;
	decision: "auto-ran" | "needs-confirmation";
	decisionReason?: string;
	pendingSql?: string;
};

export type ChatMessage = AskVeloxyConversationMessage & {
	clientNonce?: number;
	streaming?: boolean;
	stoppedEarly?: boolean;
	result?: AskVeloxyResponse;
	decision?: AskVeloxySubmitResult["decision"];
	decisionReason?: string;
	pendingSql?: string;
	suggestions?: string[];
	warnings?: string[];
	needsSqlGeneration?: boolean;
	needsClarification?: boolean;
};

export function extractTextFromUnknown(value: unknown): string | null {
	if (typeof value === "string") {
		const normalized = value.trim();
		return normalized.length > 0 ? normalized : null;
	}
	if (!value || typeof value !== "object") return null;

	const record = value as Record<string, unknown>;
	for (const key of ["message", "reply", "content", "text"]) {
		const text = extractTextFromUnknown(record[key]);
		if (text) return text;
	}
	for (const key of ["output", "response", "data", "result"]) {
		const text = extractTextFromUnknown(record[key]);
		if (text) return text;
	}
	return null;
}

export function unescapeJsonFragment(raw: string): string {
	let out = "";
	for (let i = 0; i < raw.length; i += 1) {
		const ch = raw[i];
		if (ch !== "\\") { out += ch; continue; }
		const next = raw[i + 1];
		if (next === "n") { out += "\n"; i += 1; }
		else if (next === "t") { out += "\t"; i += 1; }
		else if (next === "r") { out += "\r"; i += 1; }
		else if (next === '"') { out += '"'; i += 1; }
		else if (next === "\\") { out += "\\"; i += 1; }
		else if (next != null) { out += `\\${next}`; i += 1; }
		else { out += "\\"; }
	}
	return out;
}

export function extractJsonMessageField(raw: string, allowPartial: boolean): string | null {
	const unwrapped = raw.trim().replace(/^```json\s*/i, "").replace(/\s*```$/, "");
	for (const key of ["message", "reply", "content", "text"]) {
		const marker = `"${key}"`;
		const markerIdx = unwrapped.indexOf(marker);
		if (markerIdx < 0) continue;
		let idx = markerIdx + marker.length;
		while (idx < unwrapped.length && /\s/.test(unwrapped[idx] ?? "")) idx += 1;
		if (unwrapped[idx] !== ":") continue;
		idx += 1;
		while (idx < unwrapped.length && /\s/.test(unwrapped[idx] ?? "")) idx += 1;
		if (unwrapped[idx] !== '"') continue;
		idx += 1;
		const start = idx;
		let escaped = false;
		while (idx < unwrapped.length) {
			const ch = unwrapped[idx];
			if (escaped) { escaped = false; idx += 1; continue; }
			if (ch === "\\") { escaped = true; idx += 1; continue; }
			if (ch === '"') {
				const fragment = unwrapped.slice(start, idx);
				try {
					const decoded = JSON.parse(`"${fragment}"`);
					if (typeof decoded === "string" && decoded.trim()) return decoded.trim();
				} catch {
					const text = unescapeJsonFragment(fragment).trim();
					if (text) return text;
				}
				break;
			}
			idx += 1;
		}
		if (allowPartial && start < unwrapped.length) {
			const text = unescapeJsonFragment(unwrapped.slice(start)).trim();
			if (text) return text;
		}
	}
	return null;
}

export function looksLikeJsonResponse(raw: string): boolean {
	const trimmed = raw.trimStart();
	return trimmed.startsWith("{") || trimmed.startsWith("```");
}

export function normalizeAssistantMessage(raw: string): string {
	const trimmed = raw.trim();
	if (!trimmed) return "";
	const unwrapped = trimmed.replace(/^```json\s*/i, "").replace(/\s*```$/, "");
	try {
		const parsed = JSON.parse(unwrapped);
		return extractTextFromUnknown(parsed) ?? trimmed;
	} catch {
		const extracted = extractJsonMessageField(trimmed, false) ?? extractJsonMessageField(trimmed, true);
		if (extracted) return extracted;
		if (looksLikeJsonResponse(trimmed)) return "";
		return trimmed;
	}
}

export function messageBodyIsSqlDraft(message: ChatMessage): boolean {
	if (message.role !== "assistant" || message.mode !== "action") return false;
	const t = message.text.trimStart().toLowerCase();
	return t.startsWith("select") || t.startsWith("with") || t.startsWith("insert") ||
		t.startsWith("update") || t.startsWith("delete") || t.startsWith("explain");
}

export function truncateSuggestion(text: string, max = 72): string {
	if (text.length <= max) return text;
	return `${text.slice(0, max - 1).trimEnd()}…`;
}
