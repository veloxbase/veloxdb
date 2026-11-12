import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { queryKeys } from '@/data/query-keys'
import type { ChartType, Dashboard, QueryResult } from '@/data/types'
import {
  type BuilderChartType,
  type ChartEncodings,
  EMPTY_ENCODINGS,
  buildVizConfig,
  resolveEncodings,
} from '@/features/dashboards/chart-builder-state'
import { ChartCanvas } from '@/features/dashboards/charts/ChartCanvas'
import { ChartGrainFrame } from '@/features/dashboards/charts/ChartPaperBackdrop'
import { ChartPaperFields } from '@/features/dashboards/charts/ChartPaperFields'
import {
  EMPTY_CHART_PAPER_FIELDS,
  chartPaperConfigFromFields,
  vizOptionsWithPaper,
} from '@/features/dashboards/charts/chart-paper'
import { ChartEncodingFields, type KpiFormatChoice } from '@/features/dashboards/components/ChartEncodingFields'
import { KpiDeltaPill } from '@/features/dashboards/components/KpiWidget'
import { formatKpiValue } from '@/features/plugins/builtins/viz/kpi'
import type { KpiValue } from '@/features/plugins/types'
import { CHART_TYPE_LABELS } from '@/features/dashboards/chart-type-labels'
import { analyzeColumns, recommendChartType } from '@/features/dashboards/data/column-analysis'
import { coerceQueryResult } from '@/features/dashboards/data/typed-rows'
import { createEmptyDashboard } from '@/features/dashboards/dashboard-factory'
import { addCell } from '@/features/dashboards/notebook/cell-mutations'
import { useDashboardsQuery, useSaveDashboardMutation } from '@/features/dashboards/queries'
import { getChartPlugin, getDatasetProvider, getKpiPlugin, listVizPlugins } from '@/features/plugins/registry'
import type { BarLayoutMode } from '@/features/plugins/builtins/viz/shared'
import { notifyError, notifySuccess } from '@/lib/error-notifier'
import { hashString } from '@/lib/hash-string'

const NEW_DASHBOARD_OPTION = 'new'

type ChartBuilderDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  connectionId: string
  sql: string
  isDark: boolean
  /** Pre-select this dashboard in the target dropdown when set. */
  preferredDashboardId?: string | null
  /** Initial chart type (e.g. `table` when adding a table widget). */
  defaultChartType?: BuilderChartType
  /** Initial title (e.g. from a Veloxy pin). */
  defaultTitle?: string
  /** Initial X/Y/series from a Veloxy pin; omitted encodings are recommended from the preview. */
  defaultEncodings?: ChartEncodings
  /** Called after the widget is saved so the caller can switch to Dashboard mode and open it. */
  onChartCreated: (dashboardId: string) => void
}

function KpiPreview({ kpi }: { kpi: KpiValue | null }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 px-4 text-center">
      <div className="flex items-baseline gap-2">
        <p className="max-w-full truncate text-[clamp(2.15rem,12vw,3.25rem)] font-black leading-none tabular-nums tracking-[-0.055em] text-foreground">
          {formatKpiValue(kpi?.value ?? null, kpi?.format)}
        </p>
        {kpi ? <KpiDeltaPill kpi={kpi} /> : null}
      </div>
      <p className="truncate text-xs text-muted-foreground">
        {kpi?.label ?? ''}
        {kpi?.trend && kpi.trend.length > 1 ? ` · ${kpi.trend.length}-point trend` : ''}
      </p>
    </div>
  )
}

