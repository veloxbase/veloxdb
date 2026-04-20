import type { Stage as KonvaStage } from 'konva/lib/Stage'
import { useQueries, useQueryClient } from '@tanstack/react-query'
import {
  AlignBottomIcon,
  AlignLeftIcon,
  AlignRightIcon,
  AlignTopIcon,
  ArrowsClockwiseIcon,
  ArrowsInSimpleIcon,
  CursorIcon,
  DownloadSimpleIcon,
  FilePdfIcon,
  GridFourIcon,
  HandGrabbingIcon,
  LinkSimpleIcon,
  MagnetIcon,
  PlusIcon,
  SquaresFourIcon,
  TrashIcon,
  TreeStructureIcon,
} from '@phosphor-icons/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { queryKeys } from '@/data/query-keys'
import { veloxDbRepository } from '@/data/repositories'
import type { ColumnInfo, TableInfo } from '@/data/types'
import {
  applyEntireModel,
  type ColumnOverride,
  type PendingModelColumn,
  type PendingModelForeignKey,
  type TableIdentityDraft,
} from '@/features/model/apply-entire-model'
import { DdlReviewDialog } from '@/features/model/components/DdlReviewDialog'
import { DiagramCanvas } from '@/features/model/components/DiagramCanvas'
import { DiagramMinimap } from '@/features/model/components/DiagramMinimap'
import { ModelCatalog } from '@/features/model/components/ModelCatalog'
import { ModelInspector } from '@/features/model/components/ModelInspector'
import {
  alignSelectedBottom,
  alignSelectedLeft,
  alignSelectedRight,
  alignSelectedTop,
  snapPoint,
} from '@/features/model/diagram-geometry/snap'
import { topologicalLayoutOrder } from '@/features/model/diagram-geometry/topological-layout-order'
import {
  deleteDiagramViewLayout,
  duplicateLayoutSnapshotForNewView,
  ensurePositions,
  gridPositionForIndex,
  loadDiagramLayout,
  loadDiagramViewsRegistry,
  saveDiagramLayout,
  saveDiagramViewsRegistry,
} from '@/features/model/model-layout-storage'
import { defaultDiagramHeaderHex as distinctDiagramHeaderHex } from '@/features/model/diagram-header-palette'
import { TABLE_NODE_WIDTH, tableNodeHeight } from '@/features/model/table-node-metrics'
import { readKonvaPalette } from '@/features/model/konva-theme'
import {
  DEFAULT_DIAGRAM_VIEW_ID,
  tableKey,
  type ColumnDetailLevel,
  type DiagramGroup,
  type DiagramLayoutSnapshot,
  type TableKey,
  type ViewportState,
} from '@/features/model/model-types'
import { useForeignKeysQuery } from '@/features/model/queries'
import { useContainerSize } from '@/features/model/use-container-size'
import { useDiagramInteraction } from '@/features/model/use-diagram-interaction'
import { rgbCssToHex } from '@/lib/contrast-text-for-bg'
import { cn } from '@/lib/utils'

type ModelWorkspaceProps = {
  connectionId: string
  defaultDatabaseName: string
  isDark: boolean
  tables: TableInfo[]
  tablesErrorMessage?: string
  isTablesLoading: boolean
  selectedTable: TableInfo | null
}

