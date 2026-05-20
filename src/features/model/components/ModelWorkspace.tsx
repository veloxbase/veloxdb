import { useQueries, useQueryClient } from '@tanstack/react-query'
import { save } from '@tauri-apps/plugin-dialog'
import { useShallow } from 'zustand/react/shallow'
import {
  AlignBottomIcon,
  AlignLeftIcon,
  AlignRightIcon,
  AlignTopIcon,
  ArrowCounterClockwiseIcon,
  ArrowClockwiseIcon,
  ArrowsClockwiseIcon,
  ArrowsInSimpleIcon,
  ArrowsOutIcon,
  DownloadSimpleIcon,
  FilePdfIcon,
  GridFourIcon,
  MagnetIcon,
  PlusIcon,
  SquaresFourIcon,
  TrashIcon,
  TreeStructureIcon,
} from '@phosphor-icons/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { queryKeys } from '@/data/query-keys'
import { veloxDbRepository } from '@/data/repositories'
import type { ColumnInfo, DatabaseEngine, TableInfo } from '@/data/types'
import {
  applyEntireModel,
  type PendingCreateTable,
  type TableIdentityDraft,
} from '@/features/model/apply-entire-model'
import { CreateTableDialog } from '@/features/model/components/CreateTableDialog'
import { DdlReviewDialog } from '@/features/model/components/DdlReviewDialog'
import { DiagramSurfaceAdapter } from '@/features/model/components/DiagramSurfaceAdapter'
import type { DiagramExportHandle } from '@/features/model/components/diagram-surface-types'
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
import { computeDagreLayout } from '@/features/model/diagram-geometry/dagre-layout'
import {
  buildMigrationSummary,
  buildMigrationSql,
} from '@/features/model/migration-preview'
import { MigrationPreviewDialog } from '@/features/model/components/MigrationPreviewDialog'
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
import { readDiagramPalette } from '@/features/model/diagram-theme'
import {
  DEFAULT_DIAGRAM_VIEW_ID,
  tableKey,
  type ColumnDetailLevel,
  type DiagramLayoutSnapshot,
  type TableKey,
} from '@/features/model/model-types'
import { useForeignKeysQuery } from '@/features/model/queries'
import { useContainerSize } from '@/features/model/use-container-size'
import { useCanvasStore } from '@/features/model/state/canvas-store'
import { canQueueRelationship } from '@/features/model/relationship-validation'
import { rgbCssToHex } from '@/lib/contrast-text-for-bg'
import { cn } from '@/lib/utils'

type ModelWorkspaceProps = {
  connectionId: string
  connectionEngine: DatabaseEngine
  defaultDatabaseName: string
  isDark: boolean
  tables: TableInfo[]
  tablesErrorMessage?: string
  isTablesLoading: boolean
  selectedTable: TableInfo | null
}

const LOAD_ALL_CONFIRM_THRESHOLD = 150

function tableKeyToParts(key: TableKey): { schema: string; name: string } {
  const [schema = '', name = ''] = key.split('.')
  return { schema, name }
}

