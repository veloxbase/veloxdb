import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	QUERY_WORKSPACE_STORAGE_KEY,
	readPersistedQueryWorkspace,
	toPersistedSnapshot,
	writePersistedQueryWorkspace,
} from "./query-workspace-persistence";

describe("query-workspace-persistence", () => {
	let mockStore: Record<string, string> = {};

	beforeEach(() => {
		mockStore = {};
		const mockStorage = {
			getItem: (key: string) => mockStore[key] ?? null,
			setItem: (key: string, value: string) => {
				mockStore[key] = value;
			},
			removeItem: (key: string) => {
				delete mockStore[key];
			},
			clear: () => {
				mockStore = {};
			},
			key: (_i: number) => null,
			length: 0,
		} as Storage;

		(globalThis as unknown as { window: { localStorage: Storage } }).window = {
			localStorage: mockStorage,
		};
	});

	afterEach(() => {
		delete (globalThis as unknown as { window?: unknown }).window;
	});

	it("round-trips a workspace snapshot including SQL", () => {
		const snapshot = toPersistedSnapshot({
			tabOrder: ["tab-1"],
			tabs: {
				"tab-1": {
					title: "select 1",
					sql: "select 1 from users",
					lastExecutedSql: "select 1 from users",
					connectionId: "conn-1",
				},
			},
			activeTabId: "tab-1",
			queryHistoryByConnection: {},
		});

		writePersistedQueryWorkspace(snapshot);
		expect(mockStore[QUERY_WORKSPACE_STORAGE_KEY]).toBeTruthy();

		const restored = readPersistedQueryWorkspace();
		expect(restored?.tabs["tab-1"]?.sql).toBe("select 1 from users");
		expect(restored?.tabs["tab-1"]?.connectionId).toBe("conn-1");
		expect(restored?.activeTabId).toBe("tab-1");
	});
});
