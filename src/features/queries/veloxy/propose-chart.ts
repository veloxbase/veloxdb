import type { ChartType, QueryResult, VizConfig } from "@/data/types";
import { VELOXY_MAX_CHART_ROWS, VELOXY_SAMPLE_ROWS } from "@/data/types";
import {
	analyzeColumns,
	recommendChartType,
} from "@/features/dashboards/data/column-analysis";
import {
	buildVizConfig,
	resolveEncodings,
	type RequestedEncodings,
} from "@/features/dashboards/chart-builder-state";
import { coerceQueryResult } from "@/features/dashboards/data/typed-rows";
import { storeChartRows } from "@/features/queries/veloxy/chart-data-cache";

export const VELOXY_CHAT_CHART_TYPES = [
	"line",
	"area",
	"bar",
	"horizontalBar",
	"pie",
	"donut",
	"scatter",
	"heatmap",
	"histogram",
	"box",
	"combo",
	"treemap",
	"gauge",
	"waterfall",
	"kpi",
] as const;

export type VeloxyChatChartType = (typeof VELOXY_CHAT_CHART_TYPES)[number];

export type ProposeChartResult = {
	title: string;
	sql: string;
	viz: Omit<VizConfig, "chartType"> & { chartType: VeloxyChatChartType };
	columns: string[];
	rowCount: number;
	truncated: boolean;
	/** Small sample for the model; the sidebar renders the full rows via chartDataKey. */
	sampleRows: Array<Record<string, string | null>>;
	chartDataKey?: string;
};

export function isVeloxyChatChartType(value: string): value is VeloxyChatChartType {
	return (VELOXY_CHAT_CHART_TYPES as readonly string[]).includes(value);
}

export function resolveVeloxyChartType(
	recommended: ChartType | "table",
	requested?: VeloxyChatChartType,
): VeloxyChatChartType {
	if (requested) return requested;
	if (isVeloxyChatChartType(recommended)) return recommended;
	return "bar";
}

const CHART_INTENT_RE =
	/\b(charts?|plot|plotted|graphs?|visuali[sz]e|visuali[sz]ation|pie|bar chart|line chart|histogram|trends?|over time|breakdown|distribution)\b/i;

/** Heuristic for "the user asked for a chart" used by the sidebar fallback. */
export function hasChartIntent(text: string): boolean {
	return CHART_INTENT_RE.test(text);
}

export function buildProposeChartResult(input: {
	sql: string;
	title?: string;
	chartType?: VeloxyChatChartType;
	encodings?: RequestedEncodings;
	result: QueryResult;
}): ProposeChartResult {
	const chartRows = input.result.rows.slice(0, VELOXY_MAX_CHART_ROWS);
	const full: QueryResult = {
		...input.result,
		rows: chartRows,
		truncated: input.result.truncated || input.result.rows.length > VELOXY_MAX_CHART_ROWS,
	};
	// Analyze and encode against the full result so the recommendation is
	// based on the real data shape, not a 20-row sample.
	const columns = analyzeColumns(coerceQueryResult(full));
	const chartType = resolveVeloxyChartType(recommendChartType(columns), input.chartType);
	const encodings = resolveEncodings(columns, chartType, input.encodings);
	const viz = { ...buildVizConfig(chartType, encodings), chartType };
	const title = input.title?.trim() || "Chart";
	const chartDataKey = storeChartRows(chartRows);

	return {
		title,
		sql: input.sql,
		viz,
		columns: full.columns,
		rowCount: full.rowCount,
		truncated: full.truncated,
		sampleRows: chartRows.slice(0, VELOXY_SAMPLE_ROWS),
		chartDataKey,
	};
}

export function parseProposeChartOutput(output: unknown): ProposeChartResult | null {
	if (!output || typeof output !== "object") return null;
	const value = output as Partial<ProposeChartResult>;
	if (typeof value.sql !== "string" || !value.sql.trim()) return null;
	if (typeof value.title !== "string") return null;
	if (!value.viz || typeof value.viz !== "object") return null;
	if (!isVeloxyChatChartType(value.viz.chartType)) return null;
	if (!Array.isArray(value.columns) || !Array.isArray(value.sampleRows)) return null;
	if (typeof value.rowCount !== "number" || typeof value.truncated !== "boolean") return null;
	return {
		title: value.title,
		sql: value.sql,
		viz: { ...value.viz, chartType: value.viz.chartType },
		columns: value.columns,
		rowCount: value.rowCount,
		truncated: value.truncated,
		sampleRows: value.sampleRows,
		...(typeof value.chartDataKey === "string" ? { chartDataKey: value.chartDataKey } : {}),
	};
}
