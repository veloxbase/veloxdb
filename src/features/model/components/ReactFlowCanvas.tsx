import '@xyflow/react/dist/style.css'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  ControlButton,
  ConnectionMode,
  Controls,
  Handle,
  MiniMap,
  Panel,
  type Edge,
  type IsValidConnection,
  MarkerType,
  type Node,
  Position,
  ReactFlow,
  type ReactFlowInstance,
} from '@xyflow/react'
import { toPng } from 'html-to-image'

import { buildRoutedDiagramEdges } from '@/features/model/diagram-geometry/edge-routing'
import type {
  DiagramExportHandle,
  DiagramSurfaceProps,
} from '@/features/model/components/diagram-surface-types'
import { diagramGroupWorldBounds } from '@/features/model/diagram-geometry/group-bounds'
import { readDiagramPalette } from '@/features/model/diagram-theme'
import type { TableKey } from '@/features/model/model-types'
import { TABLE_NODE_WIDTH, tableNodeHeight } from '@/features/model/table-node-metrics'
import { contrastTextForBg } from '@/lib/contrast-text-for-bg'

type TableNodeData = {
  key: TableKey
  schema: string
  name: string
  selected: boolean
  columns: DiagramSurfaceProps['columnsByKey'][TableKey]
  headerFill?: string
  columnDetail: NonNullable<DiagramSurfaceProps['columnDetail']>
  diagramTool: DiagramSurfaceProps['diagramTool']
  onSelect: (key: TableKey, shiftKey: boolean) => void
  onRequestColumns: (key: TableKey) => void
  onQuickEditColumn?: (
    tableKey: TableKey,
    sourceColumnName: string,
    patch: { nextColumnName: string; nextDataType: string },
  ) => void
}

const MAX_ROWS = 8
const VIEWPORT_FRAME_MS = 80

type GroupNodeData = {
  name: string
}

