import type { Stage as KonvaStage } from 'konva/lib/Stage'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react'
import { Layer, Line, Rect, Stage } from 'react-konva'
import type { KonvaEventObject } from 'konva/lib/Node'

import type { ForeignKeyEdge } from '@/data/types'
import { columnAnchorWorld } from '@/features/model/diagram-geometry/node-anchors'
import { keysInMarquee, normalizeMarquee } from '@/features/model/diagram-geometry/marquee'
import { stagePointerToWorld } from '@/features/model/diagram-geometry/view-transform'
import type { TableKey, ViewportState } from '@/features/model/model-types'
import { TableNode } from '@/features/model/components/TableNode'
import { readKonvaPalette } from '@/features/model/konva-theme'
import { TABLE_NODE_WIDTH, tableNodeHeight } from '@/features/model/table-node-metrics'
import type { DiagramTool } from '@/features/model/use-diagram-interaction'
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
  selectedKeys: ReadonlySet<TableKey>
  diagramTool: DiagramTool
  onTableSelect: (key: TableKey, shiftKey: boolean) => void
  onClearSelection: () => void
  onMarqueeSelect: (keys: TableKey[], shiftKey: boolean) => void
  onTableDragStart?: (key: TableKey) => void
  onTableDragMove?: (key: TableKey, x: number, y: number) => void
  onMoveTable: (key: TableKey, x: number, y: number) => void
  onRequestColumns: (key: TableKey) => void
  /** Set from parent to call Stage.toDataURL / export. */
  stageRef?: RefObject<KonvaStage | null>
  onConnectColumns?: (fromKey: TableKey, fromColumn: string, toKey: TableKey, toColumn: string) => void
  /** Per-table header fill (`#rrggbb`); missing keys use theme default. */
  headerColors?: Record<TableKey, string>
}

const HIT_SIZE = 16000
const MARQUEE_MIN_PX = 4
const MAJOR_GRID = 40
const MINOR_GRID = 8

