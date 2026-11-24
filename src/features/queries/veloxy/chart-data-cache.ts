/**
 * In-memory store for full chart row sets. Tool outputs travel back to the
 * model, so `propose_chart` returns only a small sample plus a key into this
 * cache; the sidebar chart reads the full rows (up to 500) from here. After a
 * restart the chart falls back to re-running the SQL or to the sample rows.
 */
export type ChartRows = Array<Record<string, string | null>>;

const MAX_ENTRIES = 50;

const cache = new Map<string, ChartRows>();
let counter = 0;

export function storeChartRows(rows: ChartRows): string {
	counter += 1;
	const key = `veloxy-chart-${Date.now()}-${counter}`;
	cache.set(key, rows);
	if (cache.size > MAX_ENTRIES) {
		const oldest = cache.keys().next().value;
		if (oldest) cache.delete(oldest);
	}
	return key;
}

export function getChartRows(key: string | undefined | null): ChartRows | null {
	if (!key) return null;
	return cache.get(key) ?? null;
}
