import { describe, expect, it } from "vitest";
import type { ToolCallPart } from "@tanstack/ai-client";

import {
	activityLine,
	isToolRunning,
	TOOL_STALL_MS,
	QUERY_TOOL_STALL_MS,
	TOOL_ARG_STREAM_STALL_MS,
	toolHeadline,
	toolStallDeadline,
	toolStatusLabel,
} from "@/features/queries/veloxy/tool-status";

let nextId = 0;

function part(overrides: Partial<ToolCallPart> & Pick<ToolCallPart, "state">): ToolCallPart {
	nextId += 1;
	return {
		type: "tool-call",
		id: `test-${nextId}`,
		name: "describe_table",
		arguments: "{}",
		...overrides,
	};
}

describe("toolStatusLabel", () => {
	it("treats input-complete with output as success, not running", () => {
		const call = part({
			state: "input-complete",
			input: { schema: "public", name: "users" },
			output: { schema: "public", name: "users", columns: [] },
		});
		expect(toolStatusLabel(call)).toBe("success");
		expect(isToolRunning(call)).toBe(false);
	});

	it("treats input-complete without output as running inside the stall window", () => {
		const call = part({
			state: "input-complete",
			input: { schema: "public", name: "users" },
		});
		expect(toolStatusLabel(call)).toBe("running");
		expect(isToolRunning(call)).toBe(true);
	});

	it("flags a call as stalled once the deadline passes", () => {
		const call = part({
			state: "input-complete",
			input: { schema: "public", name: "users" },
		});
		const deadline = toolStallDeadline(call);
		expect(deadline).not.toBeNull();
		expect(deadline! - Date.now()).toBeLessThanOrEqual(TOOL_STALL_MS);

		const original = Date.now;
		Date.now = () => deadline!;
		try {
			expect(toolStatusLabel(call)).toBe("stalled");
			expect(isToolRunning(call)).toBe(false);
		} finally {
			Date.now = original;
		}
	});

	it("uses a longer stall window for SQL tools", () => {
		const call = part({ state: "input-complete", name: "run_readonly" });
		const deadline = toolStallDeadline(call);
		expect(deadline).not.toBeNull();
		expect(deadline! - Date.now()).toBeGreaterThan(TOOL_STALL_MS);
		expect(deadline! - Date.now()).toBeLessThanOrEqual(QUERY_TOOL_STALL_MS);
	});

	it("uses a longer stall window while arguments stream", () => {
		const call = part({ state: "input-streaming" });
		const deadline = toolStallDeadline(call);
		expect(deadline).not.toBeNull();
		expect(deadline! - Date.now()).toBeGreaterThan(TOOL_STALL_MS);
		expect(deadline! - Date.now()).toBeLessThanOrEqual(TOOL_ARG_STREAM_STALL_MS);
		expect(toolStatusLabel(call)).toBe("running");
	});
});

describe("toolHeadline", () => {
	it("uses past tense for finished describes", () => {
		expect(
			toolHeadline(
				part({
					state: "complete",
					input: { schema: "public", name: "users" },
				}),
			),
		).toBe("Looked at public.users");
	});

	it("uses present tense while running", () => {
		expect(
			toolHeadline(
				part({
					state: "input-complete",
					input: { schema: "public", name: "users" },
				}),
			),
		).toBe("Looking at public.users");
	});

	it("labels query results plainly", () => {
		expect(
			toolHeadline(part({ state: "complete", name: "run_readonly", output: { rowCount: 3 } })),
		).toBe("Query result");
	});
});

describe("activityLine", () => {
	it("returns null when not pending", () => {
		expect(activityLine([], false)).toBeNull();
	});

	it("reports schema work", () => {
		const call = part({ state: "input-complete", input: { schema: "public", name: "users" } });
		expect(activityLine([call], true)).toBe("Looking at tables…");
	});

	it("reports query work", () => {
		const call = part({ state: "input-complete", name: "run_readonly" });
		expect(activityLine([call], true)).toBe("Running a query…");
	});

	it("says writing when all tools finished", () => {
		const call = part({ state: "complete", name: "run_readonly", output: { rowCount: 1 } });
		expect(activityLine([call], true)).toBe("Writing the answer…");
	});

	it("says thinking with no tools", () => {
		expect(activityLine([], true)).toBe("Thinking…");
	});
});
