import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { useCallback, useEffect, useRef } from 'react'
import Moveable from 'react-moveable'

import { ErrorBoundary } from '@/components/ErrorBoundary'
import type { Widget, WidgetLayout } from '@/data/types'
import { DashboardWidgetContent } from '@/features/dashboards/components/DashboardWidgetContent'
import type { WidgetInteractions, WidgetTileActions } from '@/features/dashboards/components/widget-tile-actions'
import type { GridMetrics, GridRect } from '@/features/dashboards/grid/grid-metrics'
import { snapGridSteps } from '@/features/dashboards/grid/grid-metrics'

type DashboardGridTileProps = {
  dashboardId: string
  slot: WidgetLayout
  widget: Widget
  metrics: GridMetrics
  rect: GridRect
  isDark: boolean
  editMode: boolean
  tileActions?: WidgetTileActions
  variableValues: Record<string, string>
  interactions?: WidgetInteractions
  onResizeCommit: (itemId: string, width: number, height: number) => void
}

export function DashboardGridTile({
  dashboardId,
  slot,
  widget,
  metrics,
  rect,
  isDark,
  editMode,
  tileActions,
  variableValues,
  interactions,
  onResizeCommit,
}: DashboardGridTileProps) {
  const tileRef = useRef<HTMLDivElement>(null)
  const locked = Boolean(slot.isStatic || widget.locked)
  const canInteract = editMode && !locked

  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    isDragging,
  } = useDraggable({
    id: slot.i,
    disabled: !canInteract,
  })

  const setTileRef = useCallback(
    (node: HTMLDivElement | null) => {
      tileRef.current = node
      setNodeRef(node)
    },
    [setNodeRef],
  )

  useEffect(() => {
    const node = tileRef.current
    if (!node || isDragging) return
    node.style.width = `${rect.width}px`
    node.style.height = `${rect.height}px`
    node.style.transform = ''
  }, [rect.width, rect.height, isDragging])

  const snap = snapGridSteps(metrics)

  return (
    <>
      <div
        ref={setTileRef}
        className={`dashboard-grid-item dashboard-grid-tile absolute flex flex-col ${
          widget.kind === 'text' || widget.kind === 'markdown'
            ? 'bg-card ring-1 ring-inset ring-border'
            : 'bg-black ring-1 ring-inset ring-white/10'
        } ${isDragging ? 'dashboard-grid-item--dragging' : ''} ${
          editMode ? 'overflow-visible' : 'overflow-hidden'
        }`}
        style={{
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          transform: transform ? CSS.Translate.toString(transform) : undefined,
          zIndex: isDragging ? 10 : undefined,
        }}
        data-widget-id={slot.i}
      >
        <ErrorBoundary
          fallback={
            <div className="flex h-full items-center justify-center px-3 text-center text-xs text-muted-foreground">
              This tile could not be rendered.
            </div>
          }
        >
          <DashboardWidgetContent
            dashboardId={dashboardId}
            widget={widget}
            isDark={isDark}
            editMode={editMode}
            tileActions={tileActions}
            variableValues={variableValues}
            interactions={interactions}
            dragActivatorRef={canInteract ? setActivatorNodeRef : undefined}
            dragHandleListeners={canInteract ? listeners : undefined}
            dragHandleAttributes={canInteract ? attributes : undefined}
          />
        </ErrorBoundary>
      </div>

      {canInteract ? (
        <Moveable
          target={tileRef}
          draggable={false}
          resizable
          origin={false}
          renderDirections={['se']}
          throttleResize={0}
          snappable
          snapGridWidth={snap.x}
          snapGridHeight={snap.y}
          onResize={({ target, width, height, drag }) => {
            target.style.width = `${width}px`
            target.style.height = `${height}px`
            target.style.transform = drag.transform
          }}
          onResizeEnd={({ lastEvent }) => {
            if (!lastEvent) return
            onResizeCommit(slot.i, lastEvent.width, lastEvent.height)
            const node = tileRef.current
            if (node) node.style.transform = ''
          }}
        />
      ) : null}
    </>
  )
}
