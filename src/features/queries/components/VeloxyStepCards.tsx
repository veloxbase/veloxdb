import {
	CaretDownIcon,
	CaretRightIcon,
	CheckCircleIcon,
	ChartBarIcon,
	CircleNotchIcon,
	PlayIcon,
	WarningCircleIcon,
} from "@phosphor-icons/react";
import type { ToolCallPart } from "@tanstack/ai-client";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
	VeloxyHighlightedSql,
	type VeloxySqlActions,
} from "@/features/queries/components/VeloxyMarkdown";
import {
	schemaToolSummary,
	toolHeadline,
	toolSql,
	toolStatusLabel,
	type ToolStatus,
} from "@/features/queries/veloxy/tool-status";
import { useToolStallClock } from "@/features/queries/veloxy/use-tool-stall-clock";

function StatusIcon({ status }: { status: ToolStatus }) {
	if (status === "running") {
		return (
			<CircleNotchIcon className="size-3 shrink-0 animate-spin text-muted-foreground" aria-hidden />
		);
	}
	if (status === "error") {
		return <WarningCircleIcon className="size-3 shrink-0 text-destructive" aria-hidden />;
	}
	if (status === "stalled") {
		return (
			<WarningCircleIcon
				className="size-3 shrink-0 text-amber-600 dark:text-amber-400"
				aria-hidden
			/>
		);
	}
	return (
		<CheckCircleIcon
			className="size-3 shrink-0 text-emerald-600 dark:text-emerald-400"
			aria-hidden
		/>
	);
}

/** Compact chip summarizing schema lookups: “Looked at 4 tables”. */
export function VeloxySchemaToolGroup({ parts }: { parts: ToolCallPart[] }) {
	useToolStallClock(parts);
	const statuses = parts.map(toolStatusLabel);
	const running = statuses.includes("running");
	const errored = statuses.includes("error");
	const stalled = statuses.includes("stalled");
	const overall: ToolStatus = errored
		? "error"
		: running
			? "running"
			: stalled
				? "stalled"
				: "success";

	const label =
		parts.length === 1
			? toolHeadline(parts[0])
			: running || stalled
				? `Looking at ${parts.length} tables`
				: `Looked at ${parts.length} tables`;

	return (
		<div className="rounded-md border border-border/60 bg-muted/15 px-2.5 py-1.5 text-[11px]">
			<div className="flex items-center gap-1.5 text-foreground">
				<StatusIcon status={overall} />
				<span className="font-medium">{label}</span>
				{stalled && !running ? (
					<span className="text-[10px] text-amber-700 dark:text-amber-400">Taking too long</span>
				) : null}
			</div>
			{parts.length > 1 ? (
				<p className="mt-1 truncate pl-4.5 text-[10px] text-muted-foreground">
					{parts.map((part) => schemaToolSummary(part)).join(" · ")}
				</p>
			) : null}
		</div>
	);
}

type RunReadonlyOutput = {
	columns?: string[];
	rowCount?: number;
	truncated?: boolean;
	executionMs?: number;
	sampleRows?: Array<Record<string, string | null>>;
};

function parseRunReadonlyOutput(output: unknown): RunReadonlyOutput | null {
	if (!output || typeof output !== "object") return null;
	return output as RunReadonlyOutput;
}

const PREVIEW_ROWS = 5;
const PREVIEW_COLUMNS = 4;

