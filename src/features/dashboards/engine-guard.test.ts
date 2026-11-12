import { beforeAll, describe, expect, it } from "vitest";

import type { DatabaseEngine } from "@/data/types";
import { canUseDashboards, dashboardGuardMessage } from "@/features/dashboards/engine-guard";
import { registerBuiltInPlugins } from "@/features/plugins/bootstrap";

const ALLOWED: DatabaseEngine[] = [
	"postgres",
	"mysql",
	"sqlite",
	"duckdb",
	"clickhouse",
	"libsql",
	"turso",
	"mssql",
	"azuresql",
];

const REFUSED: DatabaseEngine[] = ["mongo", "redis", "cassandra", "scylladb"];

beforeAll(() => {
	registerBuiltInPlugins();
});

describe("canUseDashboards", () => {
	it("allows SQL engines Veloxy can query", () => {
		for (const engine of ALLOWED) {
			expect(canUseDashboards(engine), engine).toBe(true);
			expect(dashboardGuardMessage(engine), engine).toBeNull();
		}
	});

	it("refuses Mongo, Redis, and CQL", () => {
		for (const engine of REFUSED) {
			expect(canUseDashboards(engine), engine).toBe(false);
			expect(dashboardGuardMessage(engine), engine).toBe(
				`Dashboards need a SQL SELECT connection. ${engine} isn't supported yet.`,
			);
		}
	});
});