const TableFlowNode = memo(({ data }: { data: TableNodeData }) => {
  const rows = data.columns?.slice(0, MAX_ROWS) ?? []
  const moreCount = data.columns && data.columns.length > MAX_ROWS ? data.columns.length - MAX_ROWS : 0
  const height = tableNodeHeight(data.columns ?? null, data.columnDetail)
  const headerFill = data.headerFill ?? 'var(--diagram-table-header)'
  const headerText = contrastTextForBg(headerFill)
  const canConnect = data.diagramTool === 'connect' && data.columnDetail !== 'header' && rows.length > 0
  const canQuickEdit = Boolean(data.onQuickEditColumn) && data.diagramTool === 'select'
  const [editingSource, setEditingSource] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [draftType, setDraftType] = useState('')
  const [inlineError, setInlineError] = useState<string | null>(null)

  const beginEdit = useCallback(
    (sourceColumnName: string, currentName: string, currentType: string) => {
      if (!canQuickEdit) return
      setEditingSource(sourceColumnName)
      setDraftName(currentName)
      setDraftType(currentType)
      setInlineError(null)
    },
    [canQuickEdit],
  )

  const cancelEdit = useCallback(() => {
    setEditingSource(null)
    setInlineError(null)
  }, [])

  const commitEdit = useCallback(() => {
    if (!editingSource || !data.onQuickEditColumn) return
    const nextName = draftName.trim()
    const nextType = draftType.trim()
    if (!nextName || !nextType) {
      setInlineError('Column name and datatype are required.')
      return
    }
    const duplicate = rows.some(
      (col) => col.columnName.trim().toLowerCase() === nextName.toLowerCase() && col.columnName !== editingSource,
    )
    if (duplicate) {
      setInlineError('Column name already exists on this node.')
      return
    }
    data.onQuickEditColumn(data.key, editingSource, { nextColumnName: nextName, nextDataType: nextType })
    setEditingSource(null)
    setInlineError(null)
  }, [data, draftName, draftType, editingSource, rows])

  return (
    <button
      type="button"
      className={`nodrag nopan nowheel relative block cursor-grab appearance-none rounded-md border bg-card text-left shadow-sm outline-none active:cursor-grabbing ${data.selected ? 'border-primary ring-1 ring-primary/35' : 'border-border'}`}
      style={{ width: TABLE_NODE_WIDTH, minHeight: height }}
      aria-label={`Table ${data.schema}.${data.name}`}
      onDoubleClick={(e) => {
        const target = e.target as HTMLElement | null
        const row = target?.closest<HTMLElement>('[data-inline-source-column]')
        if (row && canQuickEdit) {
          e.stopPropagation()
          beginEdit(
            row.dataset.inlineSourceColumn ?? '',
            row.dataset.inlineCurrentName ?? '',
            row.dataset.inlineCurrentType ?? '',
          )
          return
        }
        data.onRequestColumns(data.key)
      }}
      onMouseDown={(e) => data.onSelect(data.key, e.shiftKey)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          data.onRequestColumns(data.key)
        }
      }}
    >
      <div className="rounded-t-md px-2 py-2 text-xs font-semibold" style={{ backgroundColor: headerFill, color: headerText }}>
        {data.name} ({data.schema})
      </div>
      {data.columnDetail === 'header' ? null : data.columns == null ? (
        <div className="px-2 py-2 text-[11px] text-muted-foreground">Double-click to load columns</div>
      ) : (
        <div className="px-2 py-1.5">
          {rows.map((c) => (
            <div
              key={c.columnName}
              className="relative flex items-center justify-between gap-2 py-0.5 text-[11px]"
              data-inline-source-column={c.columnName}
              data-inline-current-name={c.columnName}
              data-inline-current-type={c.dataType}
            >
              {canConnect ? (
                <>
                  <Handle
                    id={`in:${c.columnName}`}
                    type="target"
                    position={Position.Left}
                    style={{ left: -6, width: 8, height: 8, border: '1px solid var(--border)' }}
                  />
                  <Handle
                    id={`out:${c.columnName}`}
                    type="source"
                    position={Position.Right}
                    style={{ right: -6, width: 8, height: 8, border: '1px solid var(--border)' }}
                  />
                </>
              ) : null}
              {editingSource === c.columnName ? (
                <div className="flex min-w-0 flex-1 items-center gap-1">
                  <input
                    className="h-6 min-w-0 flex-1 rounded border border-input bg-background px-1.5 text-[10px]"
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    onMouseDown={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      e.stopPropagation()
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        commitEdit()
                      } else if (e.key === 'Escape') {
                        e.preventDefault()
                        cancelEdit()
                      }
                    }}
                    onBlur={commitEdit}
                  />
                  <input
                    className="h-6 w-24 rounded border border-input bg-background px-1.5 text-[10px] text-muted-foreground"
                    value={draftType}
                    onChange={(e) => setDraftType(e.target.value)}
                    onMouseDown={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      e.stopPropagation()
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        commitEdit()
                      } else if (e.key === 'Escape') {
                        e.preventDefault()
                        cancelEdit()
                      }
                    }}
                    onBlur={commitEdit}
                  />
                </div>
              ) : (
                <>
                  <span className="truncate">{c.columnName}</span>
                  <span className="max-w-24 truncate text-muted-foreground">{c.dataType}</span>
                </>
              )}
            </div>
          ))}
          {inlineError ? <div className="pt-1 text-[10px] text-destructive">{inlineError}</div> : null}
          {moreCount > 0 ? <div className="pt-1 text-[10px] text-muted-foreground">+{moreCount} more</div> : null}
        </div>
      )}
    </button>
  )
})

const nodeTypes = { tableNode: TableFlowNode }

const GroupFlowNode = memo(({ data }: { data: GroupNodeData }) => {
  return (
    <div className="h-full w-full border border-dashed border-muted-foreground/60 bg-muted/10 px-2 py-1">
      <span className="text-[10px] text-muted-foreground">{data.name}</span>
    </div>
  )
})

