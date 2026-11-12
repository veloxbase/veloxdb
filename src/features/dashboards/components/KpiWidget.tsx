import { ArrowDownRightIcon, ArrowUpRightIcon } from '@phosphor-icons/react'
import { useMemo } from 'react'

import type { Widget } from '@/data/types'
import { ChartCanvas } from '@/features/dashboards/charts/ChartCanvas'
import { ChartPaperBackdrop } from '@/features/dashboards/charts/ChartPaperBackdrop'
import { parseChartPaperOptions } from '@/features/dashboards/charts/chart-paper'
import { defineKpiSparkline } from '@/features/dashboards/charts/kpi-sparkline'
import { kpiInsight } from '@/features/dashboards/ai/widget-insight'
import { AskVeloxyTileButton, askVeloxyHandler } from '@/features/dashboards/components/AskVeloxyTileButton'
import { WidgetInsightCaption } from '@/features/dashboards/components/WidgetInsightCaption'
import { WidgetShell } from '@/features/dashboards/components/WidgetShell'
import { WidgetTileHeader } from '@/features/dashboards/components/WidgetTileHeader'
import type { WidgetInteractions, WidgetTileActions, WidgetDragHandleProps } from '@/features/dashboards/components/widget-tile-actions'
import { useWidgetData } from '@/features/dashboards/hooks/useWidgetData'
import { formatKpiValue } from '@/features/plugins/builtins/viz/kpi'
import { getKpiPlugin } from '@/features/plugins/registry'
import type { KpiValue } from '@/features/plugins/types'
import { cn } from '@/lib/utils'

type KpiWidgetProps = WidgetDragHandleProps & {
  dashboardId: string
  widget: Widget
  editMode?: boolean
  tileActions?: WidgetTileActions
  variableValues?: Record<string, string>
  interactions?: WidgetInteractions
}

export function KpiDeltaPill({ kpi, className }: { kpi: KpiValue; className?: string }) {
  if (kpi.deltaPct == null) return null
  const up = kpi.deltaPct > 0
  const flat = Math.abs(kpi.deltaPct) < 0.05
  const good = flat ? null : kpi.invertDelta ? !up : up
  const Icon = up ? ArrowUpRightIcon : ArrowDownRightIcon
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums',
        good === null
          ? 'bg-muted text-muted-foreground'
          : good
            ? 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400'
            : 'bg-rose-500/12 text-rose-600 dark:text-rose-400',
        className,
      )}
      title={kpi.previous != null ? `Previous: ${formatKpiValue(kpi.previous, kpi.format)}` : undefined}
    >
      {flat ? null : <Icon className="size-3" weight="bold" />}
      {flat ? '0%' : `${Math.abs(kpi.deltaPct) >= 100 ? Math.round(Math.abs(kpi.deltaPct)) : Math.abs(kpi.deltaPct).toFixed(1)}%`}
    </span>
  )
}

/** Renders the `KpiValue` shape returned by `kpiPlugin.buildKpi()`: value, delta pill, sparkline. */
export function KpiWidget({
  dashboardId,
  widget,
  editMode = false,
  tileActions,
  variableValues = {},
  interactions,
  dragActivatorRef,
  dragHandleListeners,
  dragHandleAttributes,
}: KpiWidgetProps) {
  const dataQuery = useWidgetData(dashboardId, widget, variableValues)
  const viz = widget.viz
  const paper = parseChartPaperOptions(widget.viz?.options)
  const plugin = getKpiPlugin()
  const data = dataQuery.data
  const kpi = useMemo(
    () => (plugin && viz && data ? plugin.buildKpi(data, viz) : null),
    [plugin, viz, data],
  )
  const sparkline = useMemo(() => defineKpiSparkline(kpi?.trend), [kpi])
  const insight = !editMode && kpi ? kpiInsight(kpi) : null

  const body = (
    <WidgetShell
      isError={dataQuery.isError}
      errorMessage={dataQuery.error instanceof Error ? dataQuery.error.message : undefined}
      title={editMode ? undefined : widget.title}
      titleClassName="text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground/55"
      headerActions={editMode ? undefined : (
        <AskVeloxyTileButton widget={widget} data={data} variableValues={variableValues} interactions={interactions} />
      )}
      paper={paper}
      backdrop={<ChartPaperBackdrop paper={paper} />}
    >
      <div className="relative flex h-full flex-col justify-center px-4 pb-3 text-center [container-type:inline-size]">
        {dataQuery.isLoading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : (
          <>
            <div className="flex items-baseline justify-center gap-2">
              <p className="max-w-full truncate text-[clamp(2.15rem,6cqi,3.35rem)] font-black leading-none tabular-nums tracking-[-0.055em] text-foreground">
                {formatKpiValue(kpi?.value ?? null, kpi?.format)}
              </p>
              {kpi ? <KpiDeltaPill kpi={kpi} className="translate-y-[-0.35em]" /> : null}
            </div>
            {insight ? (
              <p className="mt-1 flex justify-center text-[11px]">
                <WidgetInsightCaption insight={insight} />
              </p>
            ) : null}
          </>
        )}
        {sparkline ? (
          <div className="pointer-events-none absolute inset-x-3 bottom-1 h-[28%] min-h-6 opacity-70">
            <ChartCanvas definition={sparkline} ariaLabel={`${widget.title} trend`} />
          </div>
        ) : null}
      </div>
    </WidgetShell>
  )

  if (!editMode || !tileActions) return body

  return (
    <div className="flex h-full min-h-0 flex-col">
      <WidgetTileHeader
        widget={widget}
        draggable={!widget.locked}
        isLoading={dataQuery.isFetching}
        truncated={dataQuery.data?.truncated}
        onRefresh={() => void dataQuery.refetch()}
        onAskVeloxy={askVeloxyHandler(widget, data, variableValues, interactions)}
        dragActivatorRef={dragActivatorRef}
        dragHandleListeners={dragHandleListeners}
        dragHandleAttributes={dragHandleAttributes}
        {...tileActions}
      />
      <div className="dashboard-grid-tile__body dashboard-grid-tile__body--no-events min-h-0 flex-1 overflow-hidden">
        {body}
      </div>
    </div>
  )
}
