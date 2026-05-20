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
  PanOnScrollMode,
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
import { useTranslation } from 'react-i18next'

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
  onSelect: (key: TableKey, shiftKey: boolean) => void
  onRequestColumns: (key: TableKey) => void
  onQuickEditColumn?: (
    tableKey: TableKey,
    sourceColumnName: string,
    patch: { nextColumnName: string; nextDataType: string },
  ) => void
  editedColumnNames: ReadonlySet<string>
}

const MAX_ROWS = 8

type GroupNodeData = {
  name: string
}

const TableFlowNode = memo(({ data }: { data: TableNodeData }) => {
  const rows = useMemo(() => data.columns?.slice(0, MAX_ROWS) ?? [], [data.columns])
  const moreCount = data.columns && data.columns.length > MAX_ROWS ? data.columns.length - MAX_ROWS : 0
  const height = tableNodeHeight(data.columns ?? null, data.columnDetail)
  const headerFill = data.headerFill ?? 'var(--diagram-table-header)'
  const headerText = contrastTextForBg(headerFill)
  const canQuickEdit = Boolean(data.onQuickEditColumn)
  const [editingSource, setEditingSource] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [draftType, setDraftType] = useState('')
  const [inlineError, setInlineError] = useState<string | null>(null)
  const [hovered, setHovered] = useState(false)
  const showHandles = hovered && data.columnDetail !== 'header' && rows.length > 0

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
      className={`nopan relative block cursor-grab appearance-none rounded-md border bg-card text-left shadow-sm outline-none active:cursor-grabbing ${data.selected ? 'border-primary ring-1 ring-primary/35' : 'border-border'}`}
      style={{ width: TABLE_NODE_WIDTH, minHeight: height }}
      aria-label={`Table ${data.schema}.${data.name}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
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
      {(
        <>
          <Handle
            id="target:table"
            type="target"
            position={Position.Left}
            className="!left-[-12px] !top-1/2 !size-4 !rounded-full !border-2"
            style={{
              borderColor: 'var(--diagram-edge)',
              background: 'var(--diagram-card)',
              zIndex: 6,
              visibility: showHandles ? undefined : 'hidden',
            }}
            isConnectableStart={false}
            title={`Connect to ${data.schema}.${data.name}`}
          />
          <Handle
            id="source:table"
            type="source"
            position={Position.Right}
            className="!right-[-12px] !top-1/2 !size-4 !rounded-full !border-2"
            style={{
              borderColor: 'var(--diagram-edge)',
              background: 'var(--diagram-card)',
              zIndex: 6,
              visibility: showHandles ? undefined : 'hidden',
            }}
            isConnectableEnd={false}
            title={`Connect from ${data.schema}.${data.name}`}
          />
        </>
      )}
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
              <Handle
                    id={`in:${c.columnName}`}
                    type="target"
                    position={Position.Left}
                    style={{ left: -6, width: 8, height: 8, border: '1px solid var(--border)', visibility: showHandles ? undefined : 'hidden' }}
                  />
                  <Handle
                    id={`out:${c.columnName}`}
                    type="source"
                    position={Position.Right}
                    style={{ right: -6, width: 8, height: 8, border: '1px solid var(--border)', visibility: showHandles ? undefined : 'hidden' }}
                  />
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
                  <span className="truncate">
                    {c.columnName}
                    {data.editedColumnNames.has(c.columnName) ? (
                      <span className="ml-1 rounded bg-primary/15 px-1 py-0.5 text-[9px] font-semibold text-primary">
                        edited
                      </span>
                    ) : null}
                  </span>
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
  initialViewport,
  onViewportSave,
  tableDisplays,
  positions,
  columnsByKey,
  foreignKeys,
  selectedKeys,
  onTableSelect,
  onClearSelection,
  onTableDragStart,
  onTableDragMove,
  onMoveTable,
  onRequestColumns,
  onConnectColumns,
  onConnectTables,
  canConnectColumns,
  selectedEdgeId = null,
  onEdgeSelect,
  onQuickEditColumn,
  headerColors = {},
  editedColumnNamesByKey = {},
  pendingForeignKeys = [],
  columnDetail = 'full',
  diagramGroups = [],
  exportRef,
  viewportControlRef,
}: DiagramSurfaceProps) {
  const { t } = useTranslation()
  const wrapperRef = useRef<HTMLDivElement>(null)
  const rfRef = useRef<ReactFlowInstance<Node, Edge> | null>(null)
  const [spaceHeld, setSpaceHeld] = useState(false)

  const palette = useMemo(() => readDiagramPalette(isDark), [isDark])
  const paletteEdgeStyle = useMemo(() => ({
    committed: { stroke: palette.edge, labelFill: palette.edge },
    pending: { stroke: palette.edgePending, labelFill: palette.edgePending },
  }), [palette])
  const labelBgStyle = useMemo(() => ({
    fill: isDark ? 'rgba(15,15,15,0.85)' : 'rgba(255,255,255,0.85)',
    fillOpacity: 1,
  }), [isDark])
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
        draggable: true,
        data: {
          key: t.key,
          schema: t.schema,
          name: t.name,
          selected: selectedKeys.has(t.key),
          columns: columnsByKey[t.key] ?? null,
          headerFill: headerColors[t.key],
          columnDetail,
          onSelect: onTableSelect,
          onRequestColumns,
          onQuickEditColumn,
          editedColumnNames: editedColumnNamesByKey[t.key] ?? new Set<string>(),
        },
      }
    })
  }, [tableDisplays, positions, columnsByKey, headerColors, columnDetail, editedColumnNamesByKey, onQuickEditColumn, onRequestColumns, onTableSelect, selectedKeys])

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
    const mk = (kind: 'committed' | 'pending', edge: (typeof routed.committed)[number]): Edge => {
      const p = kind === 'pending' ? paletteEdgeStyle.pending : paletteEdgeStyle.committed
      return {
        id: edge.id,
        type: 'smoothstep',
        source: edge.fromKey,
        target: edge.toKey,
        sourceHandle: `out:${edge.fromColumn}`,
        targetHandle: `in:${edge.toColumn}`,
        markerEnd: { type: MarkerType.ArrowClosed, color: p.stroke },
        animated: kind === 'pending',
        label: `${edge.fromColumn} → ${edge.toColumn}`,
        labelShowBg: true,
        labelStyle: { fill: p.labelFill, fontSize: 9, fontWeight: 500 },
        labelBgStyle,
        labelBgPadding: [4, 2],
        labelBgBorderRadius: 3,
        style: {
          stroke: p.stroke,
          strokeWidth: selectedEdgeId === edge.id ? 3 : kind === 'pending' ? 2 : 1.5,
          strokeDasharray: kind === 'pending' ? '8 5' : undefined,
        },
        selectable: true,
        selected: selectedEdgeId === edge.id,
      }
    }
    return [...routed.committed.map((e) => mk('committed', e)), ...routed.pending.map((e) => mk('pending', e))]
  }, [paletteEdgeStyle, labelBgStyle, routed, selectedEdgeId])

  const handleConnect = useCallback(
    (connection: { source: string | null; target: string | null; sourceHandle: string | null; targetHandle: string | null }) => {
      const fromKey = connection.source as TableKey | null
      const toKey = connection.target as TableKey | null
      if (!fromKey || !toKey) return

      if (connection.sourceHandle === 'source:table' && connection.targetHandle === 'target:table') {
        onConnectTables?.(fromKey, toKey)
        return
      }

      const fromColumn = connection.sourceHandle?.replace(/^out:/, '')
      const toColumn = connection.targetHandle?.replace(/^in:/, '')
      if (!fromColumn || !toColumn || !onConnectColumns) return
      if (canConnectColumns && !canConnectColumns({ fromKey, fromColumn, toKey, toColumn })) return
      onConnectColumns(fromKey, fromColumn, toKey, toColumn)
    },
    [canConnectColumns, onConnectColumns, onConnectTables],
  )

  const isValidConnection = useCallback<IsValidConnection>(
    (connection) => {
      const fromKey = connection.source as TableKey | null
      const toKey = connection.target as TableKey | null
      if (!fromKey || !toKey || fromKey === toKey) return false

      if (connection.sourceHandle === 'source:table' || connection.targetHandle === 'target:table') {
        return true
      }

      const fromColumn = connection.sourceHandle?.replace(/^out:/, '')
      const toColumn = connection.targetHandle?.replace(/^in:/, '')
      if (!fromColumn || !toColumn) return false
      return canConnectColumns ? canConnectColumns({ fromKey, fromColumn, toKey, toColumn }) : true
    },
    [canConnectColumns],
  )

  const handleMove = useCallback(() => {
    // ReactFlow handles panning internally. No React state updates per-frame.
  }, [])

  const handleMoveEnd = useCallback(
    (_: MouseEvent | TouchEvent | null, vp: { x: number; y: number; zoom: number }) => {
      onViewportSave({ x: vp.x, y: vp.y, scale: vp.zoom })
    },
    [onViewportSave],
  )

  useEffect(() => {
    if (!viewportControlRef) return
    viewportControlRef.current = {
      setViewport: (v) => {
        rfRef.current?.setViewport({ x: v.x, y: v.y, zoom: v.scale }, { duration: 0 })
      },
      getViewport: () => {
        const vp = rfRef.current?.getViewport()
        return { x: vp?.x ?? 0, y: vp?.y ?? 0, scale: vp?.zoom ?? 1 }
      },
    }
    return () => {
      viewportControlRef.current = null
    }
  }, [viewportControlRef])

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
        rfRef.current?.setViewport({ x: current.x, y: current.y, zoom: next }, { duration: 0 })
        onViewportSave({ x: current.x, y: current.y, scale: next })
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault()
        const next = Math.max(0.15, current.zoom / 1.12)
        rfRef.current?.setViewport({ x: current.x, y: current.y, zoom: next }, { duration: 0 })
        onViewportSave({ x: current.x, y: current.y, scale: next })
      } else if (e.key === '0') {
        e.preventDefault()
        rfRef.current?.setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 0 })
        onViewportSave({ x: 0, y: 0, scale: 1 })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onClearSelection, onViewportSave])

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
        defaultViewport={{ x: initialViewport.x, y: initialViewport.y, zoom: initialViewport.scale }}
        fitView={false}
        minZoom={0.15}
        maxZoom={2.5}
        translateExtent={[[-8000, -8000], [8000, 8000]]}
        panOnDrag={spaceHeld ? true : [1]}
        panOnScroll={true}
        panOnScrollMode={PanOnScrollMode.Free}
        panOnScrollSpeed={0.9}
        zoomOnScroll={false}
        zoomActivationKeyCode={['Meta', 'Control']}
        zoomOnPinch={true}
        zoomOnDoubleClick={false}
        selectionOnDrag={!spaceHeld}
        elementsSelectable={true}
        nodesConnectable={true}
        onInit={(instance) => {
          rfRef.current = instance
        }}
        onMove={handleMove}
        onMoveEnd={handleMoveEnd}
         onPaneClick={onClearSelection}
         onPaneContextMenu={() => onEdgeSelect?.(null)}
         onNodeClick={(evt, node) => onTableSelect(node.id as TableKey, evt.shiftKey)}
        onEdgeClick={(evt, edge) => {
          evt.preventDefault()
          onEdgeSelect?.(
            routed.pending.some((row) => row.id === edge.id)
              ? {
                  id: edge.id,
                  kind: 'pending',
                  fromKey: edge.source as TableKey,
                  fromColumn: (edge.sourceHandle ?? '').replace(/^out:/, ''),
                  toKey: edge.target as TableKey,
                  toColumn: (edge.targetHandle ?? '').replace(/^in:/, ''),
                }
              : {
                  id: edge.id,
                  kind: 'committed',
                  fromKey: edge.source as TableKey,
                  fromColumn: (edge.sourceHandle ?? '').replace(/^out:/, ''),
                  toKey: edge.target as TableKey,
                  toColumn: (edge.targetHandle ?? '').replace(/^in:/, ''),
                },
          )
        }}
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
          nodeColor={(n) => headerColors[n.id as TableKey] ?? (isDark ? '#818cf8' : '#6366f1')}
          nodeStrokeColor={isDark ? '#6366f1' : '#818cf8'}
          nodeBorderRadius={3}
          nodeStrokeWidth={1}
          maskColor={isDark ? 'rgba(10,10,15,0.6)' : 'rgba(240,240,245,0.6)'}
          bgColor={palette.canvasBg}
          style={{ width: 160, height: 100, border: `1px solid ${palette.border}` }}
          pannable
          zoomable
          position="top-right"
        />
        <Controls position="top-left" showInteractive={false}>
          <ControlButton onClick={handleFitAll} title={t("model.fitAllTables")}>
            A
          </ControlButton>
          <ControlButton onClick={handleFitSelection} title={t("model.fitSelectedTables")}>
            S
          </ControlButton>
        </Controls>
        <Panel position="bottom-left" className="rounded border border-border bg-background/80 px-2 py-1 text-[10px] text-muted-foreground">
          {t("model.diagramHelp")}
        </Panel>
      </ReactFlow>
    </div>
  )
}