export function DiagramCanvas({
  isDark,
  viewport,
  onViewportChange,
  tableDisplays,
  positions,
  columnsByKey,
  foreignKeys,
  selectedKeys,
  diagramTool,
  onTableSelect,
  onClearSelection,
  onMarqueeSelect,
  onTableDragStart,
  onTableDragMove,
  onMoveTable,
  onRequestColumns,
  onConnectColumns,
  headerColors = {},
  stageRef,
}: DiagramCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 640, h: 480 })
  const [spaceHeld, setSpaceHeld] = useState(false)
  const palette = useMemo(() => readKonvaPalette(isDark), [isDark])
  const panRef = useRef<{ sx: number; sy: number; vx: number; vy: number; scale: number } | null>(null)

  const [marqueeWorld, setMarqueeWorld] = useState<{ ax: number; ay: number; bx: number; by: number } | null>(
    null,
  )
  const marqueeRef = useRef<{
    active: boolean
    ax: number
    ay: number
    bx: number
    by: number
    shiftKey: boolean
  } | null>(null)

  const [connectFrom, setConnectFrom] = useState<{ key: TableKey; column: string } | null>(null)
  const [connectPointerWorld, setConnectPointerWorld] = useState<{ x: number; y: number } | null>(null)
  const connectFromRef = useRef<{ key: TableKey; column: string } | null>(null)

  const onMarqueeSelectRef = useRef(onMarqueeSelect)
  const onClearSelectionRef = useRef(onClearSelection)

  useLayoutEffect(() => {
    onMarqueeSelectRef.current = onMarqueeSelect
    onClearSelectionRef.current = onClearSelection
  }, [onClearSelection, onMarqueeSelect])

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

  useEffect(() => {
    const tagIgnores = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'])
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat) return
      const t = e.target as HTMLElement | null
      if (t?.isContentEditable || (t && tagIgnores.has(t.tagName))) return
      e.preventDefault()
      setSpaceHeld(true)
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceHeld(false)
    }
    const onBlurWindow = () => setSpaceHeld(false)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlurWindow)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlurWindow)
    }
  }, [])

  const onCanvasSet = useMemo(() => new Set(tableDisplays.map((t) => t.key)), [tableDisplays])

  const edgeSegments = useMemo(() => {
    const seen = new Set<string>()
    const out: number[][] = []
    for (const fk of foreignKeys) {
      const fromKey = `${fk.fromSchema}.${fk.fromTable}`
      const toKey = `${fk.toSchema}.${fk.toTable}`
      if (!onCanvasSet.has(fromKey) || !onCanvasSet.has(toKey)) continue

      const dedupeKey = `${fromKey}\0${toKey}`
      if (seen.has(dedupeKey)) continue
      seen.add(dedupeKey)

      const fromPos = positions[fromKey]
      const toPos = positions[toKey]
      if (!fromPos || !toPos) continue

      const fromCols = columnsByKey[fromKey] ?? null
      const toCols = columnsByKey[toKey] ?? null
      const h0 = tableNodeHeight(fromCols)
      const h1 = tableNodeHeight(toCols)

      const x0 = fromPos.x + TABLE_NODE_WIDTH / 2
      const y0 = fromPos.y + h0 / 2
      const x1 = toPos.x + TABLE_NODE_WIDTH / 2
      const y1 = toPos.y + h1 / 2

      out.push([x0, y0, x1, y1])
    }
    return out
  }, [columnsByKey, foreignKeys, onCanvasSet, positions])

  const gridLines = useMemo(() => {
    const { w, h } = size
    const vb = {
      left: -viewport.x / viewport.scale,
      top: -viewport.y / viewport.scale,
      right: (-viewport.x + w) / viewport.scale,
      bottom: (-viewport.y + h) / viewport.scale,
    }
    const pad = MAJOR_GRID * 2
    const xStart = Math.floor((vb.left - pad) / MINOR_GRID) * MINOR_GRID
    const yStart = Math.floor((vb.top - pad) / MINOR_GRID) * MINOR_GRID
    const xEnd = Math.ceil((vb.right + pad) / MINOR_GRID) * MINOR_GRID
    const yEnd = Math.ceil((vb.bottom + pad) / MINOR_GRID) * MINOR_GRID

    const vertical: number[][] = []
    const horizontal: number[][] = []
    for (let x = xStart; x <= xEnd; x += MINOR_GRID) {
      const major = Math.round(x / MAJOR_GRID) * MAJOR_GRID === x ? 1 : 0
      vertical.push([x, yStart, x, yEnd, major])
    }
    for (let y = yStart; y <= yEnd; y += MINOR_GRID) {
      const major = Math.round(y / MAJOR_GRID) * MAJOR_GRID === y ? 1 : 0
      horizontal.push([xStart, y, xEnd, y, major])
    }
    return { vertical, horizontal }
  }, [size, viewport.scale, viewport.x, viewport.y])

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

  const endMarqueeInteraction = useCallback(() => {
    const m = marqueeRef.current
    marqueeRef.current = null
    setMarqueeWorld(null)
    if (!m?.active) return

    const dx = Math.abs(m.ax - (m.bx ?? m.ax))
    const dy = Math.abs(m.ay - (m.by ?? m.ay))
    if (dx < MARQUEE_MIN_PX && dy < MARQUEE_MIN_PX) {
      if (!m.shiftKey) onClearSelectionRef.current()
      return
    }

    const rect = normalizeMarquee(m.ax, m.ay, m.bx ?? m.ax, m.by ?? m.ay)
    const keys = keysInMarquee(
      tableDisplays.map((t) => t.key),
      positions,
      columnsByKey,
      rect,
    )
    onMarqueeSelectRef.current(keys, m.shiftKey)
  }, [columnsByKey, positions, tableDisplays])

  const beginMarquee = useCallback((worldX: number, worldY: number, shiftKey: boolean) => {
    marqueeRef.current = {
      active: true,
      ax: worldX,
      ay: worldY,
      bx: worldX,
      by: worldY,
      shiftKey,
    }
    setMarqueeWorld({ ax: worldX, ay: worldY, bx: worldX, by: worldY })
  }, [])

  const updateMarquee = useCallback((worldX: number, worldY: number) => {
    const m = marqueeRef.current
    if (!m?.active) return
    m.bx = worldX
    m.by = worldY
    setMarqueeWorld({ ax: m.ax, ay: m.ay, bx: m.bx, by: m.by })
  }, [])

  useEffect(() => {
    const onWinUp = () => {
      endMarqueeInteraction()
      setConnectPointerWorld(null)
      connectFromRef.current = null
      setConnectFrom(null)
    }
    window.addEventListener('mouseup', onWinUp)
    return () => window.removeEventListener('mouseup', onWinUp)
  }, [endMarqueeInteraction])

  const onHitRectMouseDown = useCallback(
    (e: KonvaEventObject<MouseEvent>) => {
      if (e.target !== e.currentTarget) return
      const stage = e.target.getStage()
      if (!stage || e.evt.button !== 0) return

      const world = stagePointerToWorld(stage.getPointerPosition(), viewport)
      if (!world) return

      if (diagramTool === 'pan' || spaceHeld) {
        if (!spaceHeld && diagramTool === 'pan') onClearSelection()
        beginPan(e.evt.clientX, e.evt.clientY)
        return
      }

      if (diagramTool === 'select') {
        beginMarquee(world.x, world.y, e.evt.shiftKey)
        return
      }

      if (diagramTool === 'connect') {
        connectFromRef.current = null
        setConnectFrom(null)
        setConnectPointerWorld(null)
      }
    },
    [beginMarquee, beginPan, diagramTool, onClearSelection, spaceHeld, viewport],
  )

  const onStageMouseDown = useCallback(
    (e: KonvaEventObject<MouseEvent>) => {
      if (e.evt.button === 1) {
        beginPan(e.evt.clientX, e.evt.clientY)
        return
      }
      const stage = e.target.getStage()
      if (e.evt.button === 0 && spaceHeld) {
        beginPan(e.evt.clientX, e.evt.clientY)
        return
      }
      if (e.evt.button === 0 && e.target === stage) {
        const world = stagePointerToWorld(stage.getPointerPosition(), viewport)
        if (diagramTool === 'select' && world) {
          beginMarquee(world.x, world.y, e.evt.shiftKey)
        } else if (diagramTool === 'pan') {
          onClearSelection()
          beginPan(e.evt.clientX, e.evt.clientY)
        } else {
          connectFromRef.current = null
          setConnectFrom(null)
          setConnectPointerWorld(null)
        }
      }
    },
    [beginMarquee, beginPan, diagramTool, onClearSelection, spaceHeld, viewport],
  )

  const beginPanFromTable = useCallback(
    (clientX: number, clientY: number) => {
      beginPan(clientX, clientY)
    },
    [beginPan],
  )

  const onStageMouseMove = useCallback(
    (e: KonvaEventObject<MouseEvent>) => {
      const stage = e.target.getStage()
      if (stage && connectFrom) {
        const w = stagePointerToWorld(stage.getPointerPosition(), viewport)
        if (w) setConnectPointerWorld(w)
      }

      if (marqueeRef.current?.active && stage) {
        const w = stagePointerToWorld(stage.getPointerPosition(), viewport)
        if (w) updateMarquee(w.x, w.y)
      }

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
    [connectFrom, onViewportChange, updateMarquee, viewport],
  )

  const onStageMouseUp = useCallback(() => {
    panRef.current = null
    endMarqueeInteraction()
  }, [endMarqueeInteraction])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        connectFromRef.current = null
        setConnectFrom(null)
        setConnectPointerWorld(null)
        return
      }
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

  const connectLinePoints = useMemo(() => {
    if (!connectFrom || !connectPointerWorld) return null
    const pos = positions[connectFrom.key]
    const cols = columnsByKey[connectFrom.key]
    if (!pos || !cols?.length) return null
    const a = columnAnchorWorld(pos, connectFrom.column, cols)
    return [a.x, a.y, connectPointerWorld.x, connectPointerWorld.y]
  }, [columnsByKey, connectFrom, connectPointerWorld, positions])

  const handleConnectColumnPointerDown = useCallback(
    (tableKey: TableKey, columnName: string, evt: KonvaEventObject<MouseEvent>) => {
      if (diagramTool !== 'connect' || !onConnectColumns) return
      evt.cancelBubble = true
      const stage = evt.target.getStage()
      const w = stage ? stagePointerToWorld(stage.getPointerPosition(), viewport) : null
      const next = { key: tableKey, column: columnName }
      connectFromRef.current = next
      setConnectFrom(next)
      setConnectPointerWorld(w)
    },
    [diagramTool, onConnectColumns, viewport],
  )

  const handleConnectColumnPointerUp = useCallback(
    (tableKey: TableKey, columnName: string, evt: KonvaEventObject<MouseEvent>) => {
      if (diagramTool !== 'connect' || !onConnectColumns) return
      evt.cancelBubble = true
      const cf = connectFromRef.current
      if (!cf) return
      if (cf.key === tableKey && cf.column === columnName) {
        connectFromRef.current = null
        setConnectFrom(null)
        setConnectPointerWorld(null)
        return
      }
      const fromCols = columnsByKey[cf.key]
      const toCols = columnsByKey[tableKey]
      if (!fromCols?.length || !toCols?.length) {
        connectFromRef.current = null
        setConnectFrom(null)
        setConnectPointerWorld(null)
        return
      }
      onConnectColumns(cf.key, cf.column, tableKey, columnName)
      connectFromRef.current = null
      setConnectFrom(null)
      setConnectPointerWorld(null)
    },
    [columnsByKey, diagramTool, onConnectColumns],
  )

  const marqueeRect = marqueeWorld ? normalizeMarquee(marqueeWorld.ax, marqueeWorld.ay, marqueeWorld.bx, marqueeWorld.by) : null

  const toolHint =
    diagramTool === 'pan'
      ? 'Hand: drag to pan · Wheel zoom · +/- · 0 reset · Space+drag also pans'
      : diagramTool === 'connect'
        ? 'Connect: drag from column to column · Switch to Select to move tables · Esc or click empty canvas to cancel'
        : 'Select: drag tables · Shift+click multi-select · Drag empty = box select · Space+drag pans · Wheel zoom'

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
      <p className="pointer-events-none absolute bottom-2 left-2 z-10 max-w-[min(100%-1rem,28rem)] text-[10px] leading-snug text-muted-foreground">
        {toolHint}
      </p>
      <Stage
        ref={stageRef}
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
          {gridLines.vertical.map((row, i) => (
            <Line
              key={`gv-${i}`}
              points={[row[0]!, row[1]!, row[2]!, row[3]!]}
              stroke={row[4] === 1 ? palette.gridMajor : palette.gridMinor}
              strokeWidth={row[4] === 1 ? 1 : 0.5}
              listening={false}
              perfectDrawEnabled={false}
            />
          ))}
          {gridLines.horizontal.map((row, i) => (
            <Line
              key={`gh-${i}`}
              points={[row[0]!, row[1]!, row[2]!, row[3]!]}
              stroke={row[4] === 1 ? palette.gridMajor : palette.gridMinor}
              strokeWidth={row[4] === 1 ? 1 : 0.5}
              listening={false}
              perfectDrawEnabled={false}
            />
          ))}
        </Layer>
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
                selected={selectedKeys.has(t.key)}
                diagramTool={diagramTool}
                palette={palette}
                headerFill={headerColors[t.key]}
                spaceHeld={spaceHeld}
                onBeginCanvasPan={beginPanFromTable}
                onSelect={(shiftKey) => onTableSelect(t.key, shiftKey)}
                onDragStart={onTableDragStart ? () => onTableDragStart(t.key) : undefined}
                onDragMove={
                  onTableDragMove ? (nx, ny) => onTableDragMove(t.key, nx, ny) : undefined
                }
                onDragEnd={(nx, ny) => onMoveTable(t.key, nx, ny)}
                onRequestColumns={() => onRequestColumns(t.key)}
                onConnectColumnPointerDown={
                  onConnectColumns ? (col, e) => handleConnectColumnPointerDown(t.key, col, e) : undefined
                }
                onConnectColumnPointerUp={
                  onConnectColumns ? (col, e) => handleConnectColumnPointerUp(t.key, col, e) : undefined
                }
              />
            )
          })}
        </Layer>
        <Layer listening={false} perfectDrawEnabled={false}>
          {marqueeRect && (marqueeRect.w > 0 || marqueeRect.h > 0) ? (
            <Rect
              x={marqueeRect.x}
              y={marqueeRect.y}
              width={marqueeRect.w}
              height={marqueeRect.h}
              fill="rgba(59,130,246,0.12)"
              stroke={palette.borderFocus}
              strokeWidth={1}
              listening={false}
            />
          ) : null}
          {connectLinePoints ? (
            <Line
              points={connectLinePoints}
              stroke={palette.edge}
              strokeWidth={2}
              dash={[6, 4]}
              lineCap="round"
              listening={false}
            />
          ) : null}
        </Layer>
      </Stage>
    </div>
  )
}