const allNodeTypes = { ...nodeTypes, groupNode: GroupFlowNode }

export function ReactFlowCanvas({
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
  onQuickEditColumn,
  headerColors = {},
  pendingForeignKeys = [],
  columnDetail = 'full',
  diagramGroups = [],
  exportRef,
}: DiagramSurfaceProps) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const rfRef = useRef<ReactFlowInstance<Node, Edge> | null>(null)
  const lastViewportEmitRef = useRef(0)
  const viewportRef = useRef(viewport)
  const [spaceHeld, setSpaceHeld] = useState(false)
  useEffect(() => {
    viewportRef.current = viewport
  }, [viewport])

  const palette = useMemo(() => readDiagramPalette(isDark), [isDark])
  const onCanvasSet = useMemo(() => new Set(tableDisplays.map((t) => t.key)), [tableDisplays])

  useEffect(() => {
    if (!exportRef) return
    const out: DiagramExportHandle = {
      toDataURL: async () => {
        const el = wrapperRef.current
        if (!el) return ''
        return toPng(el, { pixelRatio: 2, cacheBust: true })
      },
    }
    exportRef.current = out
    return () => {
      exportRef.current = null
    }
  }, [exportRef])

  const nodes = useMemo<Node<TableNodeData>[]>(() => {
    return tableDisplays.map((t) => {
      const pos = positions[t.key] ?? { x: 0, y: 0 }
      return {
        id: t.key,
        type: 'tableNode',
        position: pos,
        selected: selectedKeys.has(t.key),
        draggable: diagramTool === 'select',
        data: {
          key: t.key,
          schema: t.schema,
          name: t.name,
          selected: selectedKeys.has(t.key),
          columns: columnsByKey[t.key] ?? null,
          headerFill: headerColors[t.key],
          columnDetail,
          diagramTool,
          onSelect: onTableSelect,
          onRequestColumns,
          onQuickEditColumn,
        },
      }
    })
  }, [columnDetail, columnsByKey, diagramTool, headerColors, onQuickEditColumn, onRequestColumns, onTableSelect, positions, selectedKeys, tableDisplays])

  const groupNodes = useMemo<Node<GroupNodeData>[]>(() => {
    if (!diagramGroups.length) return []
    const out: Node<GroupNodeData>[] = []
    for (const group of diagramGroups) {
      const bounds = diagramGroupWorldBounds(group, positions, columnsByKey, columnDetail)
      if (!bounds) continue
      out.push({
        id: `group:${group.id}`,
        type: 'groupNode',
        position: { x: bounds.x, y: bounds.y },
        data: { name: group.name },
        draggable: false,
        selectable: false,
        focusable: false,
        width: bounds.w,
        height: bounds.h,
        zIndex: -10,
      })
    }
    return out
  }, [columnDetail, columnsByKey, diagramGroups, positions])

  const allNodes = useMemo<Node[]>(() => [...groupNodes, ...nodes], [groupNodes, nodes])

  const routed = useMemo(
    () => buildRoutedDiagramEdges({ foreignKeys, pendingForeignKeys, onCanvasSet, positions, columnsByKey, columnDetail }),
    [columnDetail, columnsByKey, foreignKeys, onCanvasSet, pendingForeignKeys, positions],
  )

  const edges = useMemo<Edge[]>(() => {
    const mk = (kind: 'committed' | 'pending', edge: (typeof routed.committed)[number]): Edge => ({
      id: edge.id,
      type: 'smoothstep',
      source: edge.fromKey,
      target: edge.toKey,
      sourceHandle: `out:${edge.fromColumn}`,
      targetHandle: `in:${edge.toColumn}`,
      markerEnd: { type: MarkerType.ArrowClosed, color: kind === 'pending' ? palette.edgePending : palette.edge },
      animated: kind === 'pending',
      style: {
        stroke: kind === 'pending' ? palette.edgePending : palette.edge,
        strokeWidth: kind === 'pending' ? 2 : 1.5,
        strokeDasharray: kind === 'pending' ? '8 5' : undefined,
      },
      selectable: false,
    })
    return [...routed.committed.map((e) => mk('committed', e)), ...routed.pending.map((e) => mk('pending', e))]
  }, [palette.edge, palette.edgePending, routed])

  const handleConnect = useCallback(
    (connection: { source: string | null; target: string | null; sourceHandle: string | null; targetHandle: string | null }) => {
      const fromKey = connection.source as TableKey | null
      const toKey = connection.target as TableKey | null
      const fromColumn = connection.sourceHandle?.replace(/^out:/, '')
      const toColumn = connection.targetHandle?.replace(/^in:/, '')
      if (!fromKey || !toKey || !fromColumn || !toColumn || !onConnectColumns) return
      onConnectColumns(fromKey, fromColumn, toKey, toColumn)
    },
    [onConnectColumns],
  )

  const isValidConnection = useCallback<IsValidConnection>(
    (connection) => {
      const fromKey = connection.source as TableKey | null
      const toKey = connection.target as TableKey | null
      const fromColumn = connection.sourceHandle?.replace(/^out:/, '')
      const toColumn = connection.targetHandle?.replace(/^in:/, '')
      if (!fromKey || !toKey || !fromColumn || !toColumn) return false
      if (fromKey === toKey && fromColumn === toColumn) return false

      const duplicateCommitted = foreignKeys.some(
        (fk) =>
          fk.fromSchema === fromKey.split('.')[0] &&
          fk.fromTable === fromKey.split('.')[1] &&
          fk.fromColumn === fromColumn &&
          fk.toSchema === toKey.split('.')[0] &&
          fk.toTable === toKey.split('.')[1] &&
          fk.toColumn === toColumn,
      )
      if (duplicateCommitted) return false

      const duplicatePending = pendingForeignKeys.some(
        (fk) =>
          fk.fromKey === fromKey &&
          fk.fromColumn === fromColumn &&
          fk.toKey === toKey &&
          fk.toColumn === toColumn,
      )
      return !duplicatePending
    },
    [foreignKeys, pendingForeignKeys],
  )

  const handleMove = useCallback(
    (_: MouseEvent | TouchEvent | null, vp: { x: number; y: number; zoom: number }) => {
      const current = viewportRef.current
      if (
        Math.abs(current.x - vp.x) < 0.5 &&
        Math.abs(current.y - vp.y) < 0.5 &&
        Math.abs(current.scale - vp.zoom) < 0.001
      ) {
        return
      }
      const now = performance.now()
      if (now - lastViewportEmitRef.current < VIEWPORT_FRAME_MS) return
      lastViewportEmitRef.current = now
      onViewportChange({ x: vp.x, y: vp.y, scale: vp.zoom })
    },
    [onViewportChange],
  )

  useEffect(() => {
    const instance = rfRef.current
    if (!instance) return
    const current = instance.getViewport()
    if (
      Math.abs(current.x - viewport.x) < 0.5 &&
      Math.abs(current.y - viewport.y) < 0.5 &&
      Math.abs(current.zoom - viewport.scale) < 0.001
    ) {
      return
    }
    instance.setViewport({ x: viewport.x, y: viewport.y, zoom: viewport.scale }, { duration: 120 })
  }, [viewport])

  const handleFitAll = useCallback(() => {
    rfRef.current?.fitView({ padding: 0.2, duration: 160 })
  }, [])

  const handleFitSelection = useCallback(() => {
    const instance = rfRef.current
    if (!instance) return
    const selectedNodeIds = nodes.filter((n) => n.selected).map((n) => n.id)
    if (selectedNodeIds.length === 0) {
      instance.fitView({ padding: 0.2, duration: 160 })
      return
    }
    instance.fitView({ nodes: selectedNodeIds.map((id) => ({ id })), padding: 0.2, duration: 160 })
  }, [nodes])

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

  useEffect(() => {
    const tagIgnores = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'])
    const onKeyDown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t?.isContentEditable || (t && tagIgnores.has(t.tagName))) return
      if (e.key === 'Escape') {
        onClearSelection()
        return
      }
      const current = rfRef.current?.getViewport()
      if (!current) return
      if (e.key === '+' || (e.key === '=' && !e.shiftKey)) {
        e.preventDefault()
        const next = Math.min(2.5, current.zoom * 1.12)
        onViewportChange({ x: current.x, y: current.y, scale: next })
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault()
        const next = Math.max(0.15, current.zoom / 1.12)
        onViewportChange({ x: current.x, y: current.y, scale: next })
      } else if (e.key === '0') {
        e.preventDefault()
        onViewportChange({ x: 0, y: 0, scale: 1 })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onClearSelection, onViewportChange])

  return (
    <div
      ref={wrapperRef}
      className="h-full w-full outline-none"
    >
      <ReactFlow
        nodes={allNodes}
        edges={edges}
        nodeTypes={allNodeTypes}
        colorMode={isDark ? 'dark' : 'light'}
        fitView={false}
        minZoom={0.15}
        maxZoom={2.5}
        translateExtent={[[-8000, -8000], [8000, 8000]]}
        panOnDrag={diagramTool === 'pan' || spaceHeld}
        selectionOnDrag={diagramTool === 'select'}
        elementsSelectable={diagramTool === 'select'}
        nodesConnectable={diagramTool === 'connect'}
        onInit={(instance) => {
          rfRef.current = instance
          instance.setViewport({ x: viewport.x, y: viewport.y, zoom: viewport.scale }, { duration: 0 })
        }}
        onMove={handleMove}
        onMoveEnd={handleMove}
        onPaneClick={onClearSelection}
        onSelectionChange={({ nodes: selectedNodes }) => onMarqueeSelect(selectedNodes.map((n) => n.id as TableKey), false)}
        onNodeClick={(evt, node) => onTableSelect(node.id as TableKey, evt.shiftKey)}
        onNodeDragStart={(_, node) => onTableDragStart?.(node.id as TableKey)}
        onNodeDrag={(_, node) => onTableDragMove?.(node.id as TableKey, node.position.x, node.position.y)}
        onNodeDragStop={(_, node) => onMoveTable(node.id as TableKey, node.position.x, node.position.y)}
        onConnect={handleConnect}
        isValidConnection={isValidConnection}
        connectionMode={ConnectionMode.Loose}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          gap={8}
          size={1}
          color={palette.gridMinor}
          variant={BackgroundVariant.Dots}
          bgColor={palette.canvasBg}
        />
        <MiniMap
          nodeColor={(n) => headerColors[n.id as TableKey] ?? palette.mutedForeground}
          nodeStrokeColor={palette.border}
          nodeBorderRadius={2}
          maskColor={isDark ? 'rgba(15,15,15,0.45)' : 'rgba(255,255,255,0.55)'}
          bgColor={palette.card}
          style={{ border: `1px solid ${palette.border}` }}
          pannable
          zoomable
          position="top-right"
        />
        <Controls position="top-left" showInteractive={false}>
          <ControlButton onClick={handleFitAll} title="Fit all tables">
            A
          </ControlButton>
          <ControlButton onClick={handleFitSelection} title="Fit selected tables">
            S
          </ControlButton>
        </Controls>
        <Panel position="bottom-left" className="rounded border border-border bg-background/80 px-2 py-1 text-[10px] text-muted-foreground">
          {diagramTool === 'connect' ? 'Connect mode: drag from source to target column handles.' : null}
          {diagramTool === 'pan' ? 'Pan mode: drag canvas. Hold Space in any mode to temporarily pan.' : null}
          {diagramTool === 'select' ? 'Select mode: click/shift-click tables, drag to move selection.' : null}
        </Panel>
      </ReactFlow>
    </div>
  )
}
