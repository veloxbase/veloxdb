import { create } from 'zustand'

import type {
  ColumnIdentityOverride,
  ColumnOverride,
  PendingCreateTable,
  PendingModelColumn,
  PendingModelForeignKey,
  PendingModelRlsPolicy,
  PendingModelRule,
  PendingModelTrigger,
  TableIdentityDraft,
} from '@/features/model/apply-entire-model'
import type { DiagramEdgeSelection } from '@/features/model/components/diagram-surface-types'
import {
  ensurePositions,
  loadDiagramLayout,
  loadDiagramViewsRegistry,
} from '@/features/model/model-layout-storage'
import { remapPendingForeignKeysOnColumnRename } from '@/features/model/relationship-mutations'
import type {
  ColumnDetailLevel,
  DiagramGroup,
  DiagramViewsRegistry,
  TableKey,
  ViewportState,
} from '@/features/model/model-types'
import type { DiagramTool } from '@/features/model/use-diagram-interaction'

type ModelTab = 'diagram' | 'catalog'
type Updater<T> = T | ((prev: T) => T)

type CanvasState = {
  hydrated: boolean
  connectionId: string | null
  activeViewId: string
  viewsRegistry: DiagramViewsRegistry
  diagramTool: DiagramTool
  selectedKeys: TableKey[]
  primaryKey: TableKey | null
  onCanvas: TableKey[]
  positions: Record<TableKey, { x: number; y: number }>
  viewport: ViewportState
  modelTitle: string
  headerColorsByKey: Record<TableKey, string>
  snapToGrid: boolean
  columnDetail: ColumnDetailLevel
  diagramGroups: DiagramGroup[]
  modelTab: ModelTab
  identityDraftByKey: Record<TableKey, TableIdentityDraft>
  columnOverridesByKey: Record<TableKey, Record<string, ColumnOverride>>
  columnIdentityOverridesByKey: Record<TableKey, Record<string, ColumnIdentityOverride>>
  pendingAddColumnsByKey: Record<TableKey, PendingModelColumn[]>
  pendingForeignKeys: PendingModelForeignKey[]
  selectedEdge: DiagramEdgeSelection | null
  pendingRules: PendingModelRule[]
  pendingTriggers: PendingModelTrigger[]
  pendingRlsPolicies: PendingModelRlsPolicy[]
  pendingCreateTables: PendingCreateTable[]
}

type HistoryState = {
  past: CanvasState[]
  future: CanvasState[]
}

type CanvasStore = CanvasState &
  HistoryState & {
    canUndo: boolean
    canRedo: boolean
    hydrateFromConnection: (input: { connectionId: string; defaultDatabaseName: string }) => void
    resetEphemeralHistory: () => void
    undo: () => void
    redo: () => void
    setDiagramTool: (tool: DiagramTool) => void
    setViewsRegistry: (updater: Updater<DiagramViewsRegistry>) => void
    setActiveViewId: (viewId: string) => void
    setSelectedKeys: (updater: Updater<TableKey[]>) => void
    replaceSelection: (keys: TableKey[], primaryKey: TableKey | null) => void
    selectTable: (key: TableKey, shiftKey: boolean) => void
    clearSelection: () => void
    applyMarquee: (keys: TableKey[], shiftKey: boolean) => void
    selectSingleFromCatalog: (key: TableKey | null) => void
    setOnCanvas: (updater: Updater<TableKey[]>) => void
    setPositions: (updater: Updater<Record<TableKey, { x: number; y: number }>>) => void
    setViewport: (updater: Updater<ViewportState>, options?: { skipHistory?: boolean }) => void
    setModelTitle: (updater: Updater<string>) => void
    setHeaderColorsByKey: (updater: Updater<Record<TableKey, string>>) => void
    setSnapToGrid: (updater: Updater<boolean>) => void
    setColumnDetail: (updater: Updater<ColumnDetailLevel>) => void
    setDiagramGroups: (updater: Updater<DiagramGroup[]>) => void
    setModelTab: (updater: Updater<ModelTab>) => void
    setIdentityDraftByKey: (updater: Updater<Record<TableKey, TableIdentityDraft>>) => void
    setColumnOverridesByKey: (
      updater: Updater<Record<TableKey, Record<string, ColumnOverride>>>,
    ) => void
    setColumnIdentityOverridesByKey: (
      updater: Updater<Record<TableKey, Record<string, ColumnIdentityOverride>>>,
    ) => void
    setPendingAddColumnsByKey: (updater: Updater<Record<TableKey, PendingModelColumn[]>>) => void
    setPendingForeignKeys: (updater: Updater<PendingModelForeignKey[]>) => void
    setSelectedEdge: (updater: Updater<DiagramEdgeSelection | null>) => void
    setPendingRules: (updater: Updater<PendingModelRule[]>) => void
    setPendingTriggers: (updater: Updater<PendingModelTrigger[]>) => void
    setPendingRlsPolicies: (updater: Updater<PendingModelRlsPolicy[]>) => void
    setPendingCreateTables: (updater: Updater<PendingCreateTable[]>) => void
    applyQuickColumnEdit: (
      tableKey: TableKey,
      sourceColumnName: string,
      patch: { nextColumnName: string; nextDataType: string },
    ) => void
  }

