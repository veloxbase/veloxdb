import type {
  DiagramGroup,
  DiagramLayoutSnapshot,
  DiagramToolPersisted,
  DiagramViewsRegistry,
  TableKey,
} from '@/features/model/model-types'
import { DEFAULT_DIAGRAM_VIEW_ID } from '@/features/model/model-types'

const LAYOUT_V1_KEY = 'veloxdb.modelLayout.v1'
const LAYOUT_V2_KEY = 'veloxdb.modelLayout.v2'
const VIEWS_REGISTRY_KEY = 'veloxdb.diagramViews.v1'

type LayoutMapV2 = Record<string, DiagramLayoutSnapshot>
type ViewsRoot = Record<string, DiagramViewsRegistry>

function readLayoutV2(): LayoutMapV2 {
  try {
    const raw = window.localStorage.getItem(LAYOUT_V2_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed as LayoutMapV2
  } catch {
    return {}
  }
}

function writeLayoutV2(map: LayoutMapV2) {
  try {
    window.localStorage.setItem(LAYOUT_V2_KEY, JSON.stringify(map))
  } catch {
    // ignore quota errors
  }
}

function readLayoutV1(): Record<string, DiagramLayoutSnapshot> {
  try {
    const raw = window.localStorage.getItem(LAYOUT_V1_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed as Record<string, DiagramLayoutSnapshot>
  } catch {
    return {}
  }
}

function readViewsRoot(): ViewsRoot {
  try {
    const raw = window.localStorage.getItem(VIEWS_REGISTRY_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed as ViewsRoot
  } catch {
    return {}
  }
}

function writeViewsRoot(root: ViewsRoot) {
  try {
    window.localStorage.setItem(VIEWS_REGISTRY_KEY, JSON.stringify(root))
  } catch {
    // ignore
  }
}

export function compositeLayoutKey(connectionId: string, viewId: string): string {
  return `${connectionId}::${viewId}`
}

function migrateConnectionFromV1IfNeeded(connectionId: string): void {
  const v2 = readLayoutV2()
  const ck = compositeLayoutKey(connectionId, DEFAULT_DIAGRAM_VIEW_ID)
  if (v2[ck] != null) return

  const v1 = readLayoutV1()[connectionId]
  if (!v1 || !Array.isArray(v1.onCanvas)) return

  v2[ck] = normalizeIncomingSnapshot(v1)
  writeLayoutV2(v2)

  const views = readViewsRoot()
  if (!views[connectionId]) {
    views[connectionId] = {
      activeViewId: DEFAULT_DIAGRAM_VIEW_ID,
      views: [{ id: DEFAULT_DIAGRAM_VIEW_ID, name: 'Default' }],
    }
    writeViewsRoot(views)
  }
}

function normalizeIncomingSnapshot(snap: DiagramLayoutSnapshot): DiagramLayoutSnapshot {
  const headerColors =
    snap.headerColors && typeof snap.headerColors === 'object' && !Array.isArray(snap.headerColors)
      ? { ...(snap.headerColors as Record<TableKey, string>) }
      : undefined
  const diagramTool =
    snap.diagramTool === 'select' || snap.diagramTool === 'pan' || snap.diagramTool === 'connect'
      ? snap.diagramTool
      : undefined
  const snapToGrid = typeof snap.snapToGrid === 'boolean' ? snap.snapToGrid : undefined
  const columnDetail =
    snap.columnDetail === 'full' || snap.columnDetail === 'keys' || snap.columnDetail === 'header'
      ? snap.columnDetail
      : undefined
  const diagramGroups = Array.isArray(snap.diagramGroups)
    ? snap.diagramGroups.filter(
        (g): g is DiagramGroup =>
          g != null &&
          typeof g === 'object' &&
          typeof (g as DiagramGroup).id === 'string' &&
          typeof (g as DiagramGroup).name === 'string' &&
          Array.isArray((g as DiagramGroup).tableKeys),
      )
    : undefined

  return {
    positions: snap.positions ?? {},
    viewport: snap.viewport ?? { scale: 1, x: 0, y: 0 },
    onCanvas: [...(snap.onCanvas ?? [])],
    ...(typeof snap.modelTitle === 'string' ? { modelTitle: snap.modelTitle } : {}),
    ...(headerColors && Object.keys(headerColors).length > 0 ? { headerColors } : {}),
    ...(diagramTool ? { diagramTool } : {}),
    ...(snapToGrid !== undefined ? { snapToGrid } : {}),
    ...(columnDetail ? { columnDetail } : {}),
    ...(diagramGroups && diagramGroups.length > 0 ? { diagramGroups } : {}),
  }
}

export function loadDiagramLayout(
  connectionId: string,
  viewId: string = DEFAULT_DIAGRAM_VIEW_ID,
): DiagramLayoutSnapshot | null {
  migrateConnectionFromV1IfNeeded(connectionId)

  const v2 = readLayoutV2()
  const ck = compositeLayoutKey(connectionId, viewId)
  const snap = v2[ck]
  if (!snap || !Array.isArray(snap.onCanvas)) return null
  return normalizeIncomingSnapshot(snap)
}

export function saveDiagramLayout(
  connectionId: string,
  snapshot: DiagramLayoutSnapshot,
  viewId: string = DEFAULT_DIAGRAM_VIEW_ID,
) {
  const all = readLayoutV2()
  const headerColors =
    snapshot.headerColors && Object.keys(snapshot.headerColors).length > 0
      ? { ...snapshot.headerColors }
      : undefined
  const diagramTool = snapshot.diagramTool as DiagramToolPersisted | undefined
  const columnDetail = snapshot.columnDetail
  const diagramGroups =
    snapshot.diagramGroups && snapshot.diagramGroups.length > 0 ? [...snapshot.diagramGroups] : undefined

  all[compositeLayoutKey(connectionId, viewId)] = {
    positions: { ...snapshot.positions },
    viewport: { ...snapshot.viewport },
    onCanvas: [...snapshot.onCanvas],
    ...(snapshot.modelTitle != null && snapshot.modelTitle !== ''
      ? { modelTitle: snapshot.modelTitle }
      : {}),
    ...(headerColors ? { headerColors } : {}),
    ...(diagramTool === 'select' || diagramTool === 'pan' || diagramTool === 'connect'
      ? { diagramTool }
      : {}),
    ...(typeof snapshot.snapToGrid === 'boolean' ? { snapToGrid: snapshot.snapToGrid } : {}),
    ...(columnDetail === 'full' || columnDetail === 'keys' || columnDetail === 'header'
      ? { columnDetail }
      : {}),
    ...(diagramGroups ? { diagramGroups } : {}),
  }
  writeLayoutV2(all)
}

export function loadDiagramViewsRegistry(connectionId: string): DiagramViewsRegistry {
  migrateConnectionFromV1IfNeeded(connectionId)
  const root = readViewsRoot()
  const reg = root[connectionId]
  if (reg?.views?.length) {
    const active =
      reg.views.some((v) => v.id === reg.activeViewId) ? reg.activeViewId : reg.views[0]!.id
    return { activeViewId: active, views: reg.views.map((v) => ({ ...v })) }
  }
  return {
    activeViewId: DEFAULT_DIAGRAM_VIEW_ID,
    views: [{ id: DEFAULT_DIAGRAM_VIEW_ID, name: 'Default' }],
  }
}

export function saveDiagramViewsRegistry(connectionId: string, registry: DiagramViewsRegistry) {
  const root = readViewsRoot()
  root[connectionId] = {
    activeViewId: registry.activeViewId,
    views: registry.views.map((v) => ({ ...v })),
  }
  writeViewsRoot(root)
}

export function duplicateLayoutSnapshotForNewView(
  connectionId: string,
  _sourceViewId: string,
  targetViewId: string,
  snapshot: DiagramLayoutSnapshot,
) {
  const all = readLayoutV2()
  all[compositeLayoutKey(connectionId, targetViewId)] = normalizeIncomingSnapshot(snapshot)
  writeLayoutV2(all)
}

export function deleteDiagramViewLayout(connectionId: string, viewId: string) {
  if (viewId === DEFAULT_DIAGRAM_VIEW_ID) return
  const all = readLayoutV2()
  delete all[compositeLayoutKey(connectionId, viewId)]
  writeLayoutV2(all)
}

export function gridPositionForIndex(index: number): { x: number; y: number } {
  const col = index % 4
  const row = Math.floor(index / 4)
  return { x: 48 + col * 280, y: 48 + row * 240 }
}

export function ensurePositions(
  keys: TableKey[],
  existing: Record<TableKey, { x: number; y: number }>,
): Record<TableKey, { x: number; y: number }> {
  const next = { ...existing }
  let idx = Object.keys(next).length
  for (const key of keys) {
    if (next[key] == null) {
      next[key] = gridPositionForIndex(idx)
      idx += 1
    }
  }
  return next
}