export function ModelWorkspace({
  connectionId,
  defaultDatabaseName,
  isDark,
  tables,
  tablesErrorMessage,
  isTablesLoading,
  selectedTable,
}: ModelWorkspaceProps) {
  const queryClient = useQueryClient()
  const foreignKeysQuery = useForeignKeysQuery(connectionId)

  const boot = useMemo(() => {
    const vr = loadDiagramViewsRegistry(connectionId)
    const aid = vr.activeViewId
    const snap = loadDiagramLayout(connectionId, aid)
    return { vr, aid, snap }
  }, [connectionId])

  const {
    tool: diagramTool,
    setTool: setDiagramTool,
    selectedKeys,
    setSelectedKeys,
    primaryKey,
    replaceSelection,
    selectTable,
    clearSelection,
    applyMarquee,
    selectSingleFromCatalog,
  } = useDiagramInteraction(() => {
    const t = boot.snap?.diagramTool
    return t === 'pan' || t === 'connect' || t === 'select' ? t : 'select'
  })

  const diagramWrapRef = useRef<HTMLDivElement>(null)
  const diagramAreaSize = useContainerSize(diagramWrapRef)

  const [viewsRegistry, setViewsRegistry] = useState(() => boot.vr)
  const activeViewId = viewsRegistry.activeViewId

  const [hadStoredLayout] = useState(() => boot.snap !== null)
  const [snapToGrid, setSnapToGrid] = useState(() => boot.snap?.snapToGrid !== false)
  const [onCanvas, setOnCanvas] = useState<TableKey[]>(() => boot.snap?.onCanvas ?? [])
  const [positions, setPositions] = useState<Record<TableKey, { x: number; y: number }>>(
    () => boot.snap?.positions ?? {},
  )
  const [viewport, setViewport] = useState<ViewportState>(
    () => boot.snap?.viewport ?? { scale: 1, x: 0, y: 0 },
  )
  const [modelTitle, setModelTitle] = useState(
    () => boot.snap?.modelTitle?.trim() || defaultDatabaseName,
  )
  const [headerColorsByKey, setHeaderColorsByKey] = useState<Record<TableKey, string>>(
    () => ({ ...(boot.snap?.headerColors ?? {}) }),
  )
  const [columnDetail, setColumnDetail] = useState<ColumnDetailLevel>(() => {
    const c = boot.snap?.columnDetail
    return c === 'keys' || c === 'header' ? c : 'full'
  })
  const [diagramGroups, setDiagramGroups] = useState<DiagramGroup[]>(
    () => boot.snap?.diagramGroups ?? [],
  )
  const [columnRequestKeys, setColumnRequestKeys] = useState<TableKey[]>([])
  const [modelTab, setModelTab] = useState<'diagram' | 'catalog'>('diagram')
  const [ddlOpen, setDdlOpen] = useState(false)
  const [identityDraftByKey, setIdentityDraftByKey] = useState<Record<TableKey, TableIdentityDraft>>({})
  const [columnOverridesByKey, setColumnOverridesByKey] = useState<
    Record<TableKey, Record<string, ColumnOverride>>
  >({})
  const [pendingAddColumnsByKey, setPendingAddColumnsByKey] = useState<
    Record<TableKey, PendingModelColumn[]>
  >({})
  const [pendingForeignKeys, setPendingForeignKeys] = useState<PendingModelForeignKey[]>([])
  const [applyPending, setApplyPending] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)

  const fkSeedDoneRef = useRef(false)

  const tablesByKey = useMemo(() => {
    const m = new Map<TableKey, TableInfo>()
    for (const t of tables) {
      m.set(tableKey(t), t)
    }
    return m
  }, [tables])

  useEffect(() => {
    if (hadStoredLayout) return
    if (fkSeedDoneRef.current) return
    const fkData = foreignKeysQuery.data
    if (!fkData?.length || !tables.length) return

    const keys = new Set<TableKey>()
    for (const e of fkData) {
      keys.add(`${e.fromSchema}.${e.fromTable}`)
      keys.add(`${e.toSchema}.${e.toTable}`)
    }
    const valid = [...keys].filter((k) => tables.some((t) => tableKey(t) === k))
    if (valid.length === 0) return

    fkSeedDoneRef.current = true
    queueMicrotask(() => {
      setOnCanvas(valid)
      setPositions((p) => ensurePositions(valid, p))
    })
  }, [hadStoredLayout, foreignKeysQuery.data, tables])

  useEffect(() => {
    if (!selectedTable) return
    const k = tableKey(selectedTable)
    queueMicrotask(() => {
      selectSingleFromCatalog(k)
      setColumnRequestKeys((prev) => (prev.includes(k) ? prev : [...prev, k]))
      setOnCanvas((prev) => (prev.includes(k) ? prev : [...prev, k]))
      setPositions((p) => ensurePositions([k], p))
    })
  }, [selectSingleFromCatalog, selectedTable])

  useEffect(() => {
    if (!primaryKey) return
    const t = tablesByKey.get(primaryKey)
    if (!t) return
    setIdentityDraftByKey((prev) =>
      prev[primaryKey] != null ? prev : { ...prev, [primaryKey]: { schema: t.schema, name: t.name } },
    )
  }, [primaryKey, tablesByKey])

  const sortedRequestKeys = useMemo(() => [...columnRequestKeys].sort(), [columnRequestKeys])

  const columnQueries = useQueries({
    queries: sortedRequestKeys.map((key) => {
      const table = tablesByKey.get(key)
      return {
        queryKey: queryKeys.schema(connectionId, table ?? null),
        queryFn: () => {
          if (!table) throw new Error('Table not found for schema request.')
          return veloxDbRepository.getSchema(connectionId, table)
        },
        enabled: Boolean(connectionId && table),
        staleTime: 5 * 60 * 1000,
      }
    }),
  })

  const diagramPalette = useMemo(() => readKonvaPalette(isDark), [isDark])
  const themeDiagramHeaderHex = useMemo(
    () => rgbCssToHex(diagramPalette.header),
    [diagramPalette.header],
  )

  const columnsByKey = useMemo(() => {
    const out: Record<TableKey, ColumnInfo[] | null> = {}
    sortedRequestKeys.forEach((key, i) => {
      const q = columnQueries[i]
      if (!q) {
        out[key] = null
        return
      }
      if (q.isPending && !q.data) out[key] = null
      else if (q.data) out[key] = q.data
      else out[key] = null
    })
    return out
  }, [columnQueries, sortedRequestKeys])

  useEffect(() => {
    const t = window.setTimeout(() => {
      saveDiagramLayout(
        connectionId,
        {
          onCanvas,
          positions,
          viewport,
          modelTitle: modelTitle.trim() || defaultDatabaseName,
          diagramTool,
          snapToGrid,
          columnDetail,
          ...(diagramGroups.length > 0 ? { diagramGroups } : {}),
          ...(Object.keys(headerColorsByKey).length > 0 ? { headerColors: headerColorsByKey } : {}),
        },
        activeViewId,
      )
      saveDiagramViewsRegistry(connectionId, viewsRegistry)
    }, 400)
    return () => window.clearTimeout(t)
  }, [
    activeViewId,
    columnDetail,
    connectionId,
    defaultDatabaseName,
    diagramGroups,
    diagramTool,
    headerColorsByKey,
    modelTitle,
    onCanvas,
    positions,
    snapToGrid,
    viewsRegistry,
    viewport,
  ])

  const onCanvasSet = useMemo(() => new Set(onCanvas), [onCanvas])

  const fkColumnNamesByKey = useMemo(() => {
    const m = new Map<TableKey, Set<string>>()
    const add = (tab: TableKey, col: string) => {
      if (!onCanvasSet.has(tab)) return
      if (!m.has(tab)) m.set(tab, new Set())
      m.get(tab)!.add(col)
    }
    for (const fk of foreignKeysQuery.data ?? []) {
      add(`${fk.fromSchema}.${fk.fromTable}` as TableKey, fk.fromColumn)
      add(`${fk.toSchema}.${fk.toTable}` as TableKey, fk.toColumn)
    }
    for (const p of pendingForeignKeys) {
      add(p.fromKey, p.fromColumn)
      add(p.toKey, p.toColumn)
    }
    return m
  }, [foreignKeysQuery.data, onCanvasSet, pendingForeignKeys])

  const diagramDisplayColumnsByKey = useMemo((): Record<TableKey, ColumnInfo[] | null> => {
    const out: Record<TableKey, ColumnInfo[] | null> = {}
    for (const k of onCanvas) {
      const cols = columnsByKey[k] ?? null
      if (columnDetail === 'header') {
        out[k] = []
        continue
      }
      if (columnDetail === 'keys' && cols?.length) {
        const set = fkColumnNamesByKey.get(k)
        const filtered = set?.size ? cols.filter((c) => set.has(c.columnName)) : cols.slice(0, 4)
        out[k] = filtered.length > 0 ? filtered : cols.slice(0, 4)
        continue
      }
      out[k] = cols
    }
    return out
  }, [columnDetail, columnsByKey, fkColumnNamesByKey, onCanvas])

  useEffect(() => {
    const keys = new Set<TableKey>()
    for (const fk of foreignKeysQuery.data ?? []) {
      const fromK = `${fk.fromSchema}.${fk.fromTable}` as TableKey
      const toK = `${fk.toSchema}.${fk.toTable}` as TableKey
      if (onCanvasSet.has(fromK)) keys.add(fromK)
      if (onCanvasSet.has(toK)) keys.add(toK)
    }
    for (const p of pendingForeignKeys) {
      keys.add(p.fromKey)
      keys.add(p.toKey)
    }
    if (keys.size === 0) return
    setColumnRequestKeys((prev) => {
      let next = prev
      for (const k of keys) {
        if (!next.includes(k)) next = [...next, k]
      }
      return next
    })
  }, [foreignKeysQuery.data, onCanvasSet, pendingForeignKeys])

  const tablesOnCanvas = useMemo(() => {
    const list: TableInfo[] = []
    for (const k of onCanvas) {
      const t = tablesByKey.get(k)
      if (t) list.push(t)
    }
    return list
  }, [onCanvas, tablesByKey])

  const tableDisplays = useMemo(() => {
    return tablesOnCanvas.map((t) => {
      const k = tableKey(t)
      const id = identityDraftByKey[k]
      return {
        key: k,
        schema: id?.schema ?? t.schema,
        name: id?.name ?? t.name,
      }
    })
  }, [tablesOnCanvas, identityDraftByKey])

  const resolvedHeaderColors = useMemo(() => {
    const out: Record<TableKey, string> = {}
    for (const t of tableDisplays) {
      out[t.key] = headerColorsByKey[t.key] ?? distinctDiagramHeaderHex(t.key, isDark)
    }
    return out
  }, [tableDisplays, headerColorsByKey, isDark])

  const inspectorTable = useMemo(() => {
    if (!primaryKey) return null
    return tablesByKey.get(primaryKey) ?? null
  }, [primaryKey, tablesByKey])

  const identityDraftForInspector = useMemo((): TableIdentityDraft | null => {
    if (!primaryKey || !inspectorTable) return null
    return identityDraftByKey[primaryKey] ?? {
      schema: inspectorTable.schema,
      name: inspectorTable.name,
    }
  }, [primaryKey, inspectorTable, identityDraftByKey])

  const selectedKeysSet = useMemo(() => new Set(selectedKeys), [selectedKeys])

  const positionsRef = useRef(positions)
  positionsRef.current = positions
  const selectedKeysRef = useRef(selectedKeys)
  selectedKeysRef.current = selectedKeys
  const onCanvasRef = useRef(onCanvas)
  onCanvasRef.current = onCanvas

  type TableDragState = {
    draggedKey: TableKey
    keys: TableKey[]
    start: Record<TableKey, { x: number; y: number }>
  }
  const tableDragStateRef = useRef<TableDragState | null>(null)
  const diagramStageRef = useRef<KonvaStage | null>(null)

  const isModelDirty = useMemo(() => {
    if (pendingForeignKeys.length > 0) return true
    for (const k of onCanvas) {
      const t = tablesByKey.get(k)
      if (!t) continue
      const id = identityDraftByKey[k]
      if (id && (id.schema !== t.schema || id.name !== t.name)) return true
      const co = columnOverridesByKey[k]
      if (co && Object.keys(co).length > 0) return true
      const adds = pendingAddColumnsByKey[k]
      if (adds && adds.length > 0) return true
    }
    return false
  }, [
    onCanvas,
    tablesByKey,
    identityDraftByKey,
    columnOverridesByKey,
    pendingAddColumnsByKey,
    pendingForeignKeys,
  ])

  const catalogTablesSorted = useMemo(() => {
    return [...tables].sort((a, b) => tableKey(a).localeCompare(tableKey(b)))
  }, [tables])

  const requestColumns = useCallback((key: TableKey) => {
    setColumnRequestKeys((prev) => (prev.includes(key) ? prev : [...prev, key]))
  }, [])

  const handleSelectKey = useCallback(
    (key: TableKey | null) => {
      if (key == null) {
        clearSelection()
        return
      }
      selectSingleFromCatalog(key)
      requestColumns(key)
    },
    [clearSelection, requestColumns, selectSingleFromCatalog],
  )

  const handleAddToCanvas = useCallback(
    (table: TableInfo) => {
      const k = tableKey(table)
      setOnCanvas((prev) => (prev.includes(k) ? prev : [...prev, k]))
      setPositions((p) => ensurePositions([k], p))
      selectTable(k, false)
      setIdentityDraftByKey((prev) =>
        prev[k] != null ? prev : { ...prev, [k]: { schema: table.schema, name: table.name } },
      )
      requestColumns(k)
      setModelTab('diagram')
    },
    [requestColumns, selectTable],
  )

  const handleRemoveFromCanvas = useCallback((table: TableInfo) => {
    const k = tableKey(table)
    setOnCanvas((prev) => prev.filter((x) => x !== k))
    setSelectedKeys((prev) => prev.filter((x) => x !== k))
    setIdentityDraftByKey((prev) => {
      const next = { ...prev }
      delete next[k]
      return next
    })
    setColumnOverridesByKey((prev) => {
      const next = { ...prev }
      delete next[k]
      return next
    })
    setPendingAddColumnsByKey((prev) => {
      const next = { ...prev }
      delete next[k]
      return next
    })
    setPendingForeignKeys((prev) => prev.filter((fk) => fk.fromKey !== k && fk.toKey !== k))
    setHeaderColorsByKey((prev) => {
      if (prev[k] == null) return prev
      const next = { ...prev }
      delete next[k]
      return next
    })
  }, [setSelectedKeys])

  const snapIf = useCallback(
    (p: { x: number; y: number }) => (snapToGrid ? snapPoint(p) : p),
    [snapToGrid],
  )

  const applyTableDragPositions = useCallback(
    (key: TableKey, x: number, y: number) => {
      const d = tableDragStateRef.current
      if (!d || d.draggedKey !== key) {
        setPositions((prev) => ({ ...prev, [key]: snapIf({ x, y }) }))
        return
      }
      const startPrimary = d.start[key]
      const deltaX = x - startPrimary.x
      const deltaY = y - startPrimary.y
      setPositions((prev) => {
        const next = { ...prev }
        for (const k of d.keys) {
          const s = d.start[k]
          if (!s) continue
          next[k] = snapIf({ x: s.x + deltaX, y: s.y + deltaY })
        }
        return next
      })
    },
    [snapIf],
  )

  const handleTableDragStart = useCallback((key: TableKey) => {
    const pos = positionsRef.current
    const sel = selectedKeysRef.current
    const canvasKeys = new Set(onCanvasRef.current)
    let keys =
      sel.length > 1 && sel.includes(key) ? sel.filter((k) => canvasKeys.has(k)) : [key]
    if (keys.length === 0) keys = [key]
    const start: Record<TableKey, { x: number; y: number }> = {}
    for (const k of keys) {
      const p = pos[k]
      start[k] = p ? { ...p } : { x: 0, y: 0 }
    }
    tableDragStateRef.current = { draggedKey: key, keys, start }
  }, [])

  const handleTableDragMove = useCallback(
    (key: TableKey, x: number, y: number) => {
      applyTableDragPositions(key, x, y)
    },
    [applyTableDragPositions],
  )

  const handleMoveTable = useCallback(
    (key: TableKey, x: number, y: number) => {
      applyTableDragPositions(key, x, y)
      tableDragStateRef.current = null
    },
    [applyTableDragPositions],
  )

  const handleAutoLayoutGrid = useCallback(() => {
    setPositions((prev) => {
      const next = { ...prev }
      onCanvas.forEach((k, i) => {
        const raw = gridPositionForIndex(i)
        next[k] = snapToGrid ? snapPoint(raw) : raw
      })
      return next
    })
  }, [onCanvas, snapToGrid])

  const handleExportDiagramPng = useCallback(() => {
    const stage = diagramStageRef.current
    if (!stage) return
    const data = stage.toDataURL({ pixelRatio: 2 })
    const a = document.createElement('a')
    a.href = data
    const safe = (modelTitle.trim() || defaultDatabaseName).replace(/[^\w.-]+/g, '_')
    a.download = `${safe}-diagram.png`
    a.click()
  }, [defaultDatabaseName, modelTitle])

  const handleConnectColumns = useCallback(
    (fromKey: TableKey, fromColumn: string, toKey: TableKey, toColumn: string) => {
      requestColumns(fromKey)
      requestColumns(toKey)
      setPendingForeignKeys((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          fromKey,
          fromColumn,
          toKey,
          toColumn,
        },
      ])
    },
    [requestColumns],
  )

  const applyAlign = useCallback(
    (mode: 'left' | 'right' | 'top' | 'bottom') => {
      if (selectedKeys.length < 2) return
      setPositions((prev) => {
        if (mode === 'left') return alignSelectedLeft(selectedKeys, prev)
        if (mode === 'right') return alignSelectedRight(selectedKeys, prev)
        if (mode === 'top') return alignSelectedTop(selectedKeys, prev)
        return alignSelectedBottom(selectedKeys, prev, diagramDisplayColumnsByKey, columnDetail)
      })
    },
    [columnDetail, diagramDisplayColumnsByKey, selectedKeys],
  )

  const handleAutoLayoutTopo = useCallback(() => {
    const order = topologicalLayoutOrder(onCanvas, foreignKeysQuery.data ?? [])
    setPositions((prev) => {
      const next = { ...prev }
      order.forEach((k, i) => {
        const raw = gridPositionForIndex(i)
        next[k] = snapToGrid ? snapPoint(raw) : raw
      })
      return next
    })
  }, [foreignKeysQuery.data, onCanvas, snapToGrid])

  const handleResetViewport = useCallback(() => {
    setViewport({ scale: 1, x: 0, y: 0 })
  }, [])

  const handleResetLayout = useCallback(() => {
    setPositions((prev) => {
      const next = { ...prev }
      onCanvas.forEach((k, i) => {
        const raw = gridPositionForIndex(i)
        next[k] = snapToGrid ? snapPoint(raw) : raw
      })
      return next
    })
  }, [onCanvas, snapToGrid])

  const handleDiagramViewChange = useCallback(
    (nextId: string) => {
      if (nextId === activeViewId) return
      saveDiagramLayout(
        connectionId,
        {
          onCanvas,
          positions,
          viewport,
          modelTitle: modelTitle.trim() || defaultDatabaseName,
          diagramTool,
          snapToGrid,
          columnDetail,
          ...(diagramGroups.length > 0 ? { diagramGroups } : {}),
          ...(Object.keys(headerColorsByKey).length > 0 ? { headerColors: headerColorsByKey } : {}),
        },
        activeViewId,
      )
      const nextReg = { ...viewsRegistry, activeViewId: nextId }
      saveDiagramViewsRegistry(connectionId, nextReg)
      setViewsRegistry(nextReg)
      const snap = loadDiagramLayout(connectionId, nextId)
      if (snap) {
        setSnapToGrid(snap.snapToGrid !== false)
        setOnCanvas([...snap.onCanvas])
        setPositions({ ...snap.positions })
        setViewport({ ...snap.viewport })
        setModelTitle(snap.modelTitle?.trim() || defaultDatabaseName)
        setHeaderColorsByKey({ ...(snap.headerColors ?? {}) })
        const tool = snap.diagramTool
        if (tool === 'pan' || tool === 'connect' || tool === 'select') setDiagramTool(tool)
        const cd = snap.columnDetail
        setColumnDetail(cd === 'keys' || cd === 'header' ? cd : 'full')
        setDiagramGroups(snap.diagramGroups ?? [])
      }
    },
    [
      activeViewId,
      columnDetail,
      connectionId,
      defaultDatabaseName,
      diagramGroups,
      diagramTool,
      headerColorsByKey,
      modelTitle,
      onCanvas,
      positions,
      snapToGrid,
      setDiagramTool,
      viewport,
      viewsRegistry,
    ],
  )

  const handleNewDiagramView = useCallback(() => {
    const id = crypto.randomUUID()
    const name = `View ${viewsRegistry.views.length + 1}`
    const snap: DiagramLayoutSnapshot = {
      onCanvas,
      positions,
      viewport,
      modelTitle: modelTitle.trim() || defaultDatabaseName,
      diagramTool,
      snapToGrid,
      columnDetail,
      ...(diagramGroups.length > 0 ? { diagramGroups } : {}),
      ...(Object.keys(headerColorsByKey).length > 0 ? { headerColors: headerColorsByKey } : {}),
    }
    duplicateLayoutSnapshotForNewView(connectionId, activeViewId, id, snap)
    const nextReg = {
      activeViewId: id,
      views: [...viewsRegistry.views, { id, name }],
    }
    saveDiagramViewsRegistry(connectionId, nextReg)
    setViewsRegistry(nextReg)
  }, [
    activeViewId,
    columnDetail,
    connectionId,
    defaultDatabaseName,
    diagramGroups,
    diagramTool,
    headerColorsByKey,
    modelTitle,
    onCanvas,
    positions,
    snapToGrid,
    viewsRegistry.views,
    viewport,
  ])

  const handleDeleteDiagramView = useCallback(() => {
    if (activeViewId === DEFAULT_DIAGRAM_VIEW_ID) return
    if (viewsRegistry.views.length < 2) return
    deleteDiagramViewLayout(connectionId, activeViewId)
    const remaining = viewsRegistry.views.filter((v) => v.id !== activeViewId)
    const nextId = remaining[0]?.id ?? DEFAULT_DIAGRAM_VIEW_ID
    const nextReg = { activeViewId: nextId, views: remaining }
    saveDiagramViewsRegistry(connectionId, nextReg)
    setViewsRegistry(nextReg)
    const snap = loadDiagramLayout(connectionId, nextId)
    if (snap) {
      setSnapToGrid(snap.snapToGrid !== false)
      setOnCanvas([...snap.onCanvas])
      setPositions({ ...snap.positions })
      setViewport({ ...snap.viewport })
      setModelTitle(snap.modelTitle?.trim() || defaultDatabaseName)
      setHeaderColorsByKey({ ...(snap.headerColors ?? {}) })
      const tool = snap.diagramTool
      if (tool === 'pan' || tool === 'connect' || tool === 'select') setDiagramTool(tool)
      const cd = snap.columnDetail
      setColumnDetail(cd === 'keys' || cd === 'header' ? cd : 'full')
      setDiagramGroups(snap.diagramGroups ?? [])
    }
  }, [
    activeViewId,
    connectionId,
    defaultDatabaseName,
    setDiagramTool,
    viewsRegistry.views,
  ])

  const handleFitTableOnDiagram = useCallback(
    (key: TableKey) => {
      requestColumns(key)
      const pos = positions[key]
      if (!pos) return
      const cols = diagramDisplayColumnsByKey[key] ?? null
      const w = TABLE_NODE_WIDTH
      const h = tableNodeHeight(cols, columnDetail)
      const cw = diagramAreaSize.w
      const ch = diagramAreaSize.h
      if (cw < 32 || ch < 32) return
      const pad = 48
      const scale = Math.min(cw / (w + pad * 2), ch / (h + pad * 2), 2.5)
      const scaleClamped = Math.max(0.15, scale)
      const cx = pos.x + w / 2
      const cy = pos.y + h / 2
      setViewport({
        scale: scaleClamped,
        x: cw / 2 - cx * scaleClamped,
        y: ch / 2 - cy * scaleClamped,
      })
      setModelTab('diagram')
    },
    [columnDetail, diagramAreaSize.h, diagramAreaSize.w, diagramDisplayColumnsByKey, positions, requestColumns],
  )

  const handleExportDiagramPdf = useCallback(() => {
    const stage = diagramStageRef.current
    if (!stage) return
    const data = stage.toDataURL({ pixelRatio: 2 })
    const safe = (modelTitle.trim() || defaultDatabaseName).replace(/[^\w.-]+/g, '_')
    const w = window.open('')
    if (!w) return
    w.document.write(
      `<!DOCTYPE html><html><head><title>${safe}</title></head><body style="margin:0;display:flex;justify-content:center;align-items:center;background:#111;">` +
        `<img src="${data}" style="max-width:100%;height:auto;" alt="diagram" />` +
        `<script>window.onload=function(){window.print()}</script></body></html>`,
    )
    w.document.close()
  }, [defaultDatabaseName, modelTitle])

  const handleAddGroupFromSelection = useCallback(() => {
    if (selectedKeys.length < 2) return
    const keysOnCanvas = selectedKeys.filter((k) => onCanvas.includes(k))
    if (keysOnCanvas.length < 2) return
    setDiagramGroups((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        name: `Group ${prev.length + 1}`,
        tableKeys: keysOnCanvas,
      },
    ])
  }, [onCanvas, selectedKeys])

  const handleApplyEntireModel = useCallback(async () => {
    setApplyError(null)
    setApplyPending(true)
    try {
      const result = await applyEntireModel({
        connectionId,
        onCanvas,
        tablesByKey,
        identityDraftByKey,
        columnOverridesByKey,
        pendingAddColumnsByKey,
        pendingForeignKeys,
      })

      let nextOnCanvas = [...onCanvas]
      const nextPos = { ...positions }
      const nextHeaderColors = { ...headerColorsByKey }
      for (const { from, to } of result.renamed) {
        nextOnCanvas = nextOnCanvas.map((x) => (x === from ? to : x))
        if (nextPos[from]) {
          nextPos[to] = nextPos[from]
          delete nextPos[from]
        }
        if (nextHeaderColors[from]) {
          nextHeaderColors[to] = nextHeaderColors[from]
          delete nextHeaderColors[from]
        }
      }

      setOnCanvas(nextOnCanvas)
      setPositions(nextPos)
      setHeaderColorsByKey(nextHeaderColors)
      setIdentityDraftByKey({})
      setColumnOverridesByKey({})
      setPendingAddColumnsByKey({})
      setPendingForeignKeys([])

      const remapKey = (k: TableKey) => result.renamed.find((r) => r.from === k)?.to ?? k
      const nextSelected = [...new Set(selectedKeys.map(remapKey))].filter((k) =>
        nextOnCanvas.includes(k),
      )
      let nextPrimary: TableKey | null = primaryKey
      if (nextPrimary) {
        nextPrimary = remapKey(nextPrimary)
        if (!nextOnCanvas.includes(nextPrimary)) nextPrimary = nextSelected[0] ?? null
      } else {
        nextPrimary = nextSelected[0] ?? null
      }
      replaceSelection(nextSelected, nextPrimary)

      void queryClient.invalidateQueries({ queryKey: queryKeys.tables(connectionId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.foreignKeys(connectionId) })
      void queryClient.invalidateQueries({ queryKey: ['schema'] })
      void queryClient.invalidateQueries({ queryKey: ['tableProperties'] })
      void queryClient.invalidateQueries({ queryKey: ['tableIndexes'] })
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : 'Failed to apply model')
    } finally {
      setApplyPending(false)
    }
  }, [
    columnOverridesByKey,
    connectionId,
    identityDraftByKey,
    onCanvas,
    pendingAddColumnsByKey,
    headerColorsByKey,
    pendingForeignKeys,
    positions,
    primaryKey,
    queryClient,
    replaceSelection,
    selectedKeys,
    tablesByKey,
  ])

  if (isTablesLoading && !tables.length) {
    return (
      <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
        Loading tables…
      </div>
    )
  }

  if (tablesErrorMessage) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 text-center text-xs text-destructive">
        {tablesErrorMessage}
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="flex shrink-0 flex-col gap-2 border-b border-border px-3 py-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <label className="text-[10px] font-medium text-muted-foreground" htmlFor="model-workspace-title">
            Model / database label
          </label>
          <Input
            id="model-workspace-title"
            className="h-8 max-w-sm text-xs"
            value={modelTitle}
            onChange={(e) => setModelTitle(e.target.value)}
            placeholder={defaultDatabaseName}
            spellCheck={false}
          />
          <div className="text-[11px] text-muted-foreground">
            {foreignKeysQuery.isLoading ? 'Loading relationships…' : null}
            {foreignKeysQuery.isError ? (
              <span className="text-destructive">
                {foreignKeysQuery.error instanceof Error
                  ? foreignKeysQuery.error.message
                  : 'Failed to load foreign keys'}
              </span>
            ) : null}
            {applyError ? <span className="mt-1 block text-destructive">{applyError}</span> : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            className="h-8 text-xs"
            disabled={applyPending || !isModelDirty}
            onClick={() => void handleApplyEntireModel()}
          >
            {applyPending ? 'Applying…' : 'Apply entire model'}
          </Button>
          <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => setDdlOpen(true)}>
            Run DDL script…
          </Button>
        </div>
      </div>

      <Tabs
        value={modelTab}
        onValueChange={(v) => setModelTab(v as 'diagram' | 'catalog')}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <div className="shrink-0 border-b border-border px-3 pt-2">
          <TabsList variant="line" className="h-8">
            <TabsTrigger value="diagram" className="text-xs">
              Diagram
            </TabsTrigger>
            <TabsTrigger value="catalog" className="text-xs">
              Catalog
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="diagram" className="m-0 flex min-h-0 flex-1 data-[state=inactive]:hidden">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-2 py-1.5">
              <span className="mr-1 text-[10px] font-medium text-muted-foreground">Tools</span>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className={cn('size-8', diagramTool === 'select' && 'border-primary bg-primary/10')}
                title="Select / move tables"
                aria-pressed={diagramTool === 'select'}
                onClick={() => setDiagramTool('select')}
              >
                <CursorIcon className="size-4" aria-hidden />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className={cn('size-8', diagramTool === 'pan' && 'border-primary bg-primary/10')}
                title="Hand (pan canvas)"
                aria-pressed={diagramTool === 'pan'}
                onClick={() => setDiagramTool('pan')}
              >
                <HandGrabbingIcon className="size-4" aria-hidden />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className={cn('size-8', diagramTool === 'connect' && 'border-primary bg-primary/10')}
                title="Connect columns (foreign key)"
                aria-pressed={diagramTool === 'connect'}
                onClick={() => setDiagramTool('connect')}
              >
                <LinkSimpleIcon className="size-4" aria-hidden />
              </Button>
              <div className="mx-1 hidden h-5 w-px bg-border sm:block" />
              <span className="hidden text-[10px] font-medium text-muted-foreground sm:inline">Align</span>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-8"
                title="Align left"
                disabled={selectedKeys.length < 2}
                onClick={() => applyAlign('left')}
              >
                <AlignLeftIcon className="size-4" aria-hidden />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-8"
                title="Align right"
                disabled={selectedKeys.length < 2}
                onClick={() => applyAlign('right')}
              >
                <AlignRightIcon className="size-4" aria-hidden />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-8"
                title="Align top"
                disabled={selectedKeys.length < 2}
                onClick={() => applyAlign('top')}
              >
                <AlignTopIcon className="size-4" aria-hidden />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-8"
                title="Align bottom"
                disabled={selectedKeys.length < 2}
                onClick={() => applyAlign('bottom')}
              >
                <AlignBottomIcon className="size-4" aria-hidden />
              </Button>
              <div className="mx-1 hidden h-5 w-px bg-border sm:block" />
              <span className="hidden text-[10px] font-medium text-muted-foreground sm:inline">Views</span>
              <label className="sr-only" htmlFor="diagram-view-select">
                Diagram view
              </label>
              <select
                id="diagram-view-select"
                className="h-8 max-w-[9rem] rounded-md border border-input bg-background px-2 text-xs"
                value={activeViewId}
                onChange={(e) => handleDiagramViewChange(e.target.value)}
              >
                {viewsRegistry.views.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-8"
                title="New diagram view (copies current layout)"
                onClick={() => handleNewDiagramView()}
              >
                <PlusIcon className="size-4" aria-hidden />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-8"
                title="Delete current view"
                disabled={activeViewId === DEFAULT_DIAGRAM_VIEW_ID || viewsRegistry.views.length < 2}
                onClick={() => handleDeleteDiagramView()}
              >
                <TrashIcon className="size-4" aria-hidden />
              </Button>
              <label className="sr-only" htmlFor="column-detail-select">
                Column detail
              </label>
              <select
                id="column-detail-select"
                className="h-8 max-w-[7.5rem] rounded-md border border-input bg-background px-2 text-xs"
                value={columnDetail}
                onChange={(e) => setColumnDetail(e.target.value as ColumnDetailLevel)}
              >
                <option value="full">All cols</option>
                <option value="keys">FK cols</option>
                <option value="header">Headers</option>
              </select>
              <div className="mx-1 hidden h-5 w-px bg-border sm:block" />
              <span className="hidden text-[10px] font-medium text-muted-foreground sm:inline">Layout</span>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className={cn('size-8', snapToGrid && 'border-primary bg-primary/10')}
                title={snapToGrid ? 'Snap to grid (on)' : 'Snap to grid (off)'}
                aria-pressed={snapToGrid}
                onClick={() => setSnapToGrid((v) => !v)}
              >
                <MagnetIcon className="size-4" aria-hidden />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-8"
                title="Arrange tables on a grid"
                disabled={onCanvas.length === 0}
                onClick={() => handleAutoLayoutGrid()}
              >
                <GridFourIcon className="size-4" aria-hidden />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-8"
                title="Arrange by FK dependency (parents left)"
                disabled={onCanvas.length === 0}
                onClick={() => handleAutoLayoutTopo()}
              >
                <TreeStructureIcon className="size-4" aria-hidden />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-8"
                title="Reset viewport (zoom/pan)"
                disabled={onCanvas.length === 0}
                onClick={() => handleResetViewport()}
              >
                <ArrowsInSimpleIcon className="size-4" aria-hidden />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-8"
                title="Reset table positions to grid"
                disabled={onCanvas.length === 0}
                onClick={() => handleResetLayout()}
              >
                <ArrowsClockwiseIcon className="size-4" aria-hidden />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-8"
                title="Group selected tables (visual frame)"
                disabled={selectedKeys.length < 2}
                onClick={() => handleAddGroupFromSelection()}
              >
                <SquaresFourIcon className="size-4" aria-hidden />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-8"
                title="Export diagram as PNG"
                disabled={onCanvas.length === 0}
                onClick={() => handleExportDiagramPng()}
              >
                <DownloadSimpleIcon className="size-4" aria-hidden />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-8"
                title="Print / save as PDF (opens print dialog)"
                disabled={onCanvas.length === 0}
                onClick={() => handleExportDiagramPdf()}
              >
                <FilePdfIcon className="size-4" aria-hidden />
              </Button>
            </div>
            <div className="flex min-h-0 min-w-0 flex-1">
              <div ref={diagramWrapRef} className="relative min-h-0 min-w-0 flex-1">
                {onCanvas.length === 0 && tables.length > 0 ? (
                  <div className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center px-6">
                    <div className="max-w-sm rounded-md border border-border/80 bg-background/90 px-4 py-3 text-center shadow-sm backdrop-blur-sm">
                      <p className="text-xs font-medium text-foreground">Diagram is empty</p>
                      <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
                        Open the <span className="font-medium text-foreground">Catalog</span> tab and add tables.
                        Use the <span className="font-medium text-foreground">Select</span> tool to drag tables;{' '}
                        <span className="font-medium text-foreground">Hand</span> pans the canvas (
                        <span className="font-medium text-foreground">Space</span> + drag also pans).
                      </p>
                    </div>
                  </div>
                ) : null}
                <DiagramCanvas
                  isDark={isDark}
                  viewport={viewport}
                  onViewportChange={setViewport}
                  tableDisplays={tableDisplays}
                  positions={positions}
                  columnsByKey={diagramDisplayColumnsByKey}
                  foreignKeys={foreignKeysQuery.data ?? []}
                  pendingForeignKeys={pendingForeignKeys}
                  columnDetail={columnDetail}
                  diagramGroups={diagramGroups}
                  selectedKeys={selectedKeysSet}
                  diagramTool={diagramTool}
                  onTableSelect={selectTable}
                  onClearSelection={clearSelection}
                  onMarqueeSelect={applyMarquee}
                  onTableDragStart={handleTableDragStart}
                  onTableDragMove={handleTableDragMove}
                  onMoveTable={handleMoveTable}
                  onRequestColumns={requestColumns}
                  onConnectColumns={handleConnectColumns}
                  headerColors={resolvedHeaderColors}
                  stageRef={diagramStageRef}
                />
                <DiagramMinimap
                  tableKeys={onCanvas}
                  positions={positions}
                  columnsByKey={diagramDisplayColumnsByKey}
                  columnDetail={columnDetail}
                  tableHeaderColors={resolvedHeaderColors}
                  viewport={viewport}
                  onViewportChange={setViewport}
                  canvasWidth={diagramAreaSize.w}
                  canvasHeight={diagramAreaSize.h}
                  isDark={isDark}
                />
              </div>
              <ModelInspector
                connectionId={connectionId}
                table={inspectorTable}
                tableKeyStr={primaryKey}
                defaultDiagramHeaderHex={
                  primaryKey ? distinctDiagramHeaderHex(primaryKey, isDark) : themeDiagramHeaderHex
                }
                tableHeaderColor={primaryKey ? headerColorsByKey[primaryKey] : undefined}
                onTableHeaderColorChange={(hex) => {
                  if (!primaryKey) return
                  setHeaderColorsByKey((prev) => {
                    const next = { ...prev }
                    if (hex == null) delete next[primaryKey]
                    else next[primaryKey] = hex
                    return next
                  })
                }}
                identityDraft={identityDraftForInspector}
                onIdentityDraftChange={(next) => {
                  if (!primaryKey) return
                  setIdentityDraftByKey((p) => ({ ...p, [primaryKey]: next }))
                }}
                columnOverrides={primaryKey ? columnOverridesByKey[primaryKey] ?? {} : {}}
                onColumnOverridesChange={(next) => {
                  if (!primaryKey) return
                  setColumnOverridesByKey((p) => ({ ...p, [primaryKey]: next }))
                }}
                catalogTables={catalogTablesSorted}
                pendingAddColumns={primaryKey ? pendingAddColumnsByKey[primaryKey] ?? [] : []}
                onPendingAddColumnsChange={(next) => {
                  if (!primaryKey) return
                  setPendingAddColumnsByKey((p) => {
                    const copy = { ...p }
                    if (next.length === 0) delete copy[primaryKey]
                    else copy[primaryKey] = next
                    return copy
                  })
                }}
                pendingForeignKeys={pendingForeignKeys}
                onAddPendingForeignKey={(row) => {
                  const fromKey = row.fromKey ?? primaryKey
                  if (!fromKey) return
                  setPendingForeignKeys((prev) => [
                    ...prev,
                    {
                      id: crypto.randomUUID(),
                      fromKey,
                      fromColumn: row.fromColumn,
                      toKey: row.toKey,
                      toColumn: row.toColumn,
                      constraintName: row.constraintName,
                    },
                  ])
                }}
                onRemovePendingForeignKey={(id) => {
                  setPendingForeignKeys((prev) => prev.filter((fk) => fk.id !== id))
                }}
              />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="catalog" className="m-0 flex min-h-0 flex-1 data-[state=inactive]:hidden">
          <ModelCatalog
            tables={tables}
            onCanvasSet={onCanvasSet}
            selectedKeys={selectedKeys}
            onSelectKey={handleSelectKey}
            onAddToCanvas={handleAddToCanvas}
            onRemoveFromCanvas={handleRemoveFromCanvas}
            onRequestColumns={requestColumns}
            onLocateOnDiagram={handleFitTableOnDiagram}
          />
        </TabsContent>
      </Tabs>

      <DdlReviewDialog open={ddlOpen} onOpenChange={setDdlOpen} connectionId={connectionId} />
    </div>
  )
}
