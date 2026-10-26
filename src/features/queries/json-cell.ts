/** Content-based detection: result columns carry no type info. Only objects/arrays count. */
export function isJsonValue(v: string | null | undefined): boolean {
	if (typeof v !== "string") return false;
	const s = v.trim();
	if (s[0] !== "{" && s[0] !== "[") return false;
	try {
		JSON.parse(s);
		return true;
	} catch {
		return false;
	}
}

export function formatJsonValue(v: string): string {
	return JSON.stringify(JSON.parse(v), null, 2);
}

export const JSON_NOT_OBJECT_ERROR = "Expected a JSON object or array";

/** Validates user-edited text; stores compact JSON (what DBs normalize to, no whitespace noise in pending edits). */
export function parseJsonInput(
	text: string,
): { ok: true; value: string } | { ok: false; error: string } {
	try {
		const parsed: unknown = JSON.parse(text);
		// Only objects/arrays, matching isJsonValue, so the cell keeps its JSON icon.
		if (parsed === null || typeof parsed !== "object") {
			return { ok: false, error: JSON_NOT_OBJECT_ERROR };
		}
		return { ok: true, value: JSON.stringify(parsed) };
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
}
