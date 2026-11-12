const KEY = 'veloxdb.dashboard.lastOpen'
const GLOBAL_KEY = 'veloxdb.dashboard.lastOpenGlobal'

type LastOpenMap = Record<string, string>

function readMap(): LastOpenMap {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed as LastOpenMap : {}
  } catch {
    return {}
  }
}

export function loadLastDashboardId(connectionId: string): string | null {
  return readMap()[connectionId] ?? null
}

export function saveLastDashboardId(connectionId: string, dashboardId: string): void {
  const map = readMap()
  map[connectionId] = dashboardId
  window.localStorage.setItem(KEY, JSON.stringify(map))
  saveGlobalLastDashboardId(dashboardId)
}

export function loadGlobalLastDashboardId(): string | null {
  try {
    return window.localStorage.getItem(GLOBAL_KEY)
  } catch {
    return null
  }
}

export function saveGlobalLastDashboardId(dashboardId: string): void {
  try {
    window.localStorage.setItem(GLOBAL_KEY, dashboardId)
  } catch {
    // ignore quota errors
  }
}