export function ModelWorkspace({
  connectionId,
  connectionEngine,
  defaultDatabaseName,
  isDark,
  tables,
  tablesErrorMessage,
  isTablesLoading,
  selectedTable,
}: ModelWorkspaceProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const foreignKeysQuery = useForeignKeysQuery(connectionId)

  const boot = useMemo(() => {
    const vr = loadDiagramViewsRegistry(connectionId)
    const aid = vr.activeViewId
    const snap = loadDiagramLayout(connectionId, aid)
    return { vr, aid, snap }
  }, [connectionId])

  const diagramWrapRef = useRef<HTMLDivElement>(null)
  const diagramAreaSize = useContainerSize(diagramWrapRef)

  const hadStoredLayout =
    boot.snap != null && (boot.snap.onCanvas.length > 0 || Object.keys(boot.snap.positions).length > 0)
  const hydrateFromConnection = useCanvasStore((s) => s.hydrateFromConnection)
  const {
    hydrated,
    storeConnectionId,
    viewsRegistry,
    setViewsRegistry,
    activeViewId,
    diagramTool,
    setDiagramTool,
    selectedKeys,
    setSelectedKeys,
      primaryKey,
      replaceSelection,
      selectTable,
      clearSelection,
      selectSingleFromCatalog,
    snapToGrid,
    setSnapToGrid,
    onCanvas,
    setOnCanvas,
    positions,
    setPositions,
    viewport,
    setViewport,
    modelTitle,
    setModelTitle,
    headerColorsByKey,
    setHeaderColorsByKey,
    columnDetail,
    setColumnDetail,
    diagramGroups,
    setDiagramGroups,
    modelTab,
    setModelTab,
    identityDraftByKey,
    setIdentityDraftByKey,
    columnOverridesByKey,
    setColumnOverridesByKey,
    columnIdentityOverridesByKey,
    setColumnIdentityOverridesByKey,
    pendingAddColumnsByKey,
    setPendingAddColumnsByKey,
    pendingForeignKeys,
    setPendingForeignKeys,
    selectedEdge,
    setSelectedEdge,
    pendingRules,
    setPendingRules,
    pendingTriggers,
    setPendingTriggers,
    pendingRlsPolicies,
    setPendingRlsPolicies,
    pendingCreateTables,
    setPendingCreateTables,
    applyQuickColumnEdit,
    canUndo,
    canRedo,
    undo,
    redo,
  } = useCanvasStore(
    useShallow((s) => ({
      hydrated: s.hydrated,
      storeConnectionId: s.connectionId,
      viewsRegistry: s.viewsRegistry,
      setViewsRegistry: s.setViewsRegistry,
      activeViewId: s.activeViewId,
      diagramTool: s.diagramTool,
      setDiagramTool: s.setDiagramTool,
      selectedKeys: s.selectedKeys,
      setSelectedKeys: s.setSelectedKeys,
      primaryKey: s.primaryKey,
      replaceSelection: s.replaceSelection,
      selectTable: s.selectTable,
      clearSelection: s.clearSelection,
      applyMarquee: s.applyMarquee,
      selectSingleFromCatalog: s.selectSingleFromCatalog,
      snapToGrid: s.snapToGrid,
      setSnapToGrid: s.setSnapToGrid,
      onCanvas: s.onCanvas,
      setOnCanvas: s.setOnCanvas,
      positions: s.positions,
      setPositions: s.setPositions,
      viewport: s.viewport,
      setViewport: s.setViewport,
      modelTitle: s.modelTitle,
      setModelTitle: s.setModelTitle,
      headerColorsByKey: s.headerColorsByKey,
      setHeaderColorsByKey: s.setHeaderColorsByKey,
      columnDetail: s.columnDetail,
      setColumnDetail: s.setColumnDetail,
      diagramGroups: s.diagramGroups,
      setDiagramGroups: s.setDiagramGroups,
      modelTab: s.modelTab,
      setModelTab: s.setModelTab,
      identityDraftByKey: s.identityDraftByKey,
      setIdentityDraftByKey: s.setIdentityDraftByKey,
      columnOverridesByKey: s.columnOverridesByKey,
      setColumnOverridesByKey: s.setColumnOverridesByKey,
      columnIdentityOverridesByKey: s.columnIdentityOverridesByKey,
      setColumnIdentityOverridesByKey: s.setColumnIdentityOverridesByKey,
      pendingAddColumnsByKey: s.pendingAddColumnsByKey,
      setPendingAddColumnsByKey: s.setPendingAddColumnsByKey,
      pendingForeignKeys: s.pendingForeignKeys,
      setPendingForeignKeys: s.setPendingForeignKeys,
      selectedEdge: s.selectedEdge,
      setSelectedEdge: s.setSelectedEdge,
      pendingRules: s.pendingRules,
      setPendingRules: s.setPendingRules,
      pendingTriggers: s.pendingTriggers,
      setPendingTriggers: s.setPendingTriggers,
      pendingRlsPolicies: s.pendingRlsPolicies,
      setPendingRlsPolicies: s.setPendingRlsPolicies,
      pendingCreateTables: s.pendingCreateTables,
      setPendingCreateTables: s.setPendingCreateTables,
      applyQuickColumnEdit: s.applyQuickColumnEdit,
      canUndo: s.canUndo,
      canRedo: s.canRedo,
      undo: s.undo,
      redo: s.redo,
    })),
  )

  useEffect(() => {
    hydrateFromConnection({ connectionId, defaultDatabaseName })
  }, [connectionId, defaultDatabaseName, hydrateFromConnection])
  const [columnRequestKeys, setColumnRequestKeys] = useState<TableKey[]>([])
  const [ddlOpen, setDdlOpen] = useState(false)
  const [createTableOpen, setCreateTableOpen] = useState(false)
  const [migrationPreviewOpen, setMigrationPreviewOpen] = useState(false)
  const [applyPending, setApplyPending] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)
  const [initialSeedReason, setInitialSeedReason] = useState<null | 'relationships' | 'sample'>(null)

  const fkSeedDoneRef = useRef(false)
  const initialRecoveryDoneRef = useRef(false)

  useEffect(() => {
    void connectionId
    initialRecoveryDoneRef.current = false
    fkSeedDoneRef.current = false
    setInitialSeedReason(null)
  }, [connectionId])

  useEffect(() => {
    const ignoredTags = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'])
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target?.isContentEditable || (target && ignoredTags.has(target.tagName))) return
      const mod = e.metaKey || e.ctrlKey
      if (!mod || e.altKey) return
      if (e.key.toLowerCase() !== 'z') return
      e.preventDefault()
      if (e.shiftKey) redo()
      else undo()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [redo, undo])

  const tablesByKey = useMemo(() => {
    const m = new Map<TableKey, TableInfo>()
    for (const t of tables) {
      m.set(tableKey(t), t)
    }
    return m
  }, [tables])

  useEffect(() => {
    if (initialRecoveryDoneRef.current) return
    if (!tables.length) return

    const validOnCanvas = onCanvas.filter((k) => tablesByKey.has(k))
    if (validOnCanvas.length !== onCanvas.length) {
      setOnCanvas(validOnCanvas)
      setPositions((prev) => {
        const next: Record<TableKey, { x: number; y: number }> = {}
        for (const key of validOnCanvas) {
          if (prev[key]) next[key] = prev[key]
        }
        return next
      })
    }

    if (validOnCanvas.length === 0) {
      const fkData = foreignKeysQuery.data ?? []
      const fkSeed = new Set<TableKey>()
      for (const edge of fkData) {
        const from = `${edge.fromSchema}.${edge.fromTable}` as TableKey
        const to = `${edge.toSchema}.${edge.toTable}` as TableKey
        if (tablesByKey.has(from)) fkSeed.add(from)
        if (tablesByKey.has(to)) fkSeed.add(to)
      }
      const fallbackKeys =
        fkSeed.size > 0
          ? [...fkSeed]
          : tables.slice(0, 12).map((t) => tableKey(t))
      if (fallbackKeys.length > 0) {
        setInitialSeedReason(fkSeed.size > 0 ? 'relationships' : 'sample')
        setOnCanvas(fallbackKeys)
        setPositions((prev) => ensurePositions(fallbackKeys, prev))
      }
    }

    initialRecoveryDoneRef.current = true
  }, [foreignKeysQuery.data, onCanvas, setOnCanvas, setPositions, tables, tablesByKey])

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
  }, [hadStoredLayout, foreignKeysQuery.data, setOnCanvas, setPositions, tables])

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

  const diagramPalette = useMemo(() => readDiagramPalette(isDark), [isDark])
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

  const effectiveColumnsByKey = useMemo(() => {
    const out: Record<TableKey, ColumnInfo[] | null> = {}
    for (const [key, cols] of Object.entries(columnsByKey) as Array<[TableKey, ColumnInfo[] | null]>) {
      if (!cols) {
        out[key] = null
        continue
      }
      const identityOverrides = columnIdentityOverridesByKey[key] ?? {}
      const rows = cols.map((col) => {
        const patch = identityOverrides[col.columnName]
        if (!patch) return col
        const nextName = patch.nextColumnName.trim()
        const nextType = patch.nextDataType.trim()
        return {
          ...col,
          columnName: nextName || col.columnName,
          dataType: nextType || col.dataType,
        }
      })
      const pending = pendingAddColumnsByKey[key] ?? []
      const pendingRows: ColumnInfo[] = pending.map((col) => ({
        tableSchema: tableKeyToParts(key).schema,
        tableName: tableKeyToParts(key).name,
        columnName: col.columnName.trim(),
        dataType: col.dataType.trim(),
        isNullable: col.nullable,
      }))
      out[key] = [...rows, ...pendingRows]
    }
    return out
  }, [columnIdentityOverridesByKey, columnsByKey, pendingAddColumnsByKey])

  useEffect(() => {
    if (!hydrated) return
    if (storeConnectionId !== connectionId) return
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
    hydrated,
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
    storeConnectionId,
    viewsRegistry,
    viewport,
  ])

  const onCanvasSet = useMemo(() => new Set(onCanvas), [onCanvas])

  const fkColumnNamesByKey = useMemo(() => {
    const m = new Map<TableKey, Set<string>>()
    const add = (tab: TableKey, col: string) => {
      if (!onCanvasSet.has(tab)) return
      const existing = m.get(tab)
      if (existing) {
        existing.add(col)
        return
      }
      m.set(tab, new Set([col]))
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
      const cols = effectiveColumnsByKey[k] ?? null
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
  }, [columnDetail, effectiveColumnsByKey, fkColumnNamesByKey, onCanvas])

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
  const totalTableCount = tables.length
  const onDiagramCount = tablesOnCanvas.length
  const hiddenTableCount = Math.max(totalTableCount - onDiagramCount, 0)
  const isPartialDiagram = hiddenTableCount > 0
  const showInitialSeedHint = initialSeedReason != null && isPartialDiagram

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
  const editedColumnNamesByKey = useMemo((): Record<TableKey, ReadonlySet<string>> => {
    const out: Record<TableKey, ReadonlySet<string>> = {}
    for (const key of onCanvas) {
      const cols = effectiveColumnsByKey[key] ?? []
      const edited = new Set<string>()
      const overrides = columnIdentityOverridesByKey[key] ?? {}
      for (const col of cols) {
        const lowered = col.columnName.trim().toLowerCase()
        for (const patch of Object.values(overrides)) {
          if (patch.nextColumnName.trim().toLowerCase() === lowered) {
            edited.add(col.columnName)
          }
        }
      }
      out[key] = edited
    }
    return out
  }, [columnIdentityOverridesByKey, effectiveColumnsByKey, onCanvas])

  const canQueueForeignKey = useCallback(
    (input: { fromKey: TableKey; fromColumn: string; toKey: TableKey; toColumn: string }) =>
      canQueueRelationship(input, foreignKeysQuery.data ?? [], pendingForeignKeys),
    [foreignKeysQuery.data, pendingForeignKeys],
  )

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
  const diagramExportRef = useRef<DiagramExportHandle | null>(null)
  const viewportControlRef = useRef<{
    setViewport: (v: import('@/features/model/model-types').ViewportState) => void
    getViewport: () => import('@/features/model/model-types').ViewportState
  } | null>(null)

  const isModelDirty = useMemo(() => {
    if (pendingForeignKeys.length > 0) return true
    if (pendingCreateTables.length > 0) return true
    for (const k of onCanvas) {
      const t = tablesByKey.get(k)
      if (!t) continue
      const id = identityDraftByKey[k]
      if (id && (id.schema !== t.schema || id.name !== t.name)) return true
      const co = columnOverridesByKey[k]
      if (co && Object.keys(co).length > 0) return true
      const cio = columnIdentityOverridesByKey[k]
      if (cio && Object.keys(cio).length > 0) return true
      const adds = pendingAddColumnsByKey[k]
      if (adds && adds.length > 0) return true
    }
    if (pendingRules.length > 0 || pendingTriggers.length > 0 || pendingRlsPolicies.length > 0) return true
    return false
  }, [
    onCanvas,
    tablesByKey,
    identityDraftByKey,
    columnOverridesByKey,
    columnIdentityOverridesByKey,
    pendingAddColumnsByKey,
    pendingForeignKeys,
    pendingCreateTables,
    pendingRlsPolicies.length,
    pendingRules.length,
    pendingTriggers.length,
  ])

  const migrationSummary = useMemo(
    () =>
      !isModelDirty
        ? null
        : buildMigrationSummary({
            onCanvas,
            tablesByKey,
            identityDraftByKey,
            columnOverridesByKey,
            columnIdentityOverridesByKey,
            pendingAddColumnsByKey,
            pendingForeignKeys,
            pendingRules,
            pendingTriggers,
            pendingRlsPolicies,
            pendingCreateTables,
          }),
    [
      isModelDirty,
      onCanvas,
      tablesByKey,
      identityDraftByKey,
      columnOverridesByKey,
      columnIdentityOverridesByKey,
      pendingAddColumnsByKey,
      pendingForeignKeys,
      pendingRules,
      pendingTriggers,
      pendingRlsPolicies,
      pendingCreateTables,
    ],
  )

  const catalogTablesSorted = useMemo(() => {
    return [...tables].sort((a, b) => tableKey(a).localeCompare(tableKey(b)))
  }, [tables])

  const requestColumns = useCallback((key: TableKey) => {
    setColumnRequestKeys((prev) => (prev.includes(key) ? prev : [...prev, key]))
  }, [])

  const handleViewportSave = useCallback(
    (next: { x: number; y: number; scale: number }) => {
      setViewport(next, { skipHistory: true })
    },
    [setViewport],
  )

  useEffect(() => {
    viewportControlRef.current?.setViewport(viewport)
  }, [viewport.x, viewport.y, viewport.scale])

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
    setColumnIdentityOverridesByKey((prev) => {
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
    setSelectedEdge((prev) =>
      prev && (prev.fromKey === k || prev.toKey === k) ? null : prev,
    )
    setPendingRules((prev) => prev.filter((row) => row.tableKey !== k))
    setPendingTriggers((prev) => prev.filter((row) => row.tableKey !== k))
    setPendingRlsPolicies((prev) => prev.filter((row) => row.tableKey !== k))
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
    void (async () => {
      const data = await diagramExportRef.current?.toDataURL({ pixelRatio: 2 })
      if (!data) return
      const safe = (modelTitle.trim() || defaultDatabaseName).replace(/[^\w.-]+/g, '_')
      const path = await save({
        defaultPath: `${safe}-diagram.png`,
        filters: [{ name: 'PNG Image', extensions: ['png'] }],
      })
      if (!path) return
      await veloxDbRepository.saveBase64Png(data, path)
    })()
  }, [defaultDatabaseName, modelTitle])

  const handleConnectColumns = useCallback(
    (fromKey: TableKey, fromColumn: string, toKey: TableKey, toColumn: string) => {
      if (!canQueueForeignKey({ fromKey, fromColumn, toKey, toColumn })) return
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
    [canQueueForeignKey, requestColumns],
  )

  const handleConnectTables = useCallback(
    (fromKey: TableKey, toKey: TableKey) => {
      requestColumns(fromKey)
      requestColumns(toKey)

      const fromCols = effectiveColumnsByKey[fromKey] ?? []
      const toCols = effectiveColumnsByKey[toKey] ?? []
      if (!fromCols.length || !toCols.length) return

      const toTableName = toKey.split('.')[1] ?? ''
      const patterns = [toTableName, toTableName.replace(/s$/i, ''), toTableName.replace(/ies$/i, 'y')]

      for (const pattern of patterns) {
        const fromCol = fromCols.find(
          (c) =>
            c.columnName.toLowerCase() === `${pattern}_id`.toLowerCase() ||
            c.columnName.toLowerCase() === `${pattern}id`.toLowerCase(),
        )
        const toCol = toCols.find((c) => c.columnName.toLowerCase() === 'id')
        if (fromCol && toCol) {
          if (!canQueueForeignKey({ fromKey, fromColumn: fromCol.columnName, toKey, toColumn: toCol.columnName })) return
          setPendingForeignKeys((prev) => [
            ...prev,
            { id: crypto.randomUUID(), fromKey, fromColumn: fromCol.columnName, toKey, toColumn: toCol.columnName },
          ])
          return
        }
      }

      for (const fromCol of fromCols) {
        const toCol = toCols.find(
          (c) => c.columnName.toLowerCase() === fromCol.columnName.toLowerCase(),
        )
        if (toCol) {
          if (!canQueueForeignKey({ fromKey, fromColumn: fromCol.columnName, toKey, toColumn: toCol.columnName })) return
          setPendingForeignKeys((prev) => [
            ...prev,
            { id: crypto.randomUUID(), fromKey, fromColumn: fromCol.columnName, toKey, toColumn: toCol.columnName },
          ])
          return
        }
      }
    },
    [canQueueForeignKey, effectiveColumnsByKey, requestColumns],
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

  const handleAutoLayoutDagre = useCallback(() => {
    const fkEdges = (foreignKeysQuery.data ?? []).map((fk) => ({
      fromKey: `${fk.fromSchema}.${fk.fromTable}` as TableKey,
      toKey: `${fk.toSchema}.${fk.toTable}` as TableKey,
    }))
    const pfkEdges = pendingForeignKeys.map((pfk) => ({
      fromKey: pfk.fromKey,
      toKey: pfk.toKey,
    }))
    const allEdges = [...fkEdges, ...pfkEdges]
    const dagrePositions = computeDagreLayout({
      tableKeys: onCanvas,
      columnsByKey: effectiveColumnsByKey,
      columnDetail,
      edges: allEdges,
    })
    setPositions((prev) => {
      const next = { ...prev }
      for (const [key, pos] of Object.entries(dagrePositions)) {
        next[key as TableKey] = snapToGrid ? snapPoint(pos) : pos
      }
      return next
    })
  }, [columnDetail, effectiveColumnsByKey, foreignKeysQuery.data, onCanvas, pendingForeignKeys, snapToGrid])

  const handleDownloadMigrationSql = useCallback(() => {
    if (!migrationSummary) return
    const sql = buildMigrationSql(migrationSummary)
    const blob = new Blob([sql], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `migration_${new Date().toISOString().replace(/[:.]+/g, '-').slice(0, 19)}.sql`
    a.click()
    URL.revokeObjectURL(url)
  }, [migrationSummary])

  const handleResetViewport = useCallback(() => {
    setViewport({ scale: 1, x: 0, y: 0 })
  }, [setViewport])

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
    void (async () => {
      const data = await diagramExportRef.current?.toDataURL({ pixelRatio: 2 })
      if (!data) return
      const safe = (modelTitle.trim() || defaultDatabaseName).replace(/[^\w.-]+/g, '_')
      const w = window.open('')
      if (!w) return
      w.document.write(
        `<!DOCTYPE html><html><head><title>${safe}</title></head><body style="margin:0;display:flex;justify-content:center;align-items:center;background:#111;">` +
          `<img src="${data}" style="max-width:100%;height:auto;" alt="diagram" />` +
          `<script>window.onload=function(){window.print()}</script></body></html>`,
      )
      w.document.close()
    })()
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
        engine: connectionEngine,
        onCanvas,
        tablesByKey,
        identityDraftByKey,
        columnOverridesByKey,
        columnIdentityOverridesByKey,
        pendingAddColumnsByKey,
        pendingForeignKeys,
        pendingRules,
        pendingTriggers,
        pendingRlsPolicies,
        pendingCreateTables,
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
      setColumnIdentityOverridesByKey({})
      setPendingAddColumnsByKey({})
      setPendingForeignKeys([])
      setPendingRules([])
      setPendingTriggers([])
      setPendingRlsPolicies([])
      setPendingCreateTables([])

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
    connectionEngine,
    columnOverridesByKey,
    columnIdentityOverridesByKey,
    connectionId,
    identityDraftByKey,
    onCanvas,
    pendingAddColumnsByKey,
    headerColorsByKey,
    pendingForeignKeys,
    pendingRlsPolicies,
    pendingRules,
    pendingTriggers,
    pendingCreateTables,
    positions,
    primaryKey,
    queryClient,
    replaceSelection,
    selectedKeys,
    tablesByKey,
  ])

  const handleCreateTable = useCallback(
    (ct: PendingCreateTable) => {
      setPendingCreateTables((prev) => [...prev, ct])
    },
    [setPendingCreateTables],
  )

  const handleLoadAllTables = useCallback(() => {
    if (!isPartialDiagram) return
    if (
      totalTableCount >= LOAD_ALL_CONFIRM_THRESHOLD &&
      !window.confirm(
        t("model.loadAllConfirm", { count: totalTableCount }),
      )
    ) {
      return
    }
    const keys = tables.map((table) => tableKey(table))
    setOnCanvas((prev) => {
      const next = new Set(prev)
      for (const key of keys) {
        next.add(key)
      }
      if (next.size === prev.length) return prev
      return [...next]
    })
    setPositions((prev) => ensurePositions(keys, prev))
    setColumnRequestKeys((prev) => {
      const next = new Set(prev)
      for (const key of keys) {
        next.add(key)
      }
      if (next.size === prev.length) return prev
      return [...next]
    })
  }, [isPartialDiagram, tables, totalTableCount, setOnCanvas, setPositions, setColumnRequestKeys])

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

  if (!isTablesLoading && tables.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-4">
        <div className="max-w-sm rounded-md border border-border/80 bg-background/90 px-5 py-4 text-center shadow-sm">
				<p className="text-sm font-medium text-foreground">{t("model.noTablesYet")}</p>
          <p className="mt-1.5 text-xs text-muted-foreground">
            This database has no tables. Create your first table visually or run a DDL script.
          </p>
          <div className="mt-4 flex items-center justify-center gap-2">
            <Button
              type="button"
              variant="default"
              size="sm"
              className="text-xs"
              onClick={() => setCreateTableOpen(true)}
            >
              {t("model.createTable")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => setDdlOpen(true)}
            >
              {t("model.runDdlScript")}
            </Button>
          </div>
        </div>
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
            disabled={!isModelDirty}
            onClick={() => setMigrationPreviewOpen(true)}
          >
            {t("model.reviewAndApply")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            disabled={!isModelDirty}
            onClick={handleDownloadMigrationSql}
          >
            <DownloadSimpleIcon className="mr-1 size-3.5" aria-hidden />
            {t("model.downloadSql")}
          </Button>
          <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => setDdlOpen(true)}>
            {t("model.runDdlScript")}
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
              {t("model.diagram")}
            </TabsTrigger>
            <TabsTrigger value="catalog" className="text-xs">
              {t("model.catalog")}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="diagram" className="m-0 flex min-h-0 flex-1 data-[state=inactive]:hidden">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-2 py-1.5">
              <span className="hidden text-[10px] font-medium text-muted-foreground sm:inline">{t("model.align")}</span>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-8"
                title={t("model.alignLeft")}
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
                title={t("model.alignRight")}
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
                title={t("model.alignTop")}
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
                title={t("model.alignBottom")}
                disabled={selectedKeys.length < 2}
                onClick={() => applyAlign('bottom')}
              >
                <AlignBottomIcon className="size-4" aria-hidden />
              </Button>
              <div className="mx-1 hidden h-5 w-px bg-border sm:block" />
              <span className="hidden text-[10px] font-medium text-muted-foreground sm:inline">{t("model.views")}</span>
              <label className="sr-only" htmlFor="diagram-view-select">
                {t("model.diagramView")}
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
                title={t("model.newDiagramView")}
                onClick={() => handleNewDiagramView()}
              >
                <PlusIcon className="size-4" aria-hidden />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-8"
                title={t("model.deleteCurrentView")}
                disabled={activeViewId === DEFAULT_DIAGRAM_VIEW_ID || viewsRegistry.views.length < 2}
                onClick={() => handleDeleteDiagramView()}
              >
                <TrashIcon className="size-4" aria-hidden />
              </Button>
              <label className="sr-only" htmlFor="column-detail-select">
                {t("model.columnDetail")}
              </label>
              <select
                id="column-detail-select"
                className="h-8 max-w-[7.5rem] rounded-md border border-input bg-background px-2 text-xs"
                value={columnDetail}
                onChange={(e) => setColumnDetail(e.target.value as ColumnDetailLevel)}
              >
                <option value="full">{t("model.allCols")}</option>
                <option value="keys">{t("model.fkCols")}</option>
				<option value="header">{t("model.headers")}</option>
              </select>
              <div className="mx-1 hidden h-5 w-px bg-border sm:block" />
				<span className="hidden text-[10px] font-medium text-muted-foreground sm:inline">{t("model.history")}</span>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-8"
				title={t("model.undo")}
				disabled={!canUndo}
                onClick={() => undo()}
              >
                <ArrowCounterClockwiseIcon className="size-4" aria-hidden />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-8"
				title={t("model.redo")}
				disabled={!canRedo}
                onClick={() => redo()}
              >
                <ArrowClockwiseIcon className="size-4" aria-hidden />
              </Button>
              <div className="mx-1 hidden h-5 w-px bg-border sm:block" />
				<span className="hidden text-[10px] font-medium text-muted-foreground sm:inline">{t("model.layout")}</span>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className={cn('size-8', snapToGrid && 'border-primary bg-primary/10')}
				title={snapToGrid ? t("model.snapToGridOn") : t("model.snapToGridOff")}
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
				title={t("model.arrangeGrid")}
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
				title={t("model.topologicalLayout")}
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
				title={t("model.dagreLayout")}
                disabled={onCanvas.length === 0}
                onClick={() => handleAutoLayoutDagre()}
              >
                <ArrowsOutIcon className="size-4" aria-hidden />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-8"
				title={t("model.fitView")}
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
				title={t("model.resetGrid")}
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
				title={t("model.groupTables")}
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
				title={t("model.createNewTable")}
                onClick={() => setCreateTableOpen(true)}
              >
                <PlusIcon className="size-4" aria-hidden />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-8"
				title={t("model.exportPng")}
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
				title={t("model.exportPdf")}
                disabled={onCanvas.length === 0}
                onClick={() => handleExportDiagramPdf()}
              >
                <FilePdfIcon className="size-4" aria-hidden />
              </Button>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/70 px-2 py-1.5 text-[11px]">
				<span className="text-muted-foreground">
					{t("model.catalogSummary", { filtered: onDiagramCount, total: totalTableCount, onDiagram: onDiagramCount })}
				</span>
              {isPartialDiagram ? (
				<span className="text-muted-foreground">{t("model.subsetLoaded")}</span>
              ) : (
				<span className="text-emerald-600">{t("model.allTablesOnDiagram")}</span>
              )}
              {isPartialDiagram ? (
                <>
                  <Button
                    type="button"
                    size="sm"
                    className="h-7 px-2 text-[11px]"
                    onClick={handleLoadAllTables}
                  >
					{t("model.loadAllTables", { count: hiddenTableCount })}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-[11px]"
                    onClick={() => setModelTab('catalog')}
                  >
					{t("model.openCatalog")}
                  </Button>
                </>
              ) : null}
              {showInitialSeedHint ? (
                <span className="text-muted-foreground/80">
					{initialSeedReason === 'relationships'
						? t("model.seededFromFk")
						: t("model.seededStarter")}
                </span>
              ) : null}
            </div>
            <div className="flex min-h-0 min-w-0 flex-1">
              <div ref={diagramWrapRef} className="relative min-h-0 min-w-0 flex-1">
                {onCanvas.length === 0 && tables.length > 0 ? (
                  <div className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center px-6">
                    <div className="pointer-events-auto max-w-sm rounded-md border border-border/80 bg-background/90 px-4 py-3 text-center shadow-sm backdrop-blur-sm">
					<p className="text-xs font-medium text-foreground">{t("model.diagramIsEmpty")}</p>
						<p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
						{t("model.diagramEmptyHint")}
						</p>
                      <div className="mt-3 flex items-center justify-center gap-2">
                        <Button
                          type="button"
                          variant="default"
                          size="sm"
                          className="text-xs"
                          onClick={() => setModelTab('catalog')}
                        >
						{t("model.openCatalog")}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="text-xs"
                          onClick={() => setCreateTableOpen(true)}
                        >
						{t("model.createTable")}
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : null}
                <DiagramSurfaceAdapter
                  isDark={isDark}
                  initialViewport={viewport}
                  onViewportSave={handleViewportSave}
                  viewportControlRef={viewportControlRef}
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
                  onClearSelection={() => {
                    clearSelection()
                    setSelectedEdge(null)
                  }}
                  onTableDragStart={handleTableDragStart}
                  onTableDragMove={handleTableDragMove}
                  onMoveTable={handleMoveTable}
                  onRequestColumns={requestColumns}
                  onConnectColumns={handleConnectColumns}
                  onConnectTables={handleConnectTables}
                  canConnectColumns={canQueueForeignKey}
                  selectedEdgeId={selectedEdge?.id ?? null}
                  onEdgeSelect={setSelectedEdge}
                  onQuickEditColumn={(tableK, sourceColumnName, patch) => {
                    applyQuickColumnEdit(tableK, sourceColumnName, patch)
                  }}
                  editedColumnNamesByKey={editedColumnNamesByKey}
                  headerColors={resolvedHeaderColors}
                  exportRef={diagramExportRef}
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
                columnIdentityOverrides={primaryKey ? columnIdentityOverridesByKey[primaryKey] ?? {} : {}}
                onColumnIdentityOverridesChange={(next) => {
                  if (!primaryKey) return
                  setColumnIdentityOverridesByKey((p) => {
                    const copy = { ...p }
                    if (Object.keys(next).length === 0) delete copy[primaryKey]
                    else copy[primaryKey] = next
                    return copy
                  })
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
                selectedEdge={selectedEdge}
                canQueueForeignKey={canQueueForeignKey}
                onAddPendingForeignKey={(row) => {
                  const fromKey = row.fromKey ?? primaryKey
                  if (!fromKey) return
                  if (!canQueueForeignKey({ fromKey, fromColumn: row.fromColumn, toKey: row.toKey, toColumn: row.toColumn })) {
                    return
                  }
                  const id = crypto.randomUUID()
                  setPendingForeignKeys((prev) => [
                    ...prev,
                    {
                      id,
                      fromKey,
                      fromColumn: row.fromColumn,
                      toKey: row.toKey,
                      toColumn: row.toColumn,
                      constraintName: row.constraintName,
                    },
                  ])
                  setSelectedEdge({
                    id,
                    kind: 'pending',
                    fromKey,
                    fromColumn: row.fromColumn,
                    toKey: row.toKey,
                    toColumn: row.toColumn,
                  })
                }}
                onRemovePendingForeignKey={(id) => {
                  setPendingForeignKeys((prev) => prev.filter((fk) => fk.id !== id))
                  setSelectedEdge((prev) => (prev?.id === id ? null : prev))
                }}
                pendingRules={pendingRules.filter((row) => row.tableKey === primaryKey)}
                onPendingRulesChange={(next) => {
                  if (!primaryKey) return
                  setPendingRules((prev) => [...prev.filter((row) => row.tableKey !== primaryKey), ...next])
                }}
                pendingTriggers={pendingTriggers.filter((row) => row.tableKey === primaryKey)}
                onPendingTriggersChange={(next) => {
                  if (!primaryKey) return
                  setPendingTriggers((prev) => [...prev.filter((row) => row.tableKey !== primaryKey), ...next])
                }}
                pendingRlsPolicies={pendingRlsPolicies.filter((row) => row.tableKey === primaryKey)}
                onPendingRlsPoliciesChange={(next) => {
                  if (!primaryKey) return
                  setPendingRlsPolicies((prev) => [...prev.filter((row) => row.tableKey !== primaryKey), ...next])
                }}
              />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="catalog" className="m-0 flex min-h-0 flex-1 data-[state=inactive]:hidden">
          <ModelCatalog
            tables={tables}
            onCanvasSet={onCanvasSet}
            onDiagramCount={onDiagramCount}
            selectedKeys={selectedKeys}
            onSelectKey={handleSelectKey}
            onAddToCanvas={handleAddToCanvas}
            onRemoveFromCanvas={handleRemoveFromCanvas}
            onRequestColumns={requestColumns}
            onLocateOnDiagram={handleFitTableOnDiagram}
          />
        </TabsContent>
      </Tabs>

      <DdlReviewDialog
        open={ddlOpen}
        onOpenChange={setDdlOpen}
        connectionId={connectionId}
        engine={connectionEngine}
      />
      <CreateTableDialog
        open={createTableOpen}
        onOpenChange={setCreateTableOpen}
        onCommit={handleCreateTable}
        defaultSchema={defaultDatabaseName}
      />
      <MigrationPreviewDialog
        open={migrationPreviewOpen}
        onOpenChange={setMigrationPreviewOpen}
        summary={migrationSummary}
        isApplying={applyPending}
        onApply={() => {
          setMigrationPreviewOpen(false)
          void handleApplyEntireModel()
        }}
      />
    </div>
  )
}