const HISTORY_LIMIT = 100

function defaultViewsRegistry(): DiagramViewsRegistry {
  return {
    activeViewId: 'default',
    views: [{ id: 'default', name: 'Default' }],
  }
}

function initialCanvasState(): CanvasState {
  return {
    hydrated: false,
    connectionId: null,
    activeViewId: 'default',
    viewsRegistry: defaultViewsRegistry(),
    diagramTool: 'select',
    selectedKeys: [],
    primaryKey: null,
    onCanvas: [],
    positions: {},
    viewport: { x: 0, y: 0, scale: 1 },
    modelTitle: '',
    headerColorsByKey: {},
    snapToGrid: true,
    columnDetail: 'full',
    diagramGroups: [],
    modelTab: 'diagram',
    identityDraftByKey: {},
    columnOverridesByKey: {},
    columnIdentityOverridesByKey: {},
    pendingAddColumnsByKey: {},
    pendingForeignKeys: [],
    selectedEdge: null,
    pendingRules: [],
    pendingTriggers: [],
    pendingRlsPolicies: [],
    pendingCreateTables: [],
  }
}

function resolveUpdater<T>(updater: Updater<T>, prev: T): T {
  return typeof updater === 'function' ? (updater as (p: T) => T)(prev) : updater
}

function sameStringArray(a: string[], b: string[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false
  }
  return true
}

function sameViewport(a: ViewportState, b: ViewportState): boolean {
  return a.x === b.x && a.y === b.y && a.scale === b.scale
}

function samePositionMap(
  a: Record<TableKey, { x: number; y: number }>,
  b: Record<TableKey, { x: number; y: number }>,
): boolean {
  if (a === b) return true
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false
  for (const key of aKeys) {
    if (!(key in b)) return false
    const av = a[key]
    const bv = b[key]
    if (!av || !bv || av.x !== bv.x || av.y !== bv.y) return false
  }
  return true
}

function sameRecordShallow(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  if (a === b) return true
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false
  for (const key of aKeys) {
    if (a[key] !== b[key]) return false
  }
  return true
}

function sameArrayRefOrValues<T>(a: T[], b: T[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false
  }
  return true
}

function withSelectionConstraints(input: CanvasState): CanvasState {
  const selectedSet = new Set(input.selectedKeys.filter((k) => input.onCanvas.includes(k)))
  const selectedKeys = [...selectedSet]
  const primaryKey =
    input.primaryKey && selectedSet.has(input.primaryKey) ? input.primaryKey : selectedKeys[0] ?? null
  if (sameStringArray(input.selectedKeys, selectedKeys) && input.primaryKey === primaryKey) {
    return input
  }
  return { ...input, selectedKeys, primaryKey }
}

function pushHistory(store: CanvasStore): Pick<CanvasStore, 'past' | 'future' | 'canUndo' | 'canRedo'> {
  const past = [...store.past, toSnapshot(store)].slice(-HISTORY_LIMIT)
  return { past, future: [], canUndo: past.length > 0, canRedo: false }
}

function toSnapshot(store: CanvasStore): CanvasState {
  return {
    connectionId: store.connectionId,
    hydrated: store.hydrated,
    activeViewId: store.activeViewId,
    viewsRegistry: store.viewsRegistry,
    diagramTool: store.diagramTool,
    selectedKeys: store.selectedKeys,
    primaryKey: store.primaryKey,
    onCanvas: store.onCanvas,
    positions: store.positions,
    viewport: store.viewport,
    modelTitle: store.modelTitle,
    headerColorsByKey: store.headerColorsByKey,
    snapToGrid: store.snapToGrid,
    columnDetail: store.columnDetail,
    diagramGroups: store.diagramGroups,
    modelTab: store.modelTab,
    identityDraftByKey: store.identityDraftByKey,
    columnOverridesByKey: store.columnOverridesByKey,
    columnIdentityOverridesByKey: store.columnIdentityOverridesByKey,
    pendingAddColumnsByKey: store.pendingAddColumnsByKey,
    pendingForeignKeys: store.pendingForeignKeys,
    selectedEdge: store.selectedEdge,
    pendingRules: store.pendingRules,
    pendingTriggers: store.pendingTriggers,
    pendingRlsPolicies: store.pendingRlsPolicies,
    pendingCreateTables: store.pendingCreateTables,
  }
}

