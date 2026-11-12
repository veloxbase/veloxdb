import { useMemo } from 'react'
import type { ChartPoint } from '@tanstack/charts'

import type { Widget } from '@/data/types'
import { ChartCanvas } from '@/features/dashboards/charts/ChartCanvas'
import { ChartPaperBackdrop } from '@/features/dashboards/charts/ChartPaperBackdrop'
import { parseChartPaperOptions } from '@/features/dashboards/charts/chart-paper'
import { buildWidgetInsight } from '@/features/dashboards/ai/widget-insight'
import { AskVeloxyTileButton, askVeloxyHandler } from '@/features/dashboards/components/AskVeloxyTileButton'
import { WidgetInsightCaption } from '@/features/dashboards/components/WidgetInsightCaption'
import { WidgetShell } from '@/features/dashboards/components/WidgetShell'
import { WidgetTileHeader } from '@/features/dashboards/components/WidgetTileHeader'
import {
  activeSelection,
  resolveFilterVariable,
  type WidgetDragHandleProps,
  type WidgetInteractions,
  type WidgetTileActions,
} from '@/features/dashboards/components/widget-tile-actions'
import type { TypedCellValue } from '@/features/dashboards/data/typed-rows'
import { useWidgetData } from '@/features/dashboards/hooks/useWidgetData'
import { getChartPlugin } from '@/features/plugins/registry'

type ChartWidgetProps = WidgetDragHandleProps & {
  dashboardId: string
  widget: Widget
  editMode?: boolean
  tileActions?: WidgetTileActions
  variableValues?: Record<string, string>
  interactions?: WidgetInteractions
}

function pointRow(point: ChartPoint | null): Record<string, TypedCellValue> | null {
  const datum = point?.datum as { row?: unknown } | undefined
  const row = datum?.row
  return row && typeof row === 'object' ? row as Record<string, TypedCellValue> : null
}

/** Dispatches widget data to the matching `ChartVizPlugin.buildChart()` and renders via `ChartCanvas`. */
export function ChartWidget({
  dashboardId,
  widget,
  editMode = false,
  tileActions,
  variableValues = {},
  interactions,
  dragActivatorRef,
  dragHandleListeners,
  dragHandleAttributes,
}: ChartWidgetProps) {
  const dataQuery = useWidgetData(dashboardId, widget, variableValues)
  const viz = widget.viz
  const plugin = viz ? getChartPlugin(viz.chartType) : undefined
  const paper = parseChartPaperOptions(widget.viz?.options)

  const xColumn = viz?.encodings.x?.column ?? dataQuery.data?.columns[0] ?? null
  const filterVariable = interactions?.onFilter && !editMode
    ? resolveFilterVariable(viz, xColumn, interactions.variables)
    : null
  const selection = activeSelection(filterVariable, xColumn, variableValues)

  const data = dataQuery.data
  const definition = useMemo(() => {
    if (!plugin || !viz || !data) return null
    try {
      return plugin.buildChart(data, viz, { selection })
    } catch (error) {
      console.error(`Failed to build "${widget.title}" chart`, error)
      return null
    }
  }, [plugin, viz, data, selection, widget.title])
  const insight = useMemo(() => (!editMode && data ? buildWidgetInsight(data, viz) : null), [editMode, data, viz])

  const handleSelect = filterVariable && xColumn && interactions?.onFilter
    ? (point: ChartPoint | null) => {
        const row = pointRow(point)
        if (!row) return
        const value = row[xColumn]
        // Temporal axes filter through the date range, not a single click.
        if (value == null || value instanceof Date) return
        interactions.onFilter?.(filterVariable.name, String(value))
      }
    : undefined

  const body = (
    <WidgetShell
      isError={dataQuery.isError}
      errorMessage={dataQuery.error instanceof Error ? dataQuery.error.message : undefined}
      title={editMode ? undefined : widget.title}
      caption={insight ? <WidgetInsightCaption insight={insight} /> : undefined}
      headerActions={editMode ? undefined : (
        <AskVeloxyTileButton widget={widget} data={data} variableValues={variableValues} interactions={interactions} />
      )}
      paper={paper}
      backdrop={<ChartPaperBackdrop paper={paper} />}
    >
      <ChartCanvas
        definition={definition}
        ariaLabel={widget.title}
        loading={dataQuery.isLoading}
        onSelect={handleSelect}
      />
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
