import type { WidgetLayout } from '@/data/types'

type LayoutSlot = WidgetLayout

function collides(a: LayoutSlot, b: LayoutSlot): boolean {
  if (a.i === b.i) return false
  if (a.x + a.w <= b.x) return false
  if (a.x >= b.x + b.w) return false
  if (a.y + a.h <= b.y) return false
  if (a.y >= b.y + b.h) return false
  return true
}

function getStatics(layout: LayoutSlot[]): LayoutSlot[] {
  return layout.filter((slot) => slot.isStatic)
}

function getFirstCollision(layout: LayoutSlot[], item: LayoutSlot): LayoutSlot | undefined {
  for (const other of layout) {
    if (collides(item, other)) return other
  }
  return undefined
}

function bottom(layout: LayoutSlot[]): number {
  let max = 0
  for (const slot of layout) {
    max = Math.max(max, slot.y + slot.h)
  }
  return max
}

function sortLayoutItems(layout: LayoutSlot[]): LayoutSlot[] {
  return [...layout].sort((a, b) => {
    if (a.y !== b.y) return a.y - b.y
    return a.x - b.x
  })
}

function resolveCompactionCollision(
  layout: LayoutSlot[],
  item: LayoutSlot,
  moveToCoord: number,
): void {
  item.y += 1
  const itemIndex = layout.findIndex((slot) => slot.i === item.i)
  for (let i = itemIndex + 1; i < layout.length; i++) {
    const other = layout[i]
    if (!other || other.isStatic) continue
    if (other.y > item.y + item.h) break
    if (collides(item, other)) {
      resolveCompactionCollision(layout, other, moveToCoord + item.h)
    }
  }
  item.y = moveToCoord
}

function compactItem(
  compareWith: LayoutSlot[],
  slot: LayoutSlot,
  cols: number,
  fullLayout: LayoutSlot[],
): LayoutSlot {
  const l = { ...slot }
  const floor = bottom(compareWith)
  l.y = Math.min(floor, l.y)

  while (l.y > 0 && !getFirstCollision(compareWith, l)) {
    l.y -= 1
  }

  let collision = getFirstCollision(compareWith, l)
  while (collision) {
    resolveCompactionCollision(fullLayout, l, collision.y + collision.h)
    collision = getFirstCollision(compareWith, l)
    if (l.x + l.w > cols) {
      l.x = cols - l.w
      l.y += 1
      while (l.x > 0 && !getFirstCollision(compareWith, l)) {
        l.x -= 1
      }
    }
  }

  l.y = Math.max(l.y, 0)
  l.x = Math.max(l.x, 0)
  return l
}

/** Vertical compaction — pushes items up and resolves collisions (RGL-compatible behavior). */
export function compactLayout(layout: WidgetLayout[], cols: number): WidgetLayout[] {
  const compareWith = getStatics(layout)
  let floor = bottom(compareWith)
  const sorted = sortLayoutItems(layout)
  const out: WidgetLayout[] = new Array(layout.length)

  for (const original of sorted) {
    let slot = { ...original }
    if (!slot.isStatic) {
      slot = compactItem(compareWith, slot, cols, sorted)
      floor = Math.max(floor, slot.y + slot.h)
      compareWith.push(slot)
    }
    const index = layout.findIndex((item) => item.i === original.i)
    out[index] = slot
  }

  return out
}
