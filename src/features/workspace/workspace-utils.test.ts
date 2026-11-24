import { describe, expect, it } from "vitest";

import type { ConnectionSummary } from "@/data/types";

import { resolveWorkspaceFallback } from "@/features/workspace/workspace-utils";

function connection(engine: ConnectionSummary["engine"]): ConnectionSummary {
	return {
		id: "conn-1",
		name: "Test",
		engine,
		host: "localhost",
		port: 5432,
		database: "app",
		user: "user",
		connectedAt: "2026-01-01T00:00:00.000Z",
		sslMode: "disable",
		tablePropertyEditingSupported: true,
	};
}

describe("resolveWorkspaceFallback", () => {
	it("returns null for query workspace", () => {
		expect(resolveWorkspaceFallback("query", {
			showDashboardTab: true,
			connection: connection("postgres"),
		})).toBeNull();
	});

	it("falls back from dashboard when the tab is hidden", () => {
		expect(resolveWorkspaceFallback("dashboard", {
			showDashboardTab: false,
			connection: connection("postgres"),
		})).toBe("query");
	});

	it("keeps dashboard when connection is null", () => {
		expect(resolveWorkspaceFallback("dashboard", {
			showDashboardTab: true,
			connection: null,
		})).toBeNull();
	});

	it("keeps dashboard when entitled and connected", () => {
		expect(resolveWorkspaceFallback("dashboard", {
			showDashboardTab: true,
			connection: connection("postgres"),
		})).toBeNull();
	});

	it("falls back from model when connection is null", () => {
		expect(resolveWorkspaceFallback("model", {
			showDashboardTab: true,
			connection: null,
		})).toBe("query");
	});

	it("falls back from model when engine is not postgres", () => {
		expect(resolveWorkspaceFallback("model", {
			showDashboardTab: true,
			connection: connection("mysql"),
		})).toBe("query");
	});

	it("keeps model when postgres connection is active", () => {
		expect(resolveWorkspaceFallback("model", {
			showDashboardTab: true,
			connection: connection("postgres"),
		})).toBeNull();
	});
});
