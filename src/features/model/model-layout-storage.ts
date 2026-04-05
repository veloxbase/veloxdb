import type { DiagramLayoutSnapshot, DiagramToolPersisted, TableKey } from '@/features/model/model-types'

const STORAGE_KEY = 'veloxdb.modelLayout.v1'

type PersistedMap = Record<string, DiagramLayoutSnapshot>

function readAll(): PersistedMap {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed as PersistedMap
  } catch {
    return {}
  }
}

function writeAll(map: PersistedMap) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {
    // ignore quota errors
  }
}

export function loadDiagramLayout(connectionId: string): DiagramLayoutSnapshot | null {
  const all = readAll()
  const snap = all[connectionId]
  if (!snap || !Array.isArray(snap.onCanvas)) return null
  const headerColors =
    snap.headerColors && typeof snap.headerColors === 'object' && !Array.isArray(snap.headerColors)
      ? { ...(snap.headerColors as Record<TableKey, string>) }
      : undefined
  const diagramTool =
    snap.diagramTool === 'select' || snap.diagramTool === 'pan' || snap.diagramTool === 'connect'
      ? snap.diagramTool
      : undefined
  const snapToGrid =
    typeof snap.snapToGrid === 'boolean' ? snap.snapToGrid : undefined

  return {
    positions: snap.positions ?? {},
    viewport: snap.viewport ?? { scale: 1, x: 0, y: 0 },
    onCanvas: snap.onCanvas,
    modelTitle: typeof snap.modelTitle === 'string' ? snap.modelTitle : undefined,
    ...(headerColors && Object.keys(headerColors).length > 0 ? { headerColors } : {}),
    ...(diagramTool ? { diagramTool } : {}),
    ...(snapToGrid !== undefined ? { snapToGrid } : {}),
  }
}

export function saveDiagramLayout(connectionId: string, snapshot: DiagramLayoutSnapshot) {
  const all = readAll()
  const headerColors =
    snapshot.headerColors && Object.keys(snapshot.headerColors).length > 0
      ? { ...snapshot.headerColors }
      : undefined
  const diagramTool = snapshot.diagramTool as DiagramToolPersisted | undefined
  all[connectionId] = {
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
  }
  writeAll(all)
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
