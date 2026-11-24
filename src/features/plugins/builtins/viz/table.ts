/**
 * The "table" fallback isn't a `VizPlugin` — tables are a distinct `WidgetKind`
 * (`Widget.kind === 'table'`), not a chart rendered through ChartCanvas, so there's
 * no `ChartType` value for it. `recommendChartType()` (Phase 2.2) compares every
 * registered `VizPlugin.recommend()` score against this baseline: if no chart
 * plugin scores higher, the table fallback wins and the widget renders via
 * `TableWidget` (Phase 2.3) instead of a chart.
 */
export const TABLE_FALLBACK_SCORE = 0.3
