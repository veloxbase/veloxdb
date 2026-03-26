import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Layer, Line, Rect, Stage } from 'react-konva'
import type { KonvaEventObject } from 'konva/lib/Node'

import type { ForeignKeyEdge } from '@/data/types'
import type { TableKey, ViewportState } from '@/features/model/model-types'
import { TableNode } from '@/features/model/components/TableNode'
import { readKonvaPalette } from '@/features/model/konva-theme'
import { TABLE_NODE_WIDTH, tableNodeHeight } from '@/features/model/table-node-metrics'
import type { ColumnInfo } from '@/data/types'

export type TableDisplay = {
  key: TableKey
  schema: string
  name: string
}

type DiagramCanvasProps = {
  isDark: boolean
  viewport: ViewportState
  onViewportChange: (v: ViewportState) => void
  tableDisplays: TableDisplay[]
  positions: Record<TableKey, { x: number; y: number }>
  columnsByKey: Record<TableKey, ColumnInfo[] | null>
  foreignKeys: ForeignKeyEdge[]
  selectedKey: TableKey | null
  onSelectKey: (key: TableKey | null) => void
  onMoveTable: (key: TableKey, x: number, y: number) => void
  onRequestColumns: (key: TableKey) => void
}

const HIT_SIZE = 16000

export function DiagramCanvas({
  isDark,
  viewport,
  onViewportChange,
  tableDisplays,
  positions,
  columnsByKey,
  foreignKeys,
  selectedKey,
  onSelectKey,
  onMoveTable,
  onRequestColumns,
}: DiagramCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 640, h: 480 })
  const palette = useMemo(() => readKonvaPalette(isDark), [isDark])
  const panRef = useRef<{ sx: number; sy: number; vx: number; vy: number; scale: number } | null>(null)

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return

    const measure = () => {
      const r = el.getBoundingClientRect()
      setSize({
        w: Math.max(320, Math.floor(r.width)),
        h: Math.max(240, Math.floor(r.height)),
      })
    }

    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const onCanvasSet = new Set(tableDisplays.map((t) => t.key))

  const edgeSegments = foreignKeys.flatMap((fk) => {
    const fromKey = `${fk.fromSchema}.${fk.fromTable}`
    const toKey = `${fk.toSchema}.${fk.toTable}`
    if (!onCanvasSet.has(fromKey) || !onCanvasSet.has(toKey)) return []

    const fromPos = positions[fromKey]
    const toPos = positions[toKey]
    if (!fromPos || !toPos) return []

    const fromCols = columnsByKey[fromKey] ?? null
    const toCols = columnsByKey[toKey] ?? null
    const h0 = tableNodeHeight(fromCols)
    const h1 = tableNodeHeight(toCols)

    const x0 = fromPos.x + TABLE_NODE_WIDTH / 2
    const y0 = fromPos.y + h0 / 2
    const x1 = toPos.x + TABLE_NODE_WIDTH / 2
    const y1 = toPos.y + h1 / 2

    return [[x0, y0, x1, y1] as number[]]
  })

  const handleWheel = useCallback(
    (e: KonvaEventObject<WheelEvent>) => {
      e.evt.preventDefault()
      const stage = e.target.getStage()
      if (!stage) return

      const scaleBy = 1.08
      const oldScale = viewport.scale
      const direction = e.evt.deltaY > 0 ? -1 : 1
      const newScale = direction > 0 ? oldScale * scaleBy : oldScale / scaleBy
      const clamped = Math.min(2.5, Math.max(0.15, newScale))

      const pointer = stage.getPointerPosition()
      if (!pointer) return

      const mousePointTo = {
        x: (pointer.x - viewport.x) / oldScale,
        y: (pointer.y - viewport.y) / oldScale,
      }

      onViewportChange({
        scale: clamped,
        x: pointer.x - mousePointTo.x * clamped,
        y: pointer.y - mousePointTo.y * clamped,
      })
    },
    [onViewportChange, viewport.scale, viewport.x, viewport.y],
  )

  const beginPan = useCallback(
    (clientX: number, clientY: number) => {
      panRef.current = {
        sx: clientX,
        sy: clientY,
        vx: viewport.x,
        vy: viewport.y,
        scale: viewport.scale,
      }
    },
    [viewport.scale, viewport.x, viewport.y],
  )

  const onHitRectMouseDown = useCallback(
    (e: KonvaEventObject<MouseEvent>) => {
      if (e.target !== e.currentTarget) return
      if (e.evt.button === 0) {
        onSelectKey(null)
        beginPan(e.evt.clientX, e.evt.clientY)
      }
    },
    [beginPan, onSelectKey],
  )

  const onStageMouseDown = useCallback(
    (e: KonvaEventObject<MouseEvent>) => {
      if (e.evt.button === 1) {
        beginPan(e.evt.clientX, e.evt.clientY)
        return
      }
      const stage = e.target.getStage()
      if (e.evt.button === 0 && e.target === stage) {
        onSelectKey(null)
        beginPan(e.evt.clientX, e.evt.clientY)
      }
    },
    [beginPan, onSelectKey],
  )

  const onStageMouseMove = useCallback(
    (e: KonvaEventObject<MouseEvent>) => {
      const pan = panRef.current
      if (!pan) return
      const dx = e.evt.clientX - pan.sx
      const dy = e.evt.clientY - pan.sy
      onViewportChange({
        scale: pan.scale,
        x: pan.vx + dx,
        y: pan.vy + dy,
      })
    },
    [onViewportChange],
  )

  const onStageMouseUp = useCallback(() => {
    panRef.current = null
  }, [])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === '+' || (e.key === '=' && !e.shiftKey)) {
        e.preventDefault()
        const next = Math.min(2.5, viewport.scale * 1.12)
        onViewportChange({ ...viewport, scale: next })
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault()
        const next = Math.max(0.15, viewport.scale / 1.12)
        onViewportChange({ ...viewport, scale: next })
      } else if (e.key === '0') {
        e.preventDefault()
        onViewportChange({ scale: 1, x: 0, y: 0 })
      }
    },
    [onViewportChange, viewport],
  )

  return (
    <div
      ref={containerRef}
      className="relative h-full min-h-0 w-full min-w-0 outline-none"
      style={{ backgroundColor: palette.canvasBg }}
      tabIndex={0}
      role="application"
      aria-label="Schema diagram canvas"
      onKeyDown={handleKeyDown}
      onMouseDown={() => containerRef.current?.focus()}
    >
      <p className="pointer-events-none absolute bottom-2 left-2 z-10 max-w-[min(100%-1rem,20rem)] text-[10px] leading-snug text-muted-foreground">
        Drag empty space to pan · Wheel zoom · +/- keys · 0 reset · Shift or middle-drag also pans · Drag
        tables to move
      </p>
      <Stage
        width={size.w}
        height={size.h}
        x={viewport.x}
        y={viewport.y}
        scaleX={viewport.scale}
        scaleY={viewport.scale}
        onWheel={handleWheel}
        onMouseDown={onStageMouseDown}
        onMouseMove={onStageMouseMove}
        onMouseUp={onStageMouseUp}
        onMouseLeave={onStageMouseUp}
      >
        <Layer listening={false} perfectDrawEnabled={false}>
          {edgeSegments.map((points, i) => (
            <Line
              key={i}
              points={points}
              stroke={palette.edge}
              strokeWidth={1.5}
              lineCap="round"
              listening={false}
              perfectDrawEnabled={false}
            />
          ))}
        </Layer>
        <Layer>
          <Rect
            x={-HIT_SIZE / 2}
            y={-HIT_SIZE / 2}
            width={HIT_SIZE}
            height={HIT_SIZE}
            fill="transparent"
            onMouseDown={onHitRectMouseDown}
            perfectDrawEnabled={false}
          />
          {tableDisplays.map((t) => {
            const pos = positions[t.key] ?? { x: 0, y: 0 }
            return (
              <TableNode
                key={t.key}
                x={pos.x}
                y={pos.y}
                schema={t.schema}
                name={t.name}
                columns={columnsByKey[t.key] ?? null}
                selected={selectedKey === t.key}
                palette={palette}
                onSelect={() => onSelectKey(t.key)}
                onDragEnd={(nx, ny) => onMoveTable(t.key, nx, ny)}
                onRequestColumns={() => onRequestColumns(t.key)}
              />
            )
          })}
        </Layer>
      </Stage>
    </div>
  )
}
