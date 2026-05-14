import type { QueryResult } from "@/data/types";

import {
	DEFAULT_QUERY_SQL,
	MAX_QUERY_HISTORY_ENTRIES,
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
	queryHistoryByConnection: Record<string, QueryHistoryEntry[]>;
};

export type QueryHistoryEntry = {
	id: string;
	sql: string;
	executedAt: number;
	rowCount?: number;
	executionMs?: number;
	connectionId: string;
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
		queryHistoryByConnection: {},
	};
}

function migrateHistoryEntries(
	raw: Record<string, { sql: string; executedAt: number; id?: string; connectionId?: string; rowCount?: number; executionMs?: number }[]>,
): Record<string, QueryHistoryEntry[]> {
	const result: Record<string, QueryHistoryEntry[]> = {}
	for (const [connId, entries] of Object.entries(raw)) {
		result[connId] = entries.map((e) => ({
			id: e.id ?? crypto.randomUUID(),
			sql: e.sql,
			executedAt: e.executedAt,
			rowCount: e.rowCount,
			executionMs: e.executionMs,
			connectionId: e.connectionId ?? connId,
		}))
	}
	return result
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
		queryHistoryByConnection: migrateHistoryEntries(p.queryHistoryByConnection ?? {}),
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
	/** Replace editor buffer without running; optional connection bind like applyTablePreview. */
	| {
			type: "replaceTabSql";
			tabId: string;
			sql: string;
			bindConnectionId?: string | null;
	  }
	/** Append SQL to the editor without running; optional connection bind. */
	| {
			type: "appendSql";
			tabId: string;
			sql: string;
			bindConnectionId?: string | null;
	  }
	| { type: "addTab"; connectionId: string | null }
	| { type: "closeTab"; tabId: string }
	| { type: "selectTab"; tabId: string }
	| {
			type: "addTabWithSql";
			sql: string;
			connectionId: string | null;
			tabId?: string;
	  }
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
	| {
			type: "pushHistory";
			connectionId: string;
			sql: string;
			executedAt?: number;
			rowCount?: number;
			executionMs?: number;
	  }
	| { type: "explainStart"; tabId: string; flightId: number }
	| {
			type: "explainSuccess";
			tabId: string;
			flightId: number;
			result: QueryResult;
	  }
	| { type: "explainError"; tabId: string; flightId: number; message: string }
	| { type: "clearHistory"; connectionId?: string }
	| { type: "explainSettled"; tabId: string; flightId: number }
	| {
			type: "applyTablePreview";
			tabId: string;
			sql: string;
			bindConnectionId?: string | null;
	  }
	/** Clear in-flight flags when switching DB connection. */
	| { type: "connectionReset" }
	/** After a saved connection is removed, drop it from every tab and history bucket. */
	| { type: "detachDeletedConnection"; connectionId: string };

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
		case "replaceTabSql": {
			const tab = state.tabs[action.tabId];
			if (!tab) return state;
			const nextConnectionId =
				action.bindConnectionId !== undefined
					? action.bindConnectionId
					: tab.connectionId;
			const next: QueryTabModel = {
				...tab,
				sql: action.sql,
				title: titleFromSql(action.sql),
				connectionId: nextConnectionId ?? tab.connectionId,
			};
			return { ...state, tabs: { ...state.tabs, [action.tabId]: next } };
		}
		case "appendSql": {
			const tab = state.tabs[action.tabId];
			if (!tab) return state;
			const nextConnectionId =
				action.bindConnectionId !== undefined
					? action.bindConnectionId
					: tab.connectionId;
			const chunk = action.sql.trim();
			const base = tab.sql.trimEnd();
			const nextSql =
				base.length === 0 ? chunk : `${base}\n\n${chunk}`;
			const next: QueryTabModel = {
				...tab,
				sql: nextSql,
				title: titleFromSql(nextSql),
				connectionId: nextConnectionId ?? tab.connectionId,
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
		case "addTabWithSql": {
			if (state.tabOrder.length >= MAX_QUERY_TABS) return state;
			const id = action.tabId ?? newTabId();
			const tab = createTabModel(id, action.sql, action.connectionId);
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
		case "pushHistory": {
			const sql = action.sql.trim();
			if (!sql) return state;
			const current = state.queryHistoryByConnection[action.connectionId] ?? [];
			const nextEntry: QueryHistoryEntry = {
				id: crypto.randomUUID(),
				sql,
				executedAt: action.executedAt ?? Date.now(),
				rowCount: action.rowCount,
				executionMs: action.executionMs,
				connectionId: action.connectionId,
			};
			const deduped = current.filter((entry) => entry.sql !== sql);
			const next = [nextEntry, ...deduped].slice(0, MAX_QUERY_HISTORY_ENTRIES);
			return {
				...state,
				queryHistoryByConnection: {
					...state.queryHistoryByConnection,
					[action.connectionId]: next,
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
		case "detachDeletedConnection": {
			const { connectionId } = action;
			const nextTabs = { ...state.tabs };
			for (const id of state.tabOrder) {
				const tab = nextTabs[id];
				if (!tab || tab.connectionId !== connectionId) continue;
				nextTabs[id] = { ...tab, connectionId: null };
			}
			const nextHistory = { ...state.queryHistoryByConnection };
			delete nextHistory[connectionId];
			return {
				...state,
				tabs: nextTabs,
				queryHistoryByConnection: nextHistory,
			};
		}
		case "clearHistory": {
			if (action.connectionId) {
				return {
					...state,
					queryHistoryByConnection: {
						...state.queryHistoryByConnection,
						[action.connectionId]: [],
					},
				};
			}
			return { ...state, queryHistoryByConnection: {} };
		}
		default:
			return state;
	}
}