function QueryPreviewTable({ output }: { output: RunReadonlyOutput }) {
	const columns = (output.columns ?? []).slice(0, PREVIEW_COLUMNS);
	const hiddenColumns = Math.max(0, (output.columns?.length ?? 0) - columns.length);
	const rows = (output.sampleRows ?? []).slice(0, PREVIEW_ROWS);
	if (columns.length === 0 || rows.length === 0) return null;

	return (
		<div className="overflow-hidden rounded-sm border border-border/60">
			<table className="w-full border-collapse text-[10px]">
				<thead>
					<tr className="bg-muted/40">
						{columns.map((column) => (
							<th
								key={column}
								className="max-w-32 truncate border-b border-border/60 px-1.5 py-1 text-left font-medium text-muted-foreground"
							>
								{column}
							</th>
						))}
						{hiddenColumns > 0 ? (
							<th className="border-b border-border/60 px-1.5 py-1 text-left font-normal text-muted-foreground/70">
								+{hiddenColumns} more
							</th>
						) : null}
					</tr>
				</thead>
				<tbody>
					{rows.map((row, rowIndex) => (
						<tr key={rowIndex} className="odd:bg-background/40">
							{columns.map((column) => (
								<td
									key={column}
									className="max-w-32 truncate px-1.5 py-1 font-mono text-foreground/90"
								>
									{row[column] ?? "∅"}
								</td>
							))}
							{hiddenColumns > 0 ? <td className="px-1.5 py-1 text-muted-foreground/50">…</td> : null}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

function sqlOneLiner(sql: string, max = 72): string {
	const flat = sql.replace(/\s+/g, " ").trim();
	return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/**
 * The artifact card for `run_readonly`: mini result table, SQL behind a
 * toggle, and actions on the card itself.
 */
export function VeloxyQueryCard({
	part,
	sqlActions,
	sqlActionsDisabled,
	onRunSql,
}: {
	part: ToolCallPart;
	sqlActions: VeloxySqlActions;
	sqlActionsDisabled: boolean;
	onRunSql?: (sql: string) => void;
}) {
	useToolStallClock([part]);
	const [showSql, setShowSql] = useState(false);
	const status = toolStatusLabel(part);
	const sql = toolSql(part);
	const output = status === "success" ? parseRunReadonlyOutput(part.output) : null;

	if (status === "running") {
		return (
			<div className="flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/15 px-2.5 py-1.5 text-[11px] text-muted-foreground">
				<CircleNotchIcon className="size-3 shrink-0 animate-spin" aria-hidden />
				<span className="font-medium text-foreground">Querying…</span>
				{sql ? <span className="min-w-0 truncate font-mono text-[10px]">{sqlOneLiner(sql)}</span> : null}
			</div>
		);
	}

	const meta =
		output != null
			? [
					output.rowCount != null
						? `${output.rowCount.toLocaleString()} row${output.rowCount === 1 ? "" : "s"}`
						: null,
					output.executionMs != null ? `${Math.round(output.executionMs)}ms` : null,
					output.truncated ? "sample shown" : null,
				]
					.filter(Boolean)
					.join(" · ")
			: null;

	return (
		<div className="space-y-1.5 rounded-md border border-border/60 bg-muted/15 px-2.5 py-2 text-[11px]">
			<div className="flex items-center gap-1.5">
				<StatusIcon status={status} />
				<span className="font-medium text-foreground">
					{status === "stalled" ? "Taking too long" : status === "error" ? "Query failed" : "Query result"}
				</span>
				{meta ? <span className="text-[10px] text-muted-foreground">{meta}</span> : null}
			</div>

			{status === "stalled" ? (
				<p className="pl-4.5 text-[10px] text-amber-700 dark:text-amber-400">
					No response yet — you can still copy or insert the SQL below.
				</p>
			) : null}
			{status === "error" ? (
				<p className="pl-4.5 text-[10px] text-destructive">
					The query did not finish. The SQL is still available below.
				</p>
			) : null}

			{output ? <QueryPreviewTable output={output} /> : null}

			{sql ? (
				<div className="space-y-1.5">
					<div className="flex items-center gap-1">
						<button
							type="button"
							onClick={() => setShowSql((prev) => !prev)}
							className="flex items-center gap-1 rounded px-1 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
						>
							{showSql ? (
								<CaretDownIcon className="size-2.5" aria-hidden />
							) : (
								<CaretRightIcon className="size-2.5" aria-hidden />
							)}
							{showSql ? "Hide SQL" : "Show SQL"}
						</button>
						{onRunSql ? (
							<Button
								type="button"
								variant="ghost"
								size="sm"
								className="h-5 gap-1 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
								disabled={sqlActionsDisabled}
								onClick={() => onRunSql(sql)}
							>
								<PlayIcon className="size-2.5" aria-hidden />
								Run in editor
							</Button>
						) : null}
					</div>
					{/* Keep the SQL actionable on stall/error so the user can rescue the query. */}
					{showSql || status === "stalled" || status === "error" ? (
						<VeloxyHighlightedSql
							sql={sql}
							sqlActions={sqlActions}
							sqlActionsDisabled={sqlActionsDisabled}
						/>
					) : null}
				</div>
			) : null}
		</div>
	);
}

/** Thin progress line shown only until `propose_chart` produces its output. */
export function VeloxyChartWorking({ part }: { part: ToolCallPart }) {
	useToolStallClock([part]);
	const status = toolStatusLabel(part);
	if (status === "success") return null;

	if (status === "error" || status === "stalled") {
		return (
			<div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
				<WarningCircleIcon
					className={cn(
						"size-3 shrink-0",
						status === "error" ? "text-destructive" : "text-amber-600 dark:text-amber-400",
					)}
					aria-hidden
				/>
				<span>{status === "error" ? "Chart failed" : "Chart is taking too long"}</span>
			</div>
		);
	}

	return (
		<div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
			<ChartBarIcon className="size-3 shrink-0" aria-hidden />
			<span>Drawing a chart…</span>
			<CircleNotchIcon className="size-3 shrink-0 animate-spin" aria-hidden />
		</div>
	);
}

/** Lint/explain are agent internals — render nothing unless they went wrong. */
export function VeloxyQuietToolNote({ part }: { part: ToolCallPart }) {
	useToolStallClock([part]);
	const status = toolStatusLabel(part);
	if (status !== "error" && status !== "stalled") return null;
	return (
		<div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
			<WarningCircleIcon
				className={cn(
					"size-3 shrink-0",
					status === "error" ? "text-destructive" : "text-amber-600 dark:text-amber-400",
				)}
				aria-hidden
			/>
			<span>
				{toolHeadline(part)} {status === "error" ? "failed" : "is taking too long"}
			</span>
		</div>
	);
}
