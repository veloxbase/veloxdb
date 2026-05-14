import { describe, expect, it } from "vitest";

import {
	queryWorkspaceReducer,
	type QueryTabModel,
	type QueryWorkspaceState,
} from "@/features/queries/query-workspace-state";

function tab(id: string, connectionId: string | null): QueryTabModel {
	return {
		id,
		connectionId,
		title: "t",
		sql: "select 1",
		lastExecutedSql: "",
		queryResult: null,
		planResult: null,
		resultsSubTab: "results",
		runError: null,
		planError: null,
		runFlightId: 0,
		explainFlightId: 0,
		runInFlight: false,
		explainInFlight: false,
	};
}

describe("detachDeletedConnection", () => {
	it("clears the deleted connection from every tab and drops its history bucket", () => {
		const deleted = "conn-deleted";
		const kept = "conn-kept";
		const tabA = "tab-a";
		const tabB = "tab-b";
		const initial: QueryWorkspaceState = {
			tabOrder: [tabA, tabB],
			tabs: {
				[tabA]: tab(tabA, deleted),
				[tabB]: tab(tabB, kept),
			},
			activeTabId: tabA,
			queryHistoryByConnection: {
				[deleted]: [
					{
						id: "h1",
						sql: "select 1",
						executedAt: 1,
						connectionId: deleted,
					},
				],
				[kept]: [
					{
						id: "h2",
						sql: "select 2",
						executedAt: 2,
						connectionId: kept,
					},
				],
			},
		};

		const next = queryWorkspaceReducer(initial, {
			type: "detachDeletedConnection",
			connectionId: deleted,
		});

		expect(next.tabs[tabA]?.connectionId).toBeNull();
		expect(next.tabs[tabB]?.connectionId).toBe(kept);
		expect(next.queryHistoryByConnection[deleted]).toBeUndefined();
		expect(next.queryHistoryByConnection[kept]?.length).toBe(1);
	});
});
