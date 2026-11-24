import type { DatabaseEngine } from "@/data/types";

export const VELOXY_SQL_ENGINES = [
	"postgres",
	"mysql",
	"sqlite",
	"duckdb",
	"clickhouse",
	"libsql",
	"turso",
	"mssql",
	"azuresql",
	"cassandra",
	"scylladb",
] as const satisfies ReadonlyArray<DatabaseEngine>;

export type VeloxySqlEngine = (typeof VELOXY_SQL_ENGINES)[number];

export const VELOXY_SQL_ENGINE_ERROR =
	"Veloxy tools require a SQL/CQL database (Postgres, MySQL, SQLite, DuckDB, ClickHouse, LibSQL, Turso, MSSQL, Azure SQL, Cassandra, or ScyllaDB).";

export function isVeloxySqlEngine(
	engine: DatabaseEngine | null | undefined,
): engine is VeloxySqlEngine {
	if (!engine) return false;
	return VELOXY_SQL_ENGINES.includes(engine as VeloxySqlEngine);
}

export function assertVeloxySqlEngine(
	engine: DatabaseEngine | null | undefined,
): asserts engine is VeloxySqlEngine {
	if (!isVeloxySqlEngine(engine)) {
		throw new Error(VELOXY_SQL_ENGINE_ERROR);
	}
}
