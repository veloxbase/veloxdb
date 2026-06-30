import type { MainWorkspaceId } from "./types";

export function getWorkspaceEngineFilter(id: MainWorkspaceId): string[] | undefined {
	switch (id) {
		case "model":
			return ["postgres"];
		default:
			return undefined;
	}
}
