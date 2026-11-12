import { describe, expect, it } from 'vitest'
import {
	assertVeloxySqlEngine,
	isVeloxySqlEngine,
} from './sql-engines'
import { dialectLabel } from './system-prompt'

describe('VELOXY_SQL_ENGINES and isVeloxySqlEngine', () => {
	it('supports all 11 SQL and CQL database engines', () => {
		expect(isVeloxySqlEngine('postgres')).toBe(true)
		expect(isVeloxySqlEngine('mysql')).toBe(true)
		expect(isVeloxySqlEngine('sqlite')).toBe(true)
		expect(isVeloxySqlEngine('duckdb')).toBe(true)
		expect(isVeloxySqlEngine('clickhouse')).toBe(true)
		expect(isVeloxySqlEngine('libsql')).toBe(true)
		expect(isVeloxySqlEngine('turso')).toBe(true)
		expect(isVeloxySqlEngine('mssql')).toBe(true)
		expect(isVeloxySqlEngine('azuresql')).toBe(true)
		expect(isVeloxySqlEngine('cassandra')).toBe(true)
		expect(isVeloxySqlEngine('scylladb')).toBe(true)
	})

	it('returns false for pure non-SQL engines or null/undefined', () => {
		expect(isVeloxySqlEngine('mongo')).toBe(false)
		expect(isVeloxySqlEngine('redis')).toBe(false)
		expect(isVeloxySqlEngine(null)).toBe(false)
		expect(isVeloxySqlEngine(undefined)).toBe(false)
	})

	it('assertVeloxySqlEngine does not throw for supported engines', () => {
		expect(() => assertVeloxySqlEngine('clickhouse')).not.toThrow()
		expect(() => assertVeloxySqlEngine('mssql')).not.toThrow()
		expect(() => assertVeloxySqlEngine('turso')).not.toThrow()
	})

	it('assertVeloxySqlEngine throws for unsupported engines', () => {
		expect(() => assertVeloxySqlEngine('redis')).toThrow(/Veloxy tools require a SQL\/CQL database/)
		expect(() => assertVeloxySqlEngine('mongo')).toThrow(/Veloxy tools require a SQL\/CQL database/)
		expect(() => assertVeloxySqlEngine(null)).toThrow(/Veloxy tools require a SQL\/CQL database/)
	})
})

describe('dialectLabel', () => {
	it('returns clear, engine-appropriate dialect descriptions', () => {
		expect(dialectLabel('postgres')).toBe('PostgreSQL')
		expect(dialectLabel('mysql')).toBe('MySQL')
		expect(dialectLabel('sqlite')).toBe('SQLite')
		expect(dialectLabel('duckdb')).toBe('DuckDB')
		expect(dialectLabel('clickhouse')).toBe('ClickHouse SQL')
		expect(dialectLabel('libsql')).toBe('LibSQL (SQLite)')
		expect(dialectLabel('turso')).toBe('Turso (SQLite)')
		expect(dialectLabel('mssql')).toBe('Microsoft SQL Server (T-SQL)')
		expect(dialectLabel('azuresql')).toBe('Azure SQL (T-SQL)')
		expect(dialectLabel('cassandra')).toBe('Cassandra (CQL)')
		expect(dialectLabel('scylladb')).toBe('ScyllaDB (CQL)')
		expect(dialectLabel('mongo')).toBe('MongoDB')
		expect(dialectLabel('redis')).toBe('Redis CLI')
	})
})
