import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
} from '@dnd-kit/core'
import { useCallback, useMemo, useRef, useState } from 'react'

import type { Dashboard, WidgetLayout } from '@/data/types'
import { DashboardGridTile } from '@/features/dashboards/components/DashboardGridTile'
import type { WidgetInteractions, WidgetTileActions } from '@/features/dashboards/components/widget-tile-actions'
import { mergeLayoutChange } from '@/features/dashboards/dashboard-layout'
import { moveItem, resizeItem } from '@/features/dashboards/grid/grid-layout-engine'
import {
  createGridMetrics,
  layoutMinHeight,
  pixelSizeToGrid,
  pixelToGrid,
  slotToRect,
} from '@/features/dashboards/grid/grid-metrics'
import { useGridContainerWidth } from '@/features/dashboards/hooks/useGridContainerWidth'

import './dashboard-grid.css'

type DashboardGridProps = {
  dashboardId: string
  draft: Dashboard
  isDark: boolean
  editMode: boolean
  variableValues: Record<string, string>
  interactions?: WidgetInteractions
  onDraftChange: (next: Dashboard) => void
  onEditWidget: (widgetId: string) => void
  onDuplicateWidget: (widgetId: string) => void
  onDeleteWidget: (widgetId: string) => void
  onToggleLock: (widgetId: string) => void
}

function layoutsEqual(a: WidgetLayout[], b: WidgetLayout[]): boolean {
  if (a.length !== b.length) return false
  return a.every((slot) => {
    const other = b.find((item) => item.i === slot.i)
    if (!other) return false
    return slot.x === other.x
      && slot.y === other.y
      && slot.w === other.w
      && slot.h === other.h
      && Boolean(slot.isStatic) === Boolean(other.isStatic)
  })
}

export function DashboardGrid({
  dashboardId,
  draft,
  isDark,
  editMode,
  variableValues,
  interactions,
  onDraftChange,
  onEditWidget,
  onDuplicateWidget,
  onDeleteWidget,
  onToggleLock,
}: DashboardGridProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const width = useGridContainerWidth(containerRef)
  const draftRef = useRef(draft)
  draftRef.current = draft

  const [placeholder, setPlaceholder] = useState<WidgetLayout | null>(null)

  const metrics = useMemo(
    () => (width > 0 ? createGridMetrics(width) : null),
    [width],
  )

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  )

  const applyLayout = useCallback((nextLayout: WidgetLayout[]) => {
    const merged = mergeLayoutChange(draftRef.current, nextLayout)
    if (!layoutsEqual(draftRef.current.layout, merged.layout)) {
      onDraftChange(merged)
    }
  }, [onDraftChange])

  const updatePlaceholder = useCallback((event: DragMoveEvent | DragEndEvent) => {
    if (!metrics) return
    const slot = draftRef.current.layout.find((item) => item.i === event.active.id)
    if (!slot) return
    const rect = slotToRect(metrics, slot)
    const { x, y } = pixelToGrid(
      metrics,
      rect.top + event.delta.y,
      rect.left + event.delta.x,
      slot.w,
      slot.h,
    )
    setPlaceholder({ ...slot, x, y })
  }, [metrics])

  const handleDragMove = useCallback((event: DragMoveEvent) => {
    updatePlaceholder(event)
  }, [updatePlaceholder])

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setPlaceholder(null)
    if (!metrics) return
    const slot = draftRef.current.layout.find((item) => item.i === event.active.id)
    if (!slot || slot.isStatic || draftRef.current.widgets[slot.i]?.locked) return

    const rect = slotToRect(metrics, slot)
    const { x, y } = pixelToGrid(
      metrics,
      rect.top + event.delta.y,
      rect.left + event.delta.x,
      slot.w,
      slot.h,
    )
    if (x === slot.x && y === slot.y) return

    const nextLayout = moveItem(draftRef.current.layout, draftRef.current.widgets, slot.i, x, y)
    applyLayout(nextLayout)
  }, [applyLayout, metrics])

  const handleDragCancel = useCallback(() => {
    setPlaceholder(null)
  }, [])

  const handleResizeCommit = useCallback((itemId: string, pixelWidth: number, pixelHeight: number) => {
    if (!metrics) return
    const slot = draftRef.current.layout.find((item) => item.i === itemId)
    if (!slot) return
    const { w, h } = pixelSizeToGrid(metrics, pixelWidth, pixelHeight, slot.x, slot.y)
    if (w === slot.w && h === slot.h) return

    const nextLayout = resizeItem(draftRef.current.layout, draftRef.current.widgets, itemId, w, h)
    applyLayout(nextLayout)
  }, [applyLayout, metrics])

  const canvasClassName = editMode
    ? 'dashboard-grid-canvas dashboard-grid-canvas--editing'
    : 'dashboard-grid-canvas'

  const surfaceHeight = metrics ? layoutMinHeight(metrics, draft.layout) : 0
  const placeholderRect = placeholder && metrics ? slotToRect(metrics, placeholder) : null

  return (
    <div ref={containerRef} className={`min-h-0 flex-1 overflow-auto p-4 ${canvasClassName}`}>
      {metrics ? (
        <DndContext
          sensors={sensors}
          onDragMove={handleDragMove}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <div
            className="dashboard-grid-surface relative"
            style={{ minHeight: surfaceHeight }}
          >
            {placeholderRect ? (
              <div
                className="dashboard-grid-placeholder pointer-events-none absolute rounded-md"
                style={{
                  left: placeholderRect.left,
                  top: placeholderRect.top,
                  width: placeholderRect.width,
                  height: placeholderRect.height,
                }}
              />
            ) : null}

            {draft.layout.map((slot) => {
              const widget = draft.widgets[slot.i]
              if (!widget) return null

              const tileActions: WidgetTileActions | undefined = editMode
                ? {
                  onEdit: () => onEditWidget(widget.id),
                  onDuplicate: () => onDuplicateWidget(widget.id),
                  onDelete: () => onDeleteWidget(widget.id),
                  onToggleLock: () => onToggleLock(widget.id),
                }
                : undefined

              return (
                <DashboardGridTile
                  key={slot.i}
                  dashboardId={dashboardId}
                  slot={slot}
                  widget={widget}
                  metrics={metrics}
                  rect={slotToRect(metrics, slot)}
                  isDark={isDark}
                  editMode={editMode}
                  tileActions={tileActions}
                  variableValues={variableValues}
                  interactions={interactions}
                  onResizeCommit={handleResizeCommit}
                />
              )
            })}
          </div>
        </DndContext>
      ) : null}
    </div>
  )
}
