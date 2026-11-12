import type { ToolCallPart } from "@tanstack/ai-client";
import { useEffect, useReducer } from "react";

import { toolStallDeadline } from "@/features/queries/veloxy/tool-status";

/**
 * Stall detection is wall-clock based, but React only re-renders on stream
 * updates. Schedule one re-render at the earliest pending stall deadline so a
 * hung tool flips to “Taking too long” without new stream chunks.
 */
export function useToolStallClock(parts: ToolCallPart[]) {
	const [, force] = useReducer((n: number) => n + 1, 0);
	const deadlines = parts
		.map(toolStallDeadline)
		.filter((deadline): deadline is number => deadline != null);
	const next = deadlines.length > 0 ? Math.min(...deadlines) : null;

	useEffect(() => {
		if (next == null) return;
		const delay = next - Date.now();
		if (delay <= 0) return;
		const timer = setTimeout(force, delay + 50);
		return () => clearTimeout(timer);
	}, [next]);
}
