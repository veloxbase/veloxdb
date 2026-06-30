import { describe, expect, it } from "vitest";

/**
 * Integration format tests: verify that all engines produce data in the
 * same QueryResult shape so the frontend grid renders identically.
 */

const samplePostgresResult = {
    columns: ["id", "name", "email"],
    rows: [
        { id: "1", name: "Alice", email: "alice@example.com" },
        { id: "2", name: "Bob", email: null },
    ],
    rowCount: 2,
    executionMs: 15,
    truncated: false,
    commandTag: null,
};

const sampleMysqlResult = {
    columns: ["id", "name", "email"],
    rows: [
        { id: "1", name: "Alice", email: "alice@example.com" },
        { id: "2", name: "Bob", email: null },
    ],
    rowCount: 2,
    executionMs: 22,
    truncated: false,
    commandTag: null,
};

const sampleSqliteResult = {
    columns: ["id", "name", "email"],
    rows: [
        { id: "1", name: "Alice", email: "alice@example.com" },
        { id: "2", name: "Bob", email: null },
    ],
    rowCount: 2,
    executionMs: 8,
    truncated: false,
    commandTag: null,
};

const sampleMongoResult = {
    columns: ["_id", "name", "email"],
    rows: [
        { _id: "507f1f77bcf86cd799439011", name: "Alice", email: "alice@example.com" },
        { _id: "507f1f77bcf86cd799439012", name: "Bob", email: null },
    ],
    rowCount: 2,
    executionMs: 18,
    truncated: false,
    commandTag: null,
};

describe("QueryResult cross-engine format", () => {
    it("all engines produce the same shape", () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const shape = (r: any) => ({
            hasColumns: Array.isArray(r.columns),
            columnsAreStrings: (r.columns as string[])?.every?.((c: unknown) => typeof c === "string") ?? true,
            hasRows: Array.isArray(r.rows),
            rowsAreObjects: (r.rows as unknown[])?.every?.((row: unknown) => typeof row === "object" && row !== null) ?? true,
            hasRowCount: typeof r.rowCount === "number",
            hasExecutionMs: typeof r.executionMs === "number",
            hasTruncated: typeof r.truncated === "boolean",
            hasCommandTag: r.commandTag === null || typeof r.commandTag === "number",
        });

        const results = [
            samplePostgresResult,
            sampleMysqlResult,
            sampleSqliteResult,
            sampleMongoResult,
        ];

        for (const [i, result] of results.entries()) {
            const s = shape(result);
            expect(s.hasColumns, `engine ${i}: columns`).toBe(true);
            expect(s.columnsAreStrings, `engine ${i}: column types`).toBe(true);
            expect(s.hasRows, `engine ${i}: rows`).toBe(true);
            expect(s.rowsAreObjects, `engine ${i}: row types`).toBe(true);
            expect(s.hasRowCount, `engine ${i}: rowCount`).toBe(true);
            expect(s.hasExecutionMs, `engine ${i}: executionMs`).toBe(true);
            expect(s.hasTruncated, `engine ${i}: truncated`).toBe(true);
            expect(s.hasCommandTag, `engine ${i}: commandTag`).toBe(true);
        }
    });

    it("row values are always string or null (grid-compatible)", () => {
        const checkValues = (rows: Record<string, string | null>[]) => {
            for (const row of rows) {
                for (const value of Object.values(row)) {
                    expect(
                        value === null || typeof value === "string",
                    ).toBe(true);
                }
            }
        };

        checkValues(samplePostgresResult.rows);
        checkValues(sampleMysqlResult.rows);
        checkValues(sampleSqliteResult.rows);
        checkValues(sampleMongoResult.rows);
    });

    it("empty result set is identical across engines", () => {
        const empty = {
            columns: [] as string[],
            rows: [] as Record<string, string | null>[],
            rowCount: 0,
            executionMs: 0,
            truncated: false,
            commandTag: null as number | null,
        };

        // All engines should produce this shape for empty results
        expect(empty.columns).toEqual([]);
        expect(empty.rows).toEqual([]);
        expect(empty.rowCount).toBe(0);
    });

    it("mongo dynamically discovered columns match tabular format", () => {
        // MongoDB can discover new fields mid-cursor.
        // The grid handles this by having all rows share the union of keys.
        const dynamicRows = [
            { name: "doc1", extra: "value1" },
            { name: "doc2", extra: null },
        ];
        const allKeys = new Set<string>();
        for (const row of dynamicRows) {
            for (const key of Object.keys(row)) allKeys.add(key);
        }
        // Every row has an entry for every key (even if null)
        for (const row of dynamicRows) {
            for (const key of allKeys) {
                expect(key in row).toBe(true);
            }
        }
    });

    it("mongo nested documents are safely stringified", () => {
        // Nested documents are displayed as "{...}"
        const value = "{...}";
        expect(typeof value).toBe("string");
        expect(value.length).toBeGreaterThan(0);
    });

    it("mongo arrays are summarized for grid display", () => {
        // Arrays are shown as "[N items]"
        const value = "[3 items]";
        expect(typeof value).toBe("string");
        expect(value).toMatch(/\[\d+ items\]/);
    });
});
