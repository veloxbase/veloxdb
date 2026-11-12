import type { WidgetLayout } from '@/data/types'
import {
  GRID_COLS,
  GRID_MARGIN,
  GRID_ROW_HEIGHT,
} from '@/features/dashboards/grid-constants'

export type GridRect = {
  left: number
  top: number
  width: number
  height: number
}

export type GridMetrics = {
  cols: number
  rowHeight: number
  margin: [number, number]
  containerPadding: [number, number]
  containerWidth: number
  maxRows: number
}

export function createGridMetrics(
  containerWidth: number,
  options?: {
    cols?: number
    rowHeight?: number
    margin?: [number, number]
    containerPadding?: [number, number]
    maxRows?: number
  },
): GridMetrics {
  return {
    cols: options?.cols ?? GRID_COLS,
    rowHeight: options?.rowHeight ?? GRID_ROW_HEIGHT,
    margin: options?.margin ?? GRID_MARGIN,
    containerPadding: options?.containerPadding ?? [0, 0],
    containerWidth,
    maxRows: options?.maxRows ?? 200,
  }
}

export function colWidth(metrics: GridMetrics): number {
  const { margin, containerPadding, containerWidth, cols } = metrics
  return (containerWidth - margin[0] * (cols - 1) - containerPadding[0] * 2) / cols
}

function gridUnitsToPx(
  units: number,
  unitSize: number,
  marginPx: number,
): number {
  if (!Number.isFinite(units)) return units
  return Math.round(unitSize * units + Math.max(0, units - 1) * marginPx)
}

export function slotToRect(metrics: GridMetrics, slot: Pick<WidgetLayout, 'x' | 'y' | 'w' | 'h'>): GridRect {
  const { margin, containerPadding, rowHeight } = metrics
  const cw = colWidth(metrics)
  return {
    left: Math.round((cw + margin[0]) * slot.x + containerPadding[0]),
    top: Math.round((rowHeight + margin[1]) * slot.y + containerPadding[1]),
    width: gridUnitsToPx(slot.w, cw, margin[0]),
    height: gridUnitsToPx(slot.h, rowHeight, margin[1]),
  }
}

export function pixelToGrid(
  metrics: GridMetrics,
  top: number,
  left: number,
  w: number,
  h: number,
): { x: number; y: number } {
  const { margin, containerPadding, cols, rowHeight, maxRows } = metrics
  const cw = colWidth(metrics)
  const x = clamp(
    Math.round((left - containerPadding[0]) / (cw + margin[0])),
    0,
    cols - w,
  )
  const y = clamp(
    Math.round((top - containerPadding[1]) / (rowHeight + margin[1])),
    0,
    maxRows - h,
  )
  return { x, y }
}

export function pixelSizeToGrid(
  metrics: GridMetrics,
  width: number,
  height: number,
  x: number,
  y: number,
): { w: number; h: number } {
  const { margin, cols, rowHeight, maxRows } = metrics
  const cw = colWidth(metrics)
  const w = clamp(
    Math.round((width + margin[0]) / (cw + margin[0])),
    1,
    cols - x,
  )
  const h = clamp(
    Math.round((height + margin[1]) / (rowHeight + margin[1])),
    1,
    maxRows - y,
  )
  return { w, h }
}

export function layoutMinHeight(metrics: GridMetrics, layout: WidgetLayout[]): number {
  if (layout.length === 0) return metrics.rowHeight
  const bottomRow = Math.max(...layout.map((slot) => slot.y + slot.h))
  const { margin, containerPadding, rowHeight } = metrics
  return (rowHeight + margin[1]) * bottomRow - margin[1] + containerPadding[1] * 2
}

export function snapGridSteps(metrics: GridMetrics): { x: number; y: number } {
  const cw = colWidth(metrics)
  return {
    x: cw + metrics.margin[0],
    y: metrics.rowHeight + metrics.margin[1],
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
