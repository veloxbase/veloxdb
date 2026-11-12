import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'

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
import { queryKeys } from '@/data/query-keys'
import type { ChartType, QueryResult, Widget } from '@/data/types'
import {
  type BuilderChartType,
  type ChartEncodings,
  applyWidgetPatch,
  buildVizConfig,
  defaultEncodings,
  vizConfigToEncodings,
} from '@/features/dashboards/chart-builder-state'
import { ChartCanvas } from '@/features/dashboards/charts/ChartCanvas'
import { ChartGrainFrame } from '@/features/dashboards/charts/ChartPaperBackdrop'
import { ChartPaperFields } from '@/features/dashboards/charts/ChartPaperFields'
import {
  EMPTY_CHART_PAPER_FIELDS,
  chartPaperConfigFromFields,
  chartPaperFieldsFromConfig,
  parseChartPaperOptions,
  vizOptionsWithPaper,
} from '@/features/dashboards/charts/chart-paper'
import { ChartEncodingFields, type KpiFormatChoice } from '@/features/dashboards/components/ChartEncodingFields'
import { parseKpiFormat } from '@/features/plugins/builtins/viz/kpi'
import { CHART_TYPE_LABELS } from '@/features/dashboards/chart-type-labels'
import { analyzeColumns, recommendChartType } from '@/features/dashboards/data/column-analysis'
import { coerceQueryResult } from '@/features/dashboards/data/typed-rows'
import { getChartPlugin, getDatasetProvider, getKpiPlugin, listVizPlugins } from '@/features/plugins/registry'
import { parseBarLayout, type BarLayoutMode } from '@/features/plugins/builtins/viz/shared'
import { notifySuccess } from '@/lib/error-notifier'
import { hashString } from '@/lib/hash-string'

type WidgetEditorDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  widget: Widget | null
  isDark: boolean
  onSave: (widget: Widget) => void
  onOpenSqlInEditor?: (sql: string) => void
}

function KpiPreview({ value, label }: { value: number | string | null; label: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 px-4 text-center">
      <p className="max-w-full truncate text-[clamp(2.15rem,12vw,3.25rem)] font-black leading-none tabular-nums tracking-[-0.055em] text-foreground">
        {value == null ? '—' : typeof value === 'number' ? value.toLocaleString() : value}
      </p>
      <p className="truncate text-xs text-muted-foreground">{label}</p>
    </div>
  )
}

