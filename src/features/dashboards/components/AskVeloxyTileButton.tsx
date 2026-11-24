import { SparkleIcon } from '@phosphor-icons/react'

import { Button } from '@/components/ui/button'
import type { QueryResult, Widget } from '@/data/types'
import type { WidgetAskContext, WidgetInteractions } from '@/features/dashboards/components/widget-tile-actions'
import { substituteSqlVariables } from '@/features/dashboards/substitute-sql-variables'

const SAMPLE_ROWS = 8

export function buildWidgetAskContext(
  widget: Widget,
  data: QueryResult | undefined,
  variableValues: Record<string, string>,
  interactions: WidgetInteractions,
): WidgetAskContext | null {
  const rawSql = widget.query?.sql?.trim()
  if (!rawSql) return null
  const activeFilters: Record<string, string> = {}
  for (const variable of interactions.variables) {
    const value = variableValues[variable.name] ?? variable.defaultValue
    if (rawSql.includes(`{{${variable.name}}}`)) activeFilters[variable.name] = value
  }
  return {
    widget,
    sql: substituteSqlVariables(rawSql, activeFilters),
    columns: data?.columns ?? [],
    sampleRows: data?.rows.slice(0, SAMPLE_ROWS) ?? [],
    rowCount: data?.rowCount ?? 0,
    activeFilters,
  }
}

/** Edit-mode header callback, or undefined when Ask Veloxy is unavailable for this tile. */
export function askVeloxyHandler(
  widget: Widget,
  data: QueryResult | undefined,
  variableValues: Record<string, string>,
  interactions: WidgetInteractions | undefined,
): (() => void) | undefined {
  if (!interactions?.onAskVeloxy || !widget.query?.sql) return undefined
  return () => {
    const context = buildWidgetAskContext(widget, data, variableValues, interactions)
    if (context) interactions.onAskVeloxy?.(context)
  }
}

/** Hover action on app-view tiles that opens Ask Veloxy scoped to the widget's query and filters. */
export function AskVeloxyTileButton({
  widget,
  data,
  variableValues,
  interactions,
}: {
  widget: Widget
  data: QueryResult | undefined
  variableValues: Record<string, string>
  interactions: WidgetInteractions | undefined
}) {
  if (!interactions?.onAskVeloxy || !widget.query?.sql) return null
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      className="text-muted-foreground hover:text-foreground"
      title="Ask Veloxy about this chart"
      aria-label="Ask Veloxy about this chart"
      onClick={(event) => {
        event.stopPropagation()
        const context = buildWidgetAskContext(widget, data, variableValues, interactions)
        if (context) interactions.onAskVeloxy?.(context)
      }}
    >
      <SparkleIcon weight="fill" />
    </Button>
  )
}
