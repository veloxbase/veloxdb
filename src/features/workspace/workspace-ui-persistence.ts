import type { MainWorkspaceId } from "@/features/workspace/types";

const GLOBAL_KEY = "veloxdb.workspace.lastModeGlobal";

function isMainWorkspaceId(value: unknown): value is MainWorkspaceId {
	return value === "query" || value === "model" || value === "dashboard";
}

export function loadLastWorkspaceMode(_connectionId?: string | null): MainWorkspaceId | null {
	try {
		const global = window.localStorage.getItem(GLOBAL_KEY);
		if (isMainWorkspaceId(global)) return global;
	} catch {
		// ignore
	}
	return null;
}

export function saveLastWorkspaceMode(_connectionId: string | null | undefined, mode: MainWorkspaceId): void {
	try {
		window.localStorage.setItem(GLOBAL_KEY, mode);
	} catch {
		// ignore
	}
}

