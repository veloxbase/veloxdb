import type { TableKey } from '@/features/model/model-types'

/** FNV-1a 32-bit — stable hue per table id across sessions. */
function hashTableKey(key: string): number {
  let h = 2166136261
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function hueFromKey(key: string): number {
  return hashTableKey(key) % 360
}

function hslToHex(h: number, s: number, l: number): string {
  const s1 = s / 100
  const l1 = l / 100
  const c = (1 - Math.abs(2 * l1 - 1)) * s1
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l1 - c / 2
  let r = 0
  let g = 0
  let b = 0
  if (h < 60) {
    r = c
    g = x
  } else if (h < 120) {
    r = x
    g = c
  } else if (h < 180) {
    g = c
    b = x
  } else if (h < 240) {
    g = x
    b = c
  } else if (h < 300) {
    r = x
    b = c
  } else {
    r = c
    b = x
  }
  const to255 = (v: number) => Math.round((v + m) * 255)
  const rr = to255(r)
  const gg = to255(g)
  const bb = to255(b)
  return `#${rr.toString(16).padStart(2, '0')}${gg.toString(16).padStart(2, '0')}${bb.toString(16).padStart(2, '0')}`
}

/**
 * Distinct header color for a table when the user has not set a custom color.
 * Tuned for readable labels via contrast helpers on the diagram node.
 */
export function defaultDiagramHeaderHex(tableKey: TableKey, isDark: boolean): string {
  const h = hueFromKey(tableKey)
  if (isDark) {
    return hslToHex(h, 56, 36)
  }
  return hslToHex(h, 50, 46)
}