export function WidgetEditorDialog({
  open,
  onOpenChange,
  widget,
  onSave,
  onOpenSqlInEditor,
}: WidgetEditorDialogProps) {
  const queryClient = useQueryClient()
  const [title, setTitle] = useState('')
  const [chartType, setChartType] = useState<BuilderChartType>('bar')
  const [encodings, setEncodings] = useState<ChartEncodings>({ x: null, y: [], series: null, size: null })
  const [barLayout, setBarLayout] = useState<BarLayoutMode>('stack')
  const [kpiFormat, setKpiFormat] = useState<KpiFormatChoice>('auto')
  const [alertEnabled, setAlertEnabled] = useState(false)
  const [alertThreshold, setAlertThreshold] = useState('0')
  const [alertEmails, setAlertEmails] = useState('')
  const [paperFields, setPaperFields] = useState(EMPTY_CHART_PAPER_FIELDS)
  const initializedRef = useRef(false)

  const sql = widget?.query?.sql ?? ''
  const connectionId = widget?.query?.connectionId ?? ''
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

  useEffect(() => {
    if (!open || !widget) {
      initializedRef.current = false
      return
    }
    if (initializedRef.current) return
    initializedRef.current = true
    setTitle(widget.title)
    if (widget.kind === 'table') {
      setChartType('table')
      setPaperFields(EMPTY_CHART_PAPER_FIELDS)
      return
    }
    const vizType = widget.viz?.chartType ?? 'bar'
    setChartType(vizType)
    setEncodings(vizConfigToEncodings(widget.viz))
    setBarLayout(parseBarLayout(widget.viz?.options) ?? 'stack')
    setKpiFormat(parseKpiFormat(widget.viz?.options) ?? 'auto')
    const alert = widget.viz?.options?.kpiAlert as { enabled?: boolean; threshold?: number; emails?: string[] } | undefined
    setAlertEnabled(Boolean(alert?.enabled))
    setAlertThreshold(String(alert?.threshold ?? 0))
    setAlertEmails((alert?.emails ?? []).join(', '))
    setPaperFields(chartPaperFieldsFromConfig(parseChartPaperOptions(widget.viz?.options)))
  }, [open, widget])

  useEffect(() => {
    if (!open || !previewQuery.data || widget?.kind === 'table') return
    if (widget?.viz) return
    const columns = analyzeColumns(coerceQueryResult(previewQuery.data))
    const recommended = recommendChartType(columns)
    setChartType(recommended)
    setEncodings(defaultEncodings(columns, recommended))
  }, [open, previewQuery.data, widget?.kind, widget?.viz])

  const vizChartType: ChartType | null = chartType !== 'table' ? chartType : null
  const paper = chartPaperConfigFromFields(paperFields)
  const viz = vizChartType
    ? buildVizConfig(
        vizChartType,
        encodings,
        vizOptionsWithPaper(
          { ...widget?.viz?.options, barLayout, kpiFormat: kpiFormat === 'auto' ? undefined : kpiFormat, kpiAlert: chartType === 'kpi' ? {
            enabled: alertEnabled,
            condition: 'value',
            op: 'gt',
            threshold: Number(alertThreshold) || 0,
            cooldownSec: 3600,
            emails: alertEmails.split(',').map((item) => item.trim()).filter(Boolean),
          } : widget?.viz?.options?.kpiAlert },
          paper,
        ),
      )
    : null
  const previewDefinition = useMemo(() => {
    if (!vizChartType || vizChartType === 'kpi' || !previewQuery.data) return null
    const nextViz = buildVizConfig(vizChartType, encodings, { barLayout })
    return getChartPlugin(vizChartType)?.buildChart(previewQuery.data, nextViz) ?? null
  }, [vizChartType, encodings, previewQuery.data, barLayout])

  if (!widget) return null

  const typed = previewQuery.data ? coerceQueryResult(previewQuery.data) : null
  const chartTypeOptions: BuilderChartType[] = widget.kind === 'table'
    ? ['table']
    : [...listVizPlugins().map((plugin) => plugin.chartType)]

  const kpiPreview = viz && vizChartType === 'kpi' && previewQuery.data
    ? getKpiPlugin()?.buildKpi(previewQuery.data, viz) ?? null
    : null

  const handleSave = () => {
    if (!title.trim()) return
    const next = widget.kind === 'table'
      ? applyWidgetPatch(widget, { title: title.trim() })
      : applyWidgetPatch(widget, { title: title.trim(), viz: viz ?? widget.viz })
    onSave(next)
    void queryClient.invalidateQueries({ queryKey: ['widgetData'] })
    notifySuccess('Widget updated')
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl border border-border p-0 sm:max-w-3xl">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle>Edit widget</DialogTitle>
          <DialogDescription>
            Change the title and chart configuration. Edit SQL in the query editor.
            {widget.query?.sql && onOpenSqlInEditor ? (
              <Button
                variant="link"
                className="ml-1 h-auto p-0 text-xs"
                onClick={() => {
                  onOpenSqlInEditor(widget.query!.sql)
                  onOpenChange(false)
                }}
              >
                Open SQL in editor
              </Button>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-4 px-5 py-4 sm:grid-cols-[240px_1fr]">
          <div className="flex flex-col gap-3">
            <div>
              <label htmlFor="widget-editor-title" className="mb-1.5 block text-xs text-muted-foreground">Title</label>
              <Input id="widget-editor-title" value={title} onChange={(e) => setTitle(e.target.value)} autoComplete="off" />
            </div>

            {widget.kind !== 'table' ? (
              <>
                <div>
                  <label htmlFor="widget-editor-type" className="mb-1.5 block text-xs text-muted-foreground">Chart type</label>
                  <select
                    id="widget-editor-type"
                    value={chartType}
                    onChange={(e) => setChartType(e.target.value as BuilderChartType)}
                    className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-xs"
                  >
                    {chartTypeOptions.map((option) => (
                      <option key={option} value={option}>{CHART_TYPE_LABELS[option] ?? option}</option>
                    ))}
                  </select>
                </div>

                {typed ? (
                  <ChartEncodingFields
                    idPrefix="widget-editor"
                    chartType={chartType}
                    columns={typed.columns}
                    encodings={encodings}
                    onEncodingsChange={setEncodings}
                    barLayout={barLayout}
                    onBarLayoutChange={setBarLayout}
                    kpiFormat={kpiFormat}
                    onKpiFormatChange={setKpiFormat}
                  />
                ) : null}

                <ChartPaperFields
                  idPrefix="widget-editor-paper"
                  value={paperFields}
                  onChange={setPaperFields}
                />
                {chartType === 'kpi' ? (
                  <div className="space-y-2 rounded-md border border-border p-2">
                    <label className="flex items-center justify-between text-xs">
                      KPI alert
                      <input type="checkbox" checked={alertEnabled} onChange={(e) => setAlertEnabled(e.target.checked)} />
                    </label>
                    {alertEnabled ? (
                      <>
                        <Input value={alertThreshold} onChange={(e) => setAlertThreshold(e.target.value)} placeholder="Threshold" className="h-8 text-xs" />
                        <Input value={alertEmails} onChange={(e) => setAlertEmails(e.target.value)} placeholder="Emails" className="h-8 text-xs" />
                      </>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : null}
          </div>

          <ChartGrainFrame
            paper={paper}
            enabled={widget.kind !== 'table' && chartType !== 'table'}
            className="h-[240px] border border-border"
          >
            {previewQuery.isLoading ? (
              <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Loading preview…</div>
            ) : previewQuery.isError ? (
              <div className="flex h-full items-center justify-center px-4 text-center text-xs text-destructive">
                {previewQuery.error instanceof Error ? previewQuery.error.message : 'Failed to load preview.'}
              </div>
            ) : widget.kind === 'table' ? (
              <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Table preview uses live data on the canvas.</div>
            ) : chartType === 'kpi' ? (
              <KpiPreview value={kpiPreview?.value ?? null} label={kpiPreview?.label ?? ''} />
            ) : (
              <ChartCanvas definition={previewDefinition} ariaLabel={title.trim() || widget.title} />
            )}
          </ChartGrainFrame>
        </div>

        <DialogFooter className="border-t border-border px-5 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={!title.trim()}>
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
