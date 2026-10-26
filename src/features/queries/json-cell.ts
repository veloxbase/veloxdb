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
