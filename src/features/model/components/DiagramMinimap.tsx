import { useCallback, useMemo, useRef } from 'react'

import type { ColumnInfo } from '@/data/types'
import { diagramContentBounds } from '@/features/model/diagram-geometry/content-bounds'
import { worldViewportBounds } from '@/features/model/diagram-geometry/view-transform'
import type { ColumnDetailLevel, TableKey, ViewportState } from '@/features/model/model-types'
import { TABLE_NODE_WIDTH, tableNodeHeight } from '@/features/model/table-node-metrics'

type DiagramMinimapProps = {
  tableKeys: readonly TableKey[]
  positions: Record<TableKey, { x: number; y: number }>
  columnsByKey: Record<TableKey, ColumnInfo[] | null>
  columnDetail?: ColumnDetailLevel
  /** Resolved header fills (including per-table defaults); omit for neutral blocks. */
  tableHeaderColors?: Record<TableKey, string>
  viewport: ViewportState
  onViewportChange: (v: ViewportState) => void
  canvasWidth: number
  canvasHeight: number
  isDark: boolean
}

const MAP_W = 168
const MAP_H = 120
const PAD = 6

export function DiagramMinimap({
  tableKeys,
  positions,
  columnsByKey,
  columnDetail = 'full',
  tableHeaderColors,
  viewport,
  onViewportChange,
  canvasWidth,
  canvasHeight,
  isDark,
}: DiagramMinimapProps) {
  const dragRef = useRef<{ sx: number; sy: number; vx: number; vy: number } | null>(null)

  const bounds = useMemo(
    () => diagramContentBounds(tableKeys, positions, columnsByKey, 80, columnDetail),
    [columnDetail, columnsByKey, positions, tableKeys],
  )

  const contentW = Math.max(1, bounds.maxX - bounds.minX)
  const contentH = Math.max(1, bounds.maxY - bounds.minY)

  const scale = useMemo(() => {
    const sx = (MAP_W - PAD * 2) / contentW
    const sy = (MAP_H - PAD * 2) / contentH
    return Math.min(sx, sy)
  }, [contentH, contentW])

  const ox = PAD + (-bounds.minX * scale)
  const oy = PAD + (-bounds.minY * scale)

  const worldToMap = useCallback(
    (wx: number, wy: number) => ({
      x: ox + wx * scale,
      y: oy + wy * scale,
    }),
    [ox, oy, scale],
  )

  const mapToWorldDelta = useCallback(
    (dxMap: number, dyMap: number) => ({
      dx: dxMap / scale,
      dy: dyMap / scale,
    }),
    [scale],
  )

  const vb = useMemo(
    () => worldViewportBounds(viewport, canvasWidth, canvasHeight),
    [canvasHeight, canvasWidth, viewport],
  )

  const vpRect = useMemo(() => {
    const p0 = worldToMap(vb.left, vb.top)
    const p1 = worldToMap(vb.right, vb.bottom)
    return {
      x: Math.min(p0.x, p1.x),
      y: Math.min(p0.y, p1.y),
      w: Math.abs(p1.x - p0.x),
      h: Math.abs(p1.y - p0.y),
    }
  }, [vb, worldToMap])

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.currentTarget.setPointerCapture(e.pointerId)
      dragRef.current = {
        sx: e.clientX,
        sy: e.clientY,
        vx: viewport.x,
        vy: viewport.y,
      }
    },
    [viewport.x, viewport.y],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      const mdx = e.clientX - d.sx
      const mdy = e.clientY - d.sy
      const { dx, dy } = mapToWorldDelta(mdx, mdy)
      onViewportChange({
        scale: viewport.scale,
        x: d.vx - dx * viewport.scale,
        y: d.vy - dy * viewport.scale,
      })
    },
    [mapToWorldDelta, onViewportChange, viewport.scale],
  )

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    dragRef.current = null
  }, [])

  const frameClass = isDark
    ? 'border-border/80 bg-background/85 shadow-md backdrop-blur-[2px]'
    : 'border-border/80 bg-background/90 shadow-md backdrop-blur-[2px]'

  return (
    <div
      className={`pointer-events-auto absolute right-3 top-3 z-20 rounded-md border ${frameClass}`}
      style={{ width: MAP_W, height: MAP_H }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      role="presentation"
      aria-label="Diagram minimap — drag to pan the canvas"
    >
      <div className="relative h-full w-full overflow-hidden rounded-[inherit]">
        {tableKeys.map((k) => {
          const p = positions[k]
          if (!p) return null
          const h = tableNodeHeight(columnsByKey[k] ?? null, columnDetail)
          const { x, y } = worldToMap(p.x, p.y)
          const w = TABLE_NODE_WIDTH * scale
          const hh = h * scale
          const fill = tableHeaderColors?.[k]
          return (
            <div
              key={k}
              className={fill ? 'absolute rounded-[2px]' : 'absolute rounded-[2px] bg-muted-foreground/35'}
              style={{
                left: x,
                top: y,
                width: Math.max(2, w),
                height: Math.max(2, hh),
                ...(fill
                  ? {
                      backgroundColor: fill,
                      opacity: isDark ? 0.85 : 0.9,
                      boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.12)',
                    }
                  : {}),
              }}
            />
          )
        })}
        <div
          className="absolute rounded-[1px] border border-primary ring-1 ring-primary/30"
          style={{
            left: vpRect.x,
            top: vpRect.y,
            width: Math.max(4, vpRect.w),
            height: Math.max(4, vpRect.h),
            boxSizing: 'border-box',
          }}
        />
      </div>
    </div>
  )
}
