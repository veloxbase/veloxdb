import { invoke } from '@tauri-apps/api/core'
import { toJpeg, toPng } from 'html-to-image'

/** Canvas size browsers reliably support; larger snapshots are scaled down. */
const MAX_SNAPSHOT_EDGE_PX = 12_000
const SNAPSHOT_PIXEL_RATIO = 2

export type SnapshotFormat = 'jpeg' | 'png'

export type DashboardSnapshot = {
  format: SnapshotFormat
  /** Image bytes, base64 without the `data:` prefix. */
  base64: string
  width: number
  height: number
  background: string
  foreground: string
}

export type ExportDashboardPdfRequest = {
  title: string
  description?: string
  outputPath: string
  snapshot: DashboardSnapshot
}

/** `rgb(1, 2, 3)` / `rgba(...)` to `#010203`; null for transparent or unknown. */
export function cssColorToHex(value: string): string | null {
  const match = value.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?/i)
  if (!match) return null
  if (match[4] !== undefined && Number(match[4]) === 0) return null
  return `#${[match[1], match[2], match[3]]
    .map((channel) => Number(channel).toString(16).padStart(2, '0'))
    .join('')}`
}

/**
 * Any CSS colour (including `oklch()`, which the theme uses) to `#rrggbb`, by
 * painting one pixel and reading it back.
 */
function resolveCssColor(value: string, fallback: string): string {
  const direct = cssColorToHex(value)
  if (direct) return direct
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return fallback
    ctx.fillStyle = fallback
    ctx.fillStyle = value
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
    if (a === 0) return fallback
    return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
  } catch {
    return fallback
  }
}

function findSnapshotNode(dashboardId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-dashboard-capture="${CSS.escape(dashboardId)}"]`)
}

function loadImageSize(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = () => reject(new Error('Could not read the dashboard snapshot.'))
    image.src = dataUrl
  })
}

/**
 * Renders the dashboard surface as it looks on screen. The WebGL grain
 * backdrop is skipped: WebGL canvases cannot be read back, so they would
 * come out as blank boxes.
 */
export async function captureDashboardSnapshot(
  dashboardId: string,
  format: SnapshotFormat = 'jpeg',
): Promise<DashboardSnapshot> {
  const node = findSnapshotNode(dashboardId)
  if (!node) {
    throw new Error('Open the dashboard view (not Logic) with at least one widget to export it.')
  }
  const bodyStyle = getComputedStyle(document.body)
  const background = resolveCssColor(bodyStyle.backgroundColor, '#ffffff')
  const foreground = resolveCssColor(bodyStyle.color, '#111111')

  const longestEdge = Math.max(node.scrollWidth, node.scrollHeight, 1)
  const pixelRatio = Math.min(SNAPSHOT_PIXEL_RATIO, MAX_SNAPSHOT_EDGE_PX / longestEdge)

  const render = format === 'png' ? toPng : toJpeg
  const dataUrl = await render(node, {
    quality: 0.92,
    pixelRatio,
    backgroundColor: background,
    width: node.scrollWidth,
    height: node.scrollHeight,
    cacheBust: true,
    filter: (child) => !(child instanceof HTMLElement && child.classList.contains('chart-paper-backdrop')),
  })
  const { width, height } = await loadImageSize(dataUrl)
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  return { format, base64, width, height, background, foreground }
}

/** Writes a PDF of the snapshot to `outputPath` (native, via printpdf). */
export async function exportDashboardPdf(input: ExportDashboardPdfRequest): Promise<string> {
  if (input.snapshot.format !== 'jpeg') {
    throw new Error('PDF export needs a JPEG snapshot.')
  }
  return invoke<string>('export_dashboard_pdf', {
    input: {
      title: input.title,
      description: input.description,
      outputPath: input.outputPath,
      snapshotJpegBase64: input.snapshot.base64,
      snapshotWidth: input.snapshot.width,
      snapshotHeight: input.snapshot.height,
      background: input.snapshot.background,
      foreground: input.snapshot.foreground,
    },
  })
}

/** Writes a PNG snapshot to `outputPath`. */
export async function saveDashboardPng(snapshot: DashboardSnapshot, outputPath: string): Promise<void> {
  if (snapshot.format !== 'png') throw new Error('Expected a PNG snapshot.')
  await invoke<void>('save_base64_png', { data: snapshot.base64, outputPath })
}