function TablePreview({ typed }: { typed: ReturnType<typeof coerceQueryResult> }) {
  const previewRows = typed.rows.slice(0, 20)
  return (
    <div className="flex h-full flex-col overflow-auto text-[11px]">
      <table className="w-full border-collapse">
        <thead className="sticky top-0 bg-muted/30">
          <tr>
            {typed.columns.map((column) => (
              <th key={column} className="border-b border-r border-border px-2 py-1 text-left font-medium text-muted-foreground last:border-r-0">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {previewRows.map((row) => {
            const rowKey = typed.columns.map((column) => String(row[column])).join('\u0001')
            return (
              <tr key={rowKey} className="border-b border-border/60">
                {typed.columns.map((column) => (
                  <td key={column} className="truncate border-r border-border/60 px-2 py-1 last:border-r-0">
                    {row[column] === null ? 'NULL' : String(row[column])}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Builds a chart or table widget from a SQL result and appends it to a
 * dashboard (new or existing). Re-uses the same `sql-query` provider and
 * `VizPlugin` contracts the dashboard widgets render with, so the preview
 * matches what ships to the canvas.
 */
export function ChartBuilderDialog({
  open,
  onOpenChange,
  connectionId,
  sql: initialSql,
  preferredDashboardId,
  defaultChartType,
  defaultTitle,
  defaultEncodings,
  onChartCreated,
}: ChartBuilderDialogProps) {
  const [sql, setSql] = useState(initialSql)
  const [chartTypeOverride, setChartTypeOverride] = useState<BuilderChartType | null>(defaultChartType ?? null)
  const [barLayout, setBarLayout] = useState<BarLayoutMode>('stack')
  const [kpiFormat, setKpiFormat] = useState<KpiFormatChoice>('auto')
  const [encodingOverride, setEncodingOverride] = useState<ChartEncodings | null>(defaultEncodings ?? null)
  const [title, setTitle] = useState(defaultTitle?.trim() || 'New chart')
  const [targetOverride, setTargetOverride] = useState<string | null>(null)
  const [newDashboardName, setNewDashboardName] = useState('')
  const [paperFields, setPaperFields] = useState(EMPTY_CHART_PAPER_FIELDS)

  const dashboardsQuery = useDashboardsQuery(connectionId)
  const dashboards = dashboardsQuery.data ?? []
  const preferredTarget = preferredDashboardId && dashboards.some((dashboard) => dashboard.id === preferredDashboardId)
    ? preferredDashboardId
    : null
  const targetDashboardId = targetOverride ?? preferredTarget ?? NEW_DASHBOARD_OPTION

  const sqlHash = hashString(sql)
  const previewQuery = useQuery<QueryResult>({
    queryKey: queryKeys.chartPreview(connectionId, sqlHash),
    queryFn: () => {
      const provider = getDatasetProvider('sql-query')
      if (!provider) throw new Error('SQL preview is unavailable.')
      return provider.fetch({ connectionId, sql }, {})
    },
    enabled: open && Boolean(connectionId && sql.trim()),
    staleTime: 30_000,
  })

  const saveMutation = useSaveDashboardMutation({
    onError: (error) => notifyError(error, { title: 'Failed to create chart' }),
  })

  const typed = previewQuery.data ? coerceQueryResult(previewQuery.data) : null
  const columns = typed ? analyzeColumns(typed) : null
  const chartType = chartTypeOverride ?? (columns ? recommendChartType(columns) : 'bar')
  const encodings = columns
    ? resolveEncodings(columns, chartType, encodingOverride)
    : encodingOverride ?? EMPTY_ENCODINGS
  const chartTypeOptions: BuilderChartType[] = [...listVizPlugins().map((plugin) => plugin.chartType), 'table']

  const vizChartType: ChartType | null = chartType !== 'table' ? chartType : null
  const paper = chartPaperConfigFromFields(paperFields)
  const chartOptions = { barLayout, kpiFormat: kpiFormat === 'auto' ? undefined : kpiFormat }
  const viz = vizChartType ? buildVizConfig(vizChartType, encodings, chartOptions) : null
  const previewDefinition = useMemo(() => {
    if (!vizChartType || vizChartType === 'kpi' || !previewQuery.data) return null
    const nextViz = buildVizConfig(vizChartType, encodings, { barLayout })
    return getChartPlugin(vizChartType)?.buildChart(previewQuery.data, nextViz) ?? null
  }, [vizChartType, encodings, previewQuery.data, barLayout])
  const kpiPreview = viz && vizChartType === 'kpi' && previewQuery.data
    ? getKpiPlugin()?.buildKpi(previewQuery.data, viz) ?? null
    : null

  const handleCreate = () => {
    if (!previewQuery.data || !title.trim()) return

    const widgetId = crypto.randomUUID()
    const sqlCellId = `${widgetId}_sql`
    const outputSlug = title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'query'

    const sqlCell = {
      id: sqlCellId,
      type: 'sql' as const,
      title: `${title.trim()} Query`,
      sql,
      outputName: outputSlug,
      showInApp: false,
    }

    const visualCell = {
      id: widgetId,
      type: 'visual' as const,
      kind: (chartType === 'table' ? 'table' : chartType === 'kpi' ? 'kpi' : 'chart') as 'chart' | 'kpi' | 'table',
      title: title.trim(),
      sourceCellId: sqlCellId,
      viz: chartType === 'table' ? null : buildVizConfig(chartType, encodings, vizOptionsWithPaper(chartOptions, paper)),
      showInApp: true,
    }

    const targetDashboard: Dashboard = targetDashboardId === NEW_DASHBOARD_OPTION
      ? createEmptyDashboard(connectionId, newDashboardName.trim() || `Dashboard ${dashboards.length + 1}`)
      : (dashboards.find((d) => d.id === targetDashboardId) ?? createEmptyDashboard(connectionId, `Dashboard ${dashboards.length + 1}`))

    const updatedDashboard = addCell(addCell(targetDashboard, sqlCell), visualCell)

    saveMutation.mutate(updatedDashboard, {
      onSuccess: (saved) => {
        notifySuccess('Chart added to dashboard')
        onOpenChange(false)
        onChartCreated(saved.id)
      },
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl border border-border p-0 sm:max-w-3xl">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle>Create chart</DialogTitle>
          <DialogDescription>Builds a widget from this query and adds it to a dashboard. The widget re-runs the query at render time.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-4 px-5 py-4 sm:grid-cols-[240px_1fr]">
          <div className="flex flex-col gap-3">
            {!initialSql.trim() ? (
              <div>
                <label htmlFor="chart-builder-sql" className="mb-1.5 block text-xs text-muted-foreground">SQL query</label>
                <Textarea
                  id="chart-builder-sql"
                  value={sql}
                  onChange={(e) => setSql(e.target.value)}
                  rows={4}
                  className="font-mono text-xs"
                  placeholder="SELECT …"
                />
              </div>
            ) : null}

            <div>
              <label htmlFor="chart-builder-title" className="mb-1.5 block text-xs text-muted-foreground">Title</label>
              <Input id="chart-builder-title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus autoComplete="off" />
            </div>

            <div>
              <label htmlFor="chart-builder-type" className="mb-1.5 block text-xs text-muted-foreground">Chart type</label>
              <select
                id="chart-builder-type"
                value={chartType}
                onChange={(e) => setChartTypeOverride(e.target.value as BuilderChartType)}
                className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-xs shadow-sm transition-colors focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {chartTypeOptions.map((option) => (
                  <option key={option} value={option}>{CHART_TYPE_LABELS[option] ?? option}</option>
                ))}
              </select>
            </div>

            {typed && chartType !== 'table' ? (
              <ChartEncodingFields
                idPrefix="chart-builder"
                chartType={chartType}
                columns={typed.columns}
                encodings={encodings}
                onEncodingsChange={setEncodingOverride}
                barLayout={barLayout}
                onBarLayoutChange={setBarLayout}
                kpiFormat={kpiFormat}
                onKpiFormatChange={setKpiFormat}
              />
            ) : null}

            {chartType !== 'table' ? (
              <ChartPaperFields
                idPrefix="chart-builder-paper"
                value={paperFields}
                onChange={setPaperFields}
              />
            ) : null}

            <div className="mt-1 border-t border-border pt-3">
              <label htmlFor="chart-builder-dashboard" className="mb-1.5 block text-xs text-muted-foreground">Add to dashboard</label>
              <select
                id="chart-builder-dashboard"
                value={targetDashboardId}
                onChange={(e) => setTargetOverride(e.target.value)}
                className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-xs shadow-sm transition-colors focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value={NEW_DASHBOARD_OPTION}>+ New dashboard</option>
                {dashboards.map((dashboard) => (
                  <option key={dashboard.id} value={dashboard.id}>{dashboard.name}</option>
                ))}
              </select>
              {targetDashboardId === NEW_DASHBOARD_OPTION ? (
                <Input
                  className="mt-2"
                  placeholder={`Dashboard ${dashboards.length + 1}`}
                  value={newDashboardName}
                  onChange={(e) => setNewDashboardName(e.target.value)}
                  autoComplete="off"
                />
              ) : null}
            </div>
          </div>

          <ChartGrainFrame
            paper={paper}
            enabled={chartType !== 'table'}
            className="h-[280px] border border-border"
          >
            {previewQuery.isLoading ? (
              <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Loading preview…</div>
            ) : previewQuery.isError ? (
              <div className="flex h-full items-center justify-center px-4 text-center text-xs text-destructive">
                {previewQuery.error instanceof Error ? previewQuery.error.message : 'Failed to load preview.'}
              </div>
            ) : !typed || typed.columns.length === 0 ? (
              <div className="flex h-full items-center justify-center text-xs text-muted-foreground">No data</div>
            ) : chartType === 'table' ? (
              <TablePreview typed={typed} />
            ) : chartType === 'kpi' ? (
              <KpiPreview kpi={kpiPreview} />
            ) : (
              <ChartCanvas definition={previewDefinition} ariaLabel={title.trim() || 'Chart preview'} />
            )}
          </ChartGrainFrame>
        </div>

        <DialogFooter className="border-t border-border px-5 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleCreate} disabled={!previewQuery.data || !title.trim() || saveMutation.isPending}>
            Create chart
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
