import type { QueryResult } from "@/data/types";

import {
	DEFAULT_QUERY_SQL,
	MAX_QUERY_TABS,
	type PersistedQueryWorkspace,
	readPersistedQueryWorkspace,
} from "@/features/queries/query-workspace-persistence";

export type QueryTabModel = {
	id: string;
	/** Which saved connection this tab runs against; null until bound to the current session default. */
	connectionId: string | null;
	title: string;
	sql: string;
	lastExecutedSql: string;
	queryResult: QueryResult | null;
	planResult: QueryResult | null;
	resultsSubTab: "results" | "plan";
	runError: string | null;
	planError: string | null;
	/** Increments on each run start; stale responses must match the id at completion. */
	runFlightId: number;
	explainFlightId: number;
	runInFlight: boolean;
	explainInFlight: boolean;
};

export type QueryWorkspaceState = {
	tabOrder: string[];
	tabs: Record<string, QueryTabModel>;
	activeTabId: string;
};

function titleFromSql(sql: string) {
	const line =
		sql
			.split("\n")
			.find((l) => l.trim().length > 0)
			?.trim() ?? "Query";
	return line.length > 28 ? `${line.slice(0, 25)}…` : line;
}

function createTabModel(
	id: string,
	sql: string = DEFAULT_QUERY_SQL,
	connectionId: string | null = null,
): QueryTabModel {
	return {
		id,
		connectionId,
		title: titleFromSql(sql),
		sql,
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

function newTabId() {
	return crypto.randomUUID();
}

export function createDefaultWorkspaceState(): QueryWorkspaceState {
	const id = newTabId();
	const tab = createTabModel(id, DEFAULT_QUERY_SQL, null);
	return {
		tabOrder: [id],
		tabs: { [id]: tab },
		activeTabId: id,
	};
}

function hydrateFromPersisted(p: PersistedQueryWorkspace): QueryWorkspaceState {
	const tabs: Record<string, QueryTabModel> = {};
	for (const id of p.tabOrder) {
		const row = p.tabs[id];
		if (!row) continue;
		tabs[id] = {
			id,
			connectionId: row.connectionId ?? null,
			title: row.title,
			sql: row.sql,
			lastExecutedSql: row.lastExecutedSql ?? "",
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
	const tabOrder = p.tabOrder.filter((id) => tabs[id]);
	if (tabOrder.length === 0) {
		return createDefaultWorkspaceState();
	}

	const firstId = tabOrder[0];
	if (!firstId) {
		return createDefaultWorkspaceState();
	}
	const pick = (id: string | undefined) => (id && tabs[id] ? id : firstId);

	return {
		tabOrder,
		tabs,
		activeTabId: pick(p.activeTabId),
	};
}

export function getFocusedTabId(state: QueryWorkspaceState) {
	return state.activeTabId;
}

export function loadQueryWorkspaceInitialState(): QueryWorkspaceState {
	const persisted = readPersistedQueryWorkspace();
	if (!persisted) {
		return createDefaultWorkspaceState();
	}
	return hydrateFromPersisted(persisted);
}

export type QueryWorkspaceAction =
	| { type: "setSql"; tabId: string; sql: string }
	| { type: "addTab"; connectionId: string | null }
	| { type: "closeTab"; tabId: string }
	| { type: "selectTab"; tabId: string }
	| { type: "setTabConnection"; tabId: string; connectionId: string | null }
	| { type: "setActiveTabConnection"; connectionId: string | null }
	| { type: "setResultsSubTab"; tabId: string; value: "results" | "plan" }
	| {
			type: "runStart";
			tabId: string;
			flightId: number;
	  }
	| {
			type: "runSuccess";
			tabId: string;
			flightId: number;
			executedSql: string;
			result: QueryResult;
	  }
	| { type: "runError"; tabId: string; flightId: number; message: string }
	| { type: "runSettled"; tabId: string; flightId: number }
	| { type: "explainStart"; tabId: string; flightId: number }
	| {
			type: "explainSuccess";
			tabId: string;
			flightId: number;
			result: QueryResult;
	  }
	| { type: "explainError"; tabId: string; flightId: number; message: string }
	| { type: "explainSettled"; tabId: string; flightId: number }
	| {
			type: "applyTablePreview";
			tabId: string;
			sql: string;
			bindConnectionId?: string | null;
	  }
	/** Clear in-flight flags when switching DB connection. */
	| { type: "connectionReset" };

export function queryWorkspaceReducer(
	state: QueryWorkspaceState,
	action: QueryWorkspaceAction,
): QueryWorkspaceState {
	switch (action.type) {
		case "setSql": {
			const tab = state.tabs[action.tabId];
			if (!tab) return state;
			const next: QueryTabModel = {
				...tab,
				sql: action.sql,
				title: titleFromSql(action.sql),
			};
			return { ...state, tabs: { ...state.tabs, [action.tabId]: next } };
		}
		case "addTab": {
			if (state.tabOrder.length >= MAX_QUERY_TABS) return state;
			const id = newTabId();
			const tab = createTabModel(id, DEFAULT_QUERY_SQL, action.connectionId);
			return {
				...state,
				tabOrder: [...state.tabOrder, id],
				tabs: { ...state.tabs, [id]: tab },
				activeTabId: id,
			};
		}
		case "closeTab": {
			if (state.tabOrder.length <= 1) return state;
			const { tabId } = action;
			if (!state.tabs[tabId]) return state;
			const nextOrder = state.tabOrder.filter((id) => id !== tabId);
			const nextTabs = { ...state.tabs };
			delete nextTabs[tabId];

			const firstRemaining = nextOrder[0];
			if (!firstRemaining) {
				return state;
			}
			const activeTabId =
				state.activeTabId === tabId ? firstRemaining : state.activeTabId;

			return {
				...state,
				tabOrder: nextOrder,
				tabs: nextTabs,
				activeTabId,
			};
		}
		case "selectTab": {
			const { tabId } = action;
			if (!state.tabs[tabId]) return state;
			return {
				...state,
				activeTabId: tabId,
			};
		}
		case "setTabConnection": {
			const tab = state.tabs[action.tabId];
			if (!tab) return state;
			return {
				...state,
				tabs: {
					...state.tabs,
					[action.tabId]: { ...tab, connectionId: action.connectionId },
				},
			};
		}
		case "setActiveTabConnection": {
			const tabId = state.activeTabId;
			const tab = state.tabs[tabId];
			if (!tab) return state;
			return {
				...state,
				tabs: {
					...state.tabs,
					[tabId]: { ...tab, connectionId: action.connectionId },
				},
			};
		}
		case "setResultsSubTab": {
			const tab = state.tabs[action.tabId];
			if (!tab) return state;
			return {
				...state,
				tabs: {
					...state.tabs,
					[action.tabId]: { ...tab, resultsSubTab: action.value },
				},
			};
		}
		case "runStart": {
			const tab = state.tabs[action.tabId];
			if (!tab) return state;
			return {
				...state,
				tabs: {
					...state.tabs,
					[action.tabId]: {
						...tab,
						runFlightId: action.flightId,
						runInFlight: true,
						runError: null,
						resultsSubTab: "results",
					},
				},
			};
		}
		case "runSuccess": {
			const tab = state.tabs[action.tabId];
			if (!tab || tab.runFlightId !== action.flightId) return state;
			return {
				...state,
				tabs: {
					...state.tabs,
					[action.tabId]: {
						...tab,
						queryResult: action.result,
						lastExecutedSql: action.executedSql,
						planResult: null,
						runError: null,
						resultsSubTab: "results",
					},
				},
			};
		}
		case "runError": {
			const tab = state.tabs[action.tabId];
			if (!tab || tab.runFlightId !== action.flightId) return state;
			return {
				...state,
				tabs: {
					...state.tabs,
					[action.tabId]: {
						...tab,
						runError: action.message,
						queryResult: null,
					},
				},
			};
		}
		case "runSettled": {
			const tab = state.tabs[action.tabId];
			if (!tab || tab.runFlightId !== action.flightId) return state;
			return {
				...state,
				tabs: {
					...state.tabs,
					[action.tabId]: {
						...tab,
						runInFlight: false,
					},
				},
			};
		}
		case "explainStart": {
			const tab = state.tabs[action.tabId];
			if (!tab) return state;
			return {
				...state,
				tabs: {
					...state.tabs,
					[action.tabId]: {
						...tab,
						explainFlightId: action.flightId,
						explainInFlight: true,
						planError: null,
						resultsSubTab: "plan",
					},
				},
			};
		}
		case "explainSuccess": {
			const tab = state.tabs[action.tabId];
			if (!tab || tab.explainFlightId !== action.flightId) return state;
			return {
				...state,
				tabs: {
					...state.tabs,
					[action.tabId]: {
						...tab,
						planResult: action.result,
						planError: null,
						resultsSubTab: "plan",
					},
				},
			};
		}
		case "explainError": {
			const tab = state.tabs[action.tabId];
			if (!tab || tab.explainFlightId !== action.flightId) return state;
			return {
				...state,
				tabs: {
					...state.tabs,
					[action.tabId]: {
						...tab,
						planError: action.message,
						planResult: null,
					},
				},
			};
		}
		case "explainSettled": {
			const tab = state.tabs[action.tabId];
			if (!tab || tab.explainFlightId !== action.flightId) return state;
			return {
				...state,
				tabs: {
					...state.tabs,
					[action.tabId]: {
						...tab,
						explainInFlight: false,
					},
				},
			};
		}
		case "applyTablePreview": {
			const tab = state.tabs[action.tabId];
			if (!tab) return state;
			const nextConnectionId =
				action.bindConnectionId !== undefined
					? action.bindConnectionId
					: tab.connectionId;
			return {
				...state,
				tabs: {
					...state.tabs,
					[action.tabId]: {
						...tab,
						sql: action.sql,
						title: titleFromSql(action.sql),
						connectionId: nextConnectionId,
					},
				},
			};
		}
		case "connectionReset": {
			const tabs = { ...state.tabs };
			for (const id of state.tabOrder) {
				const t = tabs[id];
				if (!t) continue;
				tabs[id] = {
					...t,
					runInFlight: false,
					explainInFlight: false,
				};
			}
			return { ...state, tabs };
		}
		default:
			return state;
	}
}
