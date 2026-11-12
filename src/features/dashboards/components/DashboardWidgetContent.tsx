import type { Widget } from '@/data/types'
import { ChartWidget } from '@/features/dashboards/components/ChartWidget'
import { KpiWidget } from '@/features/dashboards/components/KpiWidget'
import { TableWidget } from '@/features/dashboards/components/TableWidget'
import { TextWidget } from '@/features/dashboards/components/TextWidget'
import type { WidgetInteractions, WidgetTileActions, WidgetDragHandleProps } from '@/features/dashboards/components/widget-tile-actions'
import { resolveWidgetRendererKind } from '@/features/dashboards/widget-routing'

type DashboardWidgetContentProps = WidgetDragHandleProps & {
  dashboardId: string
  widget: Widget
  isDark: boolean
  editMode: boolean
  tileActions?: WidgetTileActions
  variableValues: Record<string, string>
  interactions?: WidgetInteractions
}

export function DashboardWidgetContent({
  dashboardId,
  widget,
  editMode,
  tileActions,
  variableValues,
  interactions,
  dragActivatorRef,
  dragHandleListeners,
  dragHandleAttributes,
}: DashboardWidgetContentProps) {
  const kind = resolveWidgetRendererKind(widget)

  const dragHandle = { dragActivatorRef, dragHandleListeners, dragHandleAttributes }

  switch (kind) {
    case 'kpi':
      return (
        <KpiWidget
          dashboardId={dashboardId}
          widget={widget}
          editMode={editMode}
          tileActions={tileActions}
          variableValues={variableValues}
          interactions={interactions}
          {...dragHandle}
        />
      )
    case 'chart':
      return (
        <ChartWidget
          dashboardId={dashboardId}
          widget={widget}
          editMode={editMode}
          tileActions={tileActions}
          variableValues={variableValues}
          interactions={interactions}
          {...dragHandle}
        />
      )
    case 'table':
      return (
        <TableWidget
          dashboardId={dashboardId}
          widget={widget}
          editMode={editMode}
          tileActions={tileActions}
          variableValues={variableValues}
          interactions={interactions}
          {...dragHandle}
        />
      )
    case 'text':
      return (
        <TextWidget
          widget={widget}
          editMode={editMode}
          tileActions={tileActions}
          variableValues={variableValues}
          {...dragHandle}
        />
      )
    default:
      return (
        <div className="flex h-full items-center justify-center border border-dashed border-border p-3 text-xs text-muted-foreground">
          Unsupported widget type: {widget.kind}
        </div>
      )
  }
}
