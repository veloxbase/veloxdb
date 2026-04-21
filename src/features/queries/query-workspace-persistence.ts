export const QUERY_WORKSPACE_STORAGE_KEY = "veloxdb.queryWorkspace.v1";
export const QUERY_WORKSPACE_VERSION = 1 as const;
export const MAX_QUERY_TABS = 20;

export const DEFAULT_QUERY_SQL = `select table_schema, table_name
from information_schema.tables
where table_schema not in ('pg_catalog', 'information_schema')
order by table_schema, table_name
limit 100;`;

export type PersistedQueryTab = {
	title: string;
	sql: string;
	lastExecutedSql: string;
	/** Saved connection for this tab; omit on legacy snapshots. */
	connectionId?: string | null;
};

export type PersistedQueryWorkspace = {
	version: typeof QUERY_WORKSPACE_VERSION;
	tabOrder: string[];
	tabs: Record<string, PersistedQueryTab>;
	activeTabId: string;
};

type LegacyPersistedQueryWorkspace = {
	tabOrder: string[];
	tabs: Record<string, PersistedQueryTab>;
	activeTabId?: string;
	activeLeftTabId?: string;
	activeRightTabId?: string;
	focusedPane?: string;
	split?: string;
};

function resolveLegacyActiveTabId(
	p: LegacyPersistedQueryWorkspace,
): string | undefined {
	if (p.activeTabId && p.tabs[p.activeTabId]) return p.activeTabId;
	if (p.split === "horizontal") {
		const id =
			p.focusedPane === "right" ? p.activeRightTabId : p.activeLeftTabId;
		if (id && p.tabs[id]) return id;
	}
	if (p.activeLeftTabId && p.tabs[p.activeLeftTabId]) return p.activeLeftTabId;
	if (p.activeRightTabId && p.tabs[p.activeRightTabId]) return p.activeRightTabId;
	return p.tabOrder[0];
}

export function readPersistedQueryWorkspace(): PersistedQueryWorkspace | null {
	try {
		const raw = window.localStorage.getItem(QUERY_WORKSPACE_STORAGE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as LegacyPersistedQueryWorkspace & {
			version?: number;
		};
		if (parsed?.version !== QUERY_WORKSPACE_VERSION) return null;
		if (!Array.isArray(parsed.tabOrder) || typeof parsed.tabs !== "object")
			return null;
		if (parsed.tabOrder.length === 0) return null;
		for (const id of parsed.tabOrder) {
			const t = parsed.tabs[id];
			if (!t || typeof t.sql !== "string" || typeof t.title !== "string")
				return null;
			if (
				t.connectionId != null &&
				(typeof t.connectionId !== "string" || t.connectionId === "")
			)
				return null;
		}
		const activeTabId =
			resolveLegacyActiveTabId(parsed) ?? parsed.tabOrder[0] ?? "";
		if (!activeTabId || !parsed.tabs[activeTabId]) return null;
		return {
			version: QUERY_WORKSPACE_VERSION,
			tabOrder: parsed.tabOrder,
			tabs: parsed.tabs,
			activeTabId,
		};
	} catch {
		return null;
	}
}

export function writePersistedQueryWorkspace(
	snapshot: PersistedQueryWorkspace,
) {
	window.localStorage.setItem(
		QUERY_WORKSPACE_STORAGE_KEY,
		JSON.stringify(snapshot),
	);
}

export function toPersistedSnapshot(input: {
	tabOrder: string[];
	tabs: Record<
		string,
		{
			title: string;
			sql: string;
			lastExecutedSql: string;
			connectionId?: string | null;
		}
	>;
	activeTabId: string;
}): PersistedQueryWorkspace {
	const tabs: Record<string, PersistedQueryTab> = {};
	for (const id of input.tabOrder) {
		const t = input.tabs[id];
		if (!t) continue;
		tabs[id] = {
			title: t.title,
			sql: t.sql,
			lastExecutedSql: t.lastExecutedSql,
			...(t.connectionId != null ? { connectionId: t.connectionId } : {}),
		};
	}
	return {
		version: QUERY_WORKSPACE_VERSION,
		tabOrder: [...input.tabOrder],
		tabs,
		activeTabId: input.activeTabId,
	};
}
