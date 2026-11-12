import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import type { QueryResult } from "@/data/types";
import { VELOXY_MAX_CHART_ROWS } from "@/data/types";
import { veloxDbRepository } from "@/data/repositories";
import { ChartCanvas } from "@/features/dashboards/charts/ChartCanvas";
import { ChartGrainFrame } from "@/features/dashboards/charts/ChartPaperBackdrop";
import { getChartPlugin, getKpiPlugin } from "@/features/plugins/registry";
import { getChartRows, type ChartRows } from "@/features/queries/veloxy/chart-data-cache";
import type { ProposeChartResult } from "@/features/queries/veloxy/propose-chart";

type VeloxyProposedChartProps = {
	proposal: ProposeChartResult;
	connectionId?: string | null;
	disabled?: boolean;
	onCopySql: (sql: string) => void;
	onInsertSql: (sql: string) => void;
	onPinToDashboard: (proposal: ProposeChartResult) => void;
};

function toQueryResult(proposal: ProposeChartResult, rows: ChartRows): QueryResult {
	return {
		columns: proposal.columns,
		rows,
		rowCount: Math.max(proposal.rowCount, rows.length),
		executionMs: 0,
		truncated: proposal.truncated,
		commandTag: null,
	};
}

export function VeloxyProposedChart({
	proposal,
	connectionId,
	disabled,
	onCopySql,
	onInsertSql,
	onPinToDashboard,
}: VeloxyProposedChartProps) {
	const cachedRows = getChartRows(proposal.chartDataKey);
	// Threads persist across restarts but the chart-row cache does not; re-run
	// the (read-only, server-validated) SQL once so restored charts still bind
	// to the full result instead of the 20-row sample.
	const refetch = useQuery({
		queryKey: ["veloxyChartData", connectionId ?? null, proposal.chartDataKey ?? proposal.sql],
		queryFn: () =>
			veloxDbRepository.veloxyRunReadonly({
				connectionId: connectionId ?? undefined,
				sql: proposal.sql,
				maxRows: VELOXY_MAX_CHART_ROWS,
			}),
		enabled: !cachedRows && !!connectionId,
		staleTime: Infinity,
		retry: false,
	});
	const rows = cachedRows ?? refetch.data?.rows ?? proposal.sampleRows;

	const data = useMemo(() => toQueryResult(proposal, rows), [proposal, rows]);
	const isKpi = proposal.viz.chartType === "kpi";
	const definition = useMemo(() => {
		if (proposal.viz.chartType === "kpi") return null;
		return getChartPlugin(proposal.viz.chartType)?.buildChart(data, proposal.viz) ?? null;
	}, [data, proposal.viz]);
	const kpi = isKpi ? getKpiPlugin()?.buildKpi(data, proposal.viz) ?? null : null;

	const truncationNote = proposal.truncated
		? `Showing first ${rows.length.toLocaleString()} rows (result truncated)`
		: rows.length < data.rowCount
			? `Showing ${rows.length.toLocaleString()} of ${data.rowCount.toLocaleString()} rows`
			: null;

	return (
		<div className="space-y-2 rounded-md border border-border/80 bg-background/70 p-2">
			<p className="truncate text-[11px] font-medium text-foreground">{proposal.title}</p>
			<ChartGrainFrame className="h-[180px] w-full rounded-sm border border-border/60">
				{isKpi ? (
					<div className="flex h-full flex-col items-center justify-center gap-1 px-4 text-center">
						<p className="max-w-full truncate text-[clamp(1.85rem,8vw,2.75rem)] font-black leading-none tabular-nums tracking-[-0.055em] text-foreground">
							{kpi?.value == null
								? "—"
								: typeof kpi.value === "number"
									? kpi.value.toLocaleString()
									: kpi.value}
						</p>
						<p className="truncate text-[11px] text-muted-foreground">{kpi?.label ?? proposal.title}</p>
					</div>
				) : (
					<ChartCanvas definition={definition} ariaLabel={proposal.title} />
				)}
			</ChartGrainFrame>
			{truncationNote ? (
				<p className="text-[10px] text-muted-foreground">{truncationNote}</p>
			) : null}
			<div className="flex flex-wrap gap-1.5">
				<Button
					type="button"
					variant="outline"
					size="sm"
					className="h-7 text-[11px]"
					disabled={disabled}
					onClick={() => onCopySql(proposal.sql)}
				>
					Copy SQL
				</Button>
				<Button
					type="button"
					variant="outline"
					size="sm"
					className="h-7 text-[11px]"
					disabled={disabled}
					onClick={() => onInsertSql(proposal.sql)}
				>
					Insert
				</Button>
				<Button
					type="button"
					variant="secondary"
					size="sm"
					className="h-7 text-[11px]"
					disabled={disabled}
					onClick={() => onPinToDashboard(proposal)}
				>
					Pin to dashboard
				</Button>
			</div>
		</div>
	);
}
