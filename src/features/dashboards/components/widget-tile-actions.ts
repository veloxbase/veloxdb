import type { DraggableAttributes } from '@dnd-kit/core'
import type { SyntheticListenerMap } from '@dnd-kit/core/dist/hooks/utilities'

import type { DashboardVariable, VizConfig, Widget } from '@/data/types'
import type { ChartSelection } from '@/features/plugins/types'

export type WidgetTileActions = {
  onEdit?: () => void
  onDuplicate?: () => void
  onDelete?: () => void
  onToggleLock?: () => void
}

export type WidgetDragHandleProps = {
  dragActivatorRef?: (element: HTMLElement | null) => void
  dragHandleListeners?: SyntheticListenerMap
  dragHandleAttributes?: DraggableAttributes
}

/** Context handed to "Ask about this chart" so the follow-up inherits the tile's query and filters. */
export type WidgetAskContext = {
  widget: Widget
  sql: string
  columns: string[]
  sampleRows: Array<Record<string, string | null>>
  rowCount: number
  activeFilters: Record<string, string>
}

/** App-view interactions shared by every tile: click-to-filter and scoped Ask Veloxy. */
export type WidgetInteractions = {
  variables: DashboardVariable[]
  /** Toggles `variableName` to `value` (or back to its default when already set). */
  onFilter?: (variableName: string, value: string) => void
  onAskVeloxy?: (context: WidgetAskContext) => void
}

/** Variable a chart's x axis filters: `viz.options.filterVariable` override, else a variable named like the column. */
export function resolveFilterVariable(
  viz: VizConfig | null | undefined,
  xColumn: string | null,
  variables: DashboardVariable[],
): DashboardVariable | null {
  const override = viz?.options?.filterVariable
  if (typeof override === 'string') {
    return variables.find((variable) => variable.name === override) ?? null
  }
  if (!xColumn) return null
  const normalized = xColumn.replace(/\W+/g, '_').toLowerCase()
  return variables.find((variable) => variable.name === xColumn || variable.name.toLowerCase() === normalized) ?? null
}

/** Active selection for a tile, derived from the variable the tile filters. */
export function activeSelection(
  variable: DashboardVariable | null,
  xColumn: string | null,
  variableValues: Record<string, string>,
): ChartSelection | null {
  if (!variable || !xColumn) return null
  const value = variableValues[variable.name] ?? variable.defaultValue
  if (!value) return null
  return { column: xColumn, value }
}
