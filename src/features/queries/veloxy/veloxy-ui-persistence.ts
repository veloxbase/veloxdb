const VELOXY_DRAWER_WIDTH_KEY = 'veloxdb:veloxy-drawer-width'
const VELOXY_DRAWER_OPEN_KEY = 'veloxdb:veloxy-drawer-open'

export const DEFAULT_VELOXY_WIDTH = 380
export const MIN_VELOXY_WIDTH = 280
export const MAX_VELOXY_WIDTH = 800

function getStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage
    }
    if (typeof localStorage !== 'undefined') {
      return localStorage
    }
    return null
  } catch {
    return null
  }
}

export function clampVeloxyWidth(width: number): number {
  return Math.max(MIN_VELOXY_WIDTH, Math.min(width, MAX_VELOXY_WIDTH))
}

export function loadVeloxyDrawerWidth(): number {
  try {
    const storage = getStorage()
    if (!storage) return DEFAULT_VELOXY_WIDTH
    const raw = storage.getItem(VELOXY_DRAWER_WIDTH_KEY)
    if (!raw) return DEFAULT_VELOXY_WIDTH
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? clampVeloxyWidth(parsed) : DEFAULT_VELOXY_WIDTH
  } catch {
    return DEFAULT_VELOXY_WIDTH
  }
}

export function saveVeloxyDrawerWidth(width: number): void {
  try {
    const storage = getStorage()
    if (!storage) return
    storage.setItem(VELOXY_DRAWER_WIDTH_KEY, String(clampVeloxyWidth(width)))
  } catch {
    // Storage may be unavailable.
  }
}

export function loadVeloxyDrawerOpen(): boolean {
  try {
    const storage = getStorage()
    if (!storage) return false
    return storage.getItem(VELOXY_DRAWER_OPEN_KEY) === 'true'
  } catch {
    return false
  }
}

export function saveVeloxyDrawerOpen(open: boolean): void {
  try {
    const storage = getStorage()
    if (!storage) return
    storage.setItem(VELOXY_DRAWER_OPEN_KEY, String(open))
  } catch {
    // Storage may be unavailable.
  }
}
