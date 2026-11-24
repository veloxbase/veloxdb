import { useQuery } from "@tanstack/react-query";

import { VELOXY_MAX_CHART_ROWS } from "@/data/types";
import { veloxDbRepository } from "@/data/repositories";
import { VeloxyProposedChart } from "@/features/queries/components/VeloxyProposedChart";
import {
	buildProposeChartResult,
	type ProposeChartResult,
} from "@/features/queries/veloxy/propose-chart";

type VeloxyAutoChartProps = {
	/** Stable key: the assistant message this chart belongs to. */
	messageId: string;
	sql: string;
	connectionId: string | null;
	/** Only the latest assistant message triggers a query; older ones render from cache. */
	isLast: boolean;
	disabled?: boolean;
	onCopySql: (sql: string) => void;
	onInsertSql: (sql: string) => void;
	onPinToDashboard: (proposal: ProposeChartResult) => void;
};

/**
 * Safety net for chart requests: when the user asked for a chart but the model
 * finished without calling propose_chart, run its final SELECT locally and
 * render the chart inline anyway. Renders nothing if the SQL fails (e.g. it
 * was a write or never executable).
 */
export function VeloxyAutoChart({
	messageId,
	sql,
	connectionId,
	isLast,
	disabled,
	onCopySql,
	onInsertSql,
	onPinToDashboard,
}: VeloxyAutoChartProps) {
	const query = useQuery({
		queryKey: ["veloxyAutoChart", messageId],
		queryFn: async () => {
			const result = await veloxDbRepository.veloxyRunReadonly({
				connectionId: connectionId ?? undefined,
				sql,
				maxRows: VELOXY_MAX_CHART_ROWS,
			});
			if (result.rows.length === 0) return null;
			return buildProposeChartResult({ sql, result });
		},
		enabled: isLast && !!connectionId,
		staleTime: Infinity,
		gcTime: 30 * 60_000,
		retry: false,
	});

	if (!query.data) return null;

	return (
		<div className="mt-2">
			<VeloxyProposedChart
				proposal={query.data}
				connectionId={connectionId}
				disabled={disabled}
				onCopySql={onCopySql}
				onInsertSql={onInsertSql}
				onPinToDashboard={onPinToDashboard}
			/>
		</div>
	);
}
