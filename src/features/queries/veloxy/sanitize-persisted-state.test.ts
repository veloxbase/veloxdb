import { describe, expect, it } from "vitest";

import { VELOXY_SAMPLE_ROWS } from "@/data/types";
import {
	normalizePersistedChatState,
	sanitizePersistedChatState,
} from "@/features/queries/veloxy/sanitize-persisted-state";

describe("sanitizePersistedChatState", () => {
	it("caps tool-call row arrays and keeps sql plus chart keys", () => {
		const rows = Array.from({ length: 80 }, (_, index) => ({ n: String(index) }));
		const sanitized = sanitizePersistedChatState({
			messages: [
				{
					id: "a1",
					role: "assistant",
					parts: [
						{
							type: "tool-call",
							name: "propose_chart",
							output: {
								sql: "select 1",
								chartDataKey: "veloxy-chart-1",
								sampleRows: rows,
								rows,
							},
						},
					],
				},
			],
		});

		const part = (sanitized.messages[0] as { parts: Array<{ output: Record<string, unknown> }> })
			.parts[0];
		expect(part.output.sql).toBe("select 1");
		expect(part.output.chartDataKey).toBe("veloxy-chart-1");
		expect(part.output.sampleRows).toHaveLength(VELOXY_SAMPLE_ROWS);
		expect(part.output.rows).toHaveLength(VELOXY_SAMPLE_ROWS);
	});

	it("leaves text parts unchanged", () => {
		const sanitized = sanitizePersistedChatState({
			messages: [
				{
					id: "u1",
					role: "user",
					parts: [{ type: "text", content: "Show revenue" }],
				},
			],
		});
		expect(sanitized.messages).toEqual([
			{
				id: "u1",
				role: "user",
				parts: [{ type: "text", content: "Show revenue" }],
			},
		]);
	});
});

describe("normalizePersistedChatState", () => {
	it("accepts a legacy bare message array", () => {
		const state = normalizePersistedChatState([{ id: "u1", role: "user", parts: [] }]);
		expect(state?.messages).toHaveLength(1);
	});

	it("rejects unrelated json", () => {
		expect(normalizePersistedChatState({ not: "chat" })).toBeNull();
	});
});