export const useCanvasStore = create<CanvasStore>((set) => {
  const applyMutation = (fn: (prev: CanvasState) => CanvasState, options?: { skipHistory?: boolean }) => {
    set((store) => {
      const current = toSnapshot(store)
      const next = withSelectionConstraints(fn(current))
      if (next === current) return store
      if (options?.skipHistory) {
        return {
          ...next,
          canUndo: store.past.length > 0,
          canRedo: store.future.length > 0,
        }
      }
      const history = pushHistory(store)
      return { ...next, ...history }
    })
  }

  return {
    ...initialCanvasState(),
    past: [],
    future: [],
    canUndo: false,
    canRedo: false,

    hydrateFromConnection: ({ connectionId, defaultDatabaseName }) => {
      const vr = loadDiagramViewsRegistry(connectionId)
      const activeViewId = vr.activeViewId
      const snap = loadDiagramLayout(connectionId, activeViewId)
      set(() => {
        const base = initialCanvasState()
        return {
          ...base,
          hydrated: true,
          connectionId,
          activeViewId,
          viewsRegistry: vr,
          diagramTool: snap?.diagramTool === 'pan' || snap?.diagramTool === 'connect' ? snap.diagramTool : 'select',
          onCanvas: snap?.onCanvas ?? [],
          positions: snap?.positions ?? {},
          viewport: snap?.viewport ?? { scale: 1, x: 0, y: 0 },
          modelTitle: snap?.modelTitle?.trim() || defaultDatabaseName,
          headerColorsByKey: { ...(snap?.headerColors ?? {}) },
          snapToGrid: snap?.snapToGrid !== false,
          columnDetail: snap?.columnDetail === 'keys' || snap?.columnDetail === 'header' ? snap.columnDetail : 'full',
          diagramGroups: snap?.diagramGroups ?? [],
          past: [],
          future: [],
          canUndo: false,
          canRedo: false,
        }
      })
    },

    resetEphemeralHistory: () => {
      set((store) => ({ ...store, past: [], future: [], canUndo: false, canRedo: false }))
    },

    undo: () => {
      set((store) => {
        if (!store.past.length) return store
        const prev = store.past.at(-1)
        if (!prev) return store
        const current = toSnapshot(store)
        const past = store.past.slice(0, -1)
        const future = [current, ...store.future].slice(0, HISTORY_LIMIT)
        return { ...store, ...prev, past, future, canUndo: past.length > 0, canRedo: future.length > 0 }
      })
    },

    redo: () => {
      set((store) => {
        if (!store.future.length) return store
        const [next, ...future] = store.future
        const past = [...store.past, toSnapshot(store)].slice(-HISTORY_LIMIT)
        return { ...store, ...next, past, future, canUndo: past.length > 0, canRedo: future.length > 0 }
      })
    },

    setDiagramTool: (tool) =>
      applyMutation((prev) => {
        if (prev.diagramTool === tool) return prev
        return { ...prev, diagramTool: tool }
      }),
    setViewsRegistry: (updater) =>
      applyMutation((prev) => {
        const viewsRegistry = resolveUpdater(updater, prev.viewsRegistry)
        if (viewsRegistry === prev.viewsRegistry) return prev
        const activeViewId =
          viewsRegistry.views.some((v) => v.id === viewsRegistry.activeViewId)
            ? viewsRegistry.activeViewId
            : viewsRegistry.views[0]?.id ?? 'default'
        if (activeViewId === prev.activeViewId && viewsRegistry === prev.viewsRegistry) return prev
        return { ...prev, viewsRegistry, activeViewId }
      }),
    setActiveViewId: (viewId) =>
      applyMutation((prev) => ({ ...prev, activeViewId: viewId, viewsRegistry: { ...prev.viewsRegistry, activeViewId: viewId } })),
    setSelectedKeys: (updater) =>
      applyMutation((prev) => {
        const next = resolveUpdater(updater, prev.selectedKeys)
        if (sameStringArray(prev.selectedKeys, next)) return prev
        return { ...prev, selectedKeys: next }
      }),
    replaceSelection: (keys, primaryKey) => applyMutation((prev) => ({ ...prev, selectedKeys: keys, primaryKey })),
    selectTable: (key, shiftKey) =>
      applyMutation((prev) => {
        if (!shiftKey) return { ...prev, selectedKeys: [key], primaryKey: key }
        const set = new Set(prev.selectedKeys)
        if (set.has(key)) {
          set.delete(key)
          const next = [...set]
          const primary = prev.primaryKey === key ? next[0] ?? null : prev.primaryKey
          return { ...prev, selectedKeys: next, primaryKey: primary }
        }
        set.add(key)
        return { ...prev, selectedKeys: [...set], primaryKey: key }
      }),
    clearSelection: () =>
      applyMutation((prev) => {
        if (prev.selectedKeys.length === 0 && prev.primaryKey == null) return prev
        return { ...prev, selectedKeys: [], primaryKey: null }
      }),
    applyMarquee: (keys, shiftKey) =>
      applyMutation((prev) => {
        if (shiftKey) {
          const merged = [...new Set([...prev.selectedKeys, ...keys])]
          const primary = keys.length > 0 ? keys[keys.length - 1] ?? prev.primaryKey : prev.primaryKey
          return { ...prev, selectedKeys: merged, primaryKey: primary }
        }
        return { ...prev, selectedKeys: keys, primaryKey: keys[0] ?? null }
      }),
    selectSingleFromCatalog: (key) =>
      applyMutation((prev) =>
        key == null
          ? prev.selectedKeys.length === 0 && prev.primaryKey == null
            ? prev
            : { ...prev, selectedKeys: [], primaryKey: null }
          : prev.primaryKey === key && prev.selectedKeys.length === 1 && prev.selectedKeys[0] === key
            ? prev
            : { ...prev, selectedKeys: [key], primaryKey: key },
      ),
    setOnCanvas: (updater) =>
      applyMutation((prev) => {
        const next = resolveUpdater(updater, prev.onCanvas)
        if (sameStringArray(prev.onCanvas, next)) return prev
        return { ...prev, onCanvas: next }
      }),
    setPositions: (updater) =>
      applyMutation((prev) => {
        const next = resolveUpdater(updater, prev.positions)
        if (samePositionMap(prev.positions, next)) return prev
        return { ...prev, positions: next }
      }),
    setViewport: (updater, options) =>
      applyMutation((prev) => {
        const next = resolveUpdater(updater, prev.viewport)
        if (sameViewport(prev.viewport, next)) return prev
        return { ...prev, viewport: next }
      }, options),
    setModelTitle: (updater) =>
      applyMutation((prev) => {
        const next = resolveUpdater(updater, prev.modelTitle)
        if (next === prev.modelTitle) return prev
        return { ...prev, modelTitle: next }
      }),
    setHeaderColorsByKey: (updater) =>
      applyMutation((prev) => {
        const next = resolveUpdater(updater, prev.headerColorsByKey)
        if (sameRecordShallow(prev.headerColorsByKey, next)) return prev
        return { ...prev, headerColorsByKey: next }
      }),
    setSnapToGrid: (updater) =>
      applyMutation((prev) => {
        const next = resolveUpdater(updater, prev.snapToGrid)
        if (next === prev.snapToGrid) return prev
        return { ...prev, snapToGrid: next }
      }),
    setColumnDetail: (updater) =>
      applyMutation((prev) => {
        const next = resolveUpdater(updater, prev.columnDetail)
        if (next === prev.columnDetail) return prev
        return { ...prev, columnDetail: next }
      }),
    setDiagramGroups: (updater) =>
      applyMutation((prev) => {
        const next = resolveUpdater(updater, prev.diagramGroups)
        if (sameArrayRefOrValues(prev.diagramGroups, next)) return prev
        return { ...prev, diagramGroups: next }
      }),
    setModelTab: (updater) =>
      applyMutation((prev) => {
        const next = resolveUpdater(updater, prev.modelTab)
        if (next === prev.modelTab) return prev
        return { ...prev, modelTab: next }
      }),
    setIdentityDraftByKey: (updater) =>
      applyMutation((prev) => {
        const next = resolveUpdater(updater, prev.identityDraftByKey)
        if (sameRecordShallow(prev.identityDraftByKey, next)) return prev
        return { ...prev, identityDraftByKey: next }
      }),
    setColumnOverridesByKey: (updater) =>
      applyMutation((prev) => {
        const next = resolveUpdater(updater, prev.columnOverridesByKey)
        if (sameRecordShallow(prev.columnOverridesByKey, next)) return prev
        return { ...prev, columnOverridesByKey: next }
      }),
    setColumnIdentityOverridesByKey: (updater) =>
      applyMutation((prev) => {
        const next = resolveUpdater(updater, prev.columnIdentityOverridesByKey)
        if (sameRecordShallow(prev.columnIdentityOverridesByKey, next)) return prev
        return { ...prev, columnIdentityOverridesByKey: next }
      }),
    setPendingAddColumnsByKey: (updater) =>
      applyMutation((prev) => {
        const next = resolveUpdater(updater, prev.pendingAddColumnsByKey)
        if (sameRecordShallow(prev.pendingAddColumnsByKey, next)) return prev
        return { ...prev, pendingAddColumnsByKey: next }
      }),
    setPendingForeignKeys: (updater) =>
      applyMutation((prev) => {
        const next = resolveUpdater(updater, prev.pendingForeignKeys)
        if (sameArrayRefOrValues(prev.pendingForeignKeys, next)) return prev
        return { ...prev, pendingForeignKeys: next }
      }),
    setSelectedEdge: (updater) =>
      applyMutation((prev) => {
        const next = resolveUpdater(updater, prev.selectedEdge)
        if (next === prev.selectedEdge) return prev
        return { ...prev, selectedEdge: next }
      }),
    setPendingRules: (updater) =>
      applyMutation((prev) => {
        const next = resolveUpdater(updater, prev.pendingRules)
        if (sameArrayRefOrValues(prev.pendingRules, next)) return prev
        return { ...prev, pendingRules: next }
      }),
    setPendingTriggers: (updater) =>
      applyMutation((prev) => {
        const next = resolveUpdater(updater, prev.pendingTriggers)
        if (sameArrayRefOrValues(prev.pendingTriggers, next)) return prev
        return { ...prev, pendingTriggers: next }
      }),
    setPendingRlsPolicies: (updater) =>
      applyMutation((prev) => {
        const next = resolveUpdater(updater, prev.pendingRlsPolicies)
        if (sameArrayRefOrValues(prev.pendingRlsPolicies, next)) return prev
        return { ...prev, pendingRlsPolicies: next }
      }),
    setPendingCreateTables: (updater) =>
      applyMutation((prev) => {
        const next = resolveUpdater(updater, prev.pendingCreateTables)
        if (sameArrayRefOrValues(prev.pendingCreateTables, next)) return prev
        return { ...prev, pendingCreateTables: next }
      }),
    applyQuickColumnEdit: (tableKey, sourceColumnName, patch) =>
      applyMutation((prev) => {
        const nextName = patch.nextColumnName.trim()
        const nextType = patch.nextDataType.trim()
        const tableMap = { ...(prev.columnIdentityOverridesByKey[tableKey] ?? {}) }
        if (!nextName || !nextType) {
          delete tableMap[sourceColumnName]
        } else {
          tableMap[sourceColumnName] = { nextColumnName: nextName, nextDataType: nextType }
        }
        const columnIdentityOverridesByKey = { ...prev.columnIdentityOverridesByKey }
        if (Object.keys(tableMap).length === 0) delete columnIdentityOverridesByKey[tableKey]
        else columnIdentityOverridesByKey[tableKey] = tableMap

        let pendingForeignKeys = prev.pendingForeignKeys
        let selectedEdge = prev.selectedEdge
        if (nextName && nextName !== sourceColumnName) {
          pendingForeignKeys = remapPendingForeignKeysOnColumnRename(
            prev.pendingForeignKeys,
            tableKey,
            sourceColumnName,
            nextName,
          )
          if (selectedEdge?.fromKey === tableKey && selectedEdge.fromColumn === sourceColumnName) {
            selectedEdge = { ...selectedEdge, fromColumn: nextName }
          } else if (selectedEdge?.toKey === tableKey && selectedEdge.toColumn === sourceColumnName) {
            selectedEdge = { ...selectedEdge, toColumn: nextName }
          }
        }

        return {
          ...prev,
          columnIdentityOverridesByKey,
          pendingForeignKeys,
          selectedEdge,
        }
      }),
  }
})

export function ensureCanvasPositions(keys: TableKey[]) {
  const current = useCanvasStore.getState()
  useCanvasStore.getState().setPositions((prev) => ensurePositions(keys, prev))
  if (!current.onCanvas.length && keys.length) {
    useCanvasStore.getState().setOnCanvas((prev) => [...prev, ...keys.filter((k) => !prev.includes(k))])
  }
}
