import type { ConnectionSummary } from "@/data/types";

import type { MainWorkspaceId } from "./types";

export function resolveWorkspaceFallback(
	mainWorkspace: MainWorkspaceId,
	opts: {
		showDashboardTab: boolean;
		connection: ConnectionSummary | null;
	},
): MainWorkspaceId | null {
	if (mainWorkspace === "dashboard") {
		if (!opts.showDashboardTab) return "query";
		return null;
	}
	if (mainWorkspace === "model") {
		if (!opts.connection || opts.connection.engine !== "postgres") return "query";
		return null;
	}
	return null;
}

export function getWorkspaceEngineFilter(id: MainWorkspaceId): string[] | undefined {
	switch (id) {
		case "model":
			return ["postgres"];
		default:
			return undefined;
	}
}
