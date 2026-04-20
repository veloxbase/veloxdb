/**
 * Resolve design tokens to RGB/RGBA strings so Konva Canvas can paint them
 * (computed style converts oklch CSS variables to rgb).
 */
export type KonvaPalette = {
  canvasBg: string
  card: string
  header: string
  border: string
  borderFocus: string
  foreground: string
  mutedForeground: string
  edge: string
  /** Pending / draft relationship lines */
  edgePending: string
  /** Edge stroke when hovered */
  edgeHover: string
  /** Diagram group frame stroke */
  groupFrame: string
  gridMinor: string
  gridMajor: string
  shadow: string
  /** Resolved from CSS `--radius` for Konva rects */
  cornerRadiusPx: number
}

export function readKonvaPalette(isDark: boolean): KonvaPalette {
  const base = readKonvaPaletteFromDom()
  return {
    ...base,
    gridMinor: isDark ? 'rgba(148, 163, 184, 0.12)' : 'rgba(15, 23, 42, 0.06)',
    gridMajor: isDark ? 'rgba(148, 163, 184, 0.22)' : 'rgba(15, 23, 42, 0.11)',
    shadow: isDark ? 'rgba(0, 0, 0, 0.4)' : 'rgba(15, 23, 42, 0.1)',
  }
}

function readColorVar(root: HTMLElement, property: 'color' | 'backgroundColor', cssVar: string): string {
  const el = document.createElement('div')
  if (property === 'color') {
    el.style.color = `var(${cssVar})`
  } else {
    el.style.backgroundColor = `var(${cssVar})`
  }
  el.style.position = 'fixed'
  el.style.left = '-9999px'
  el.style.top = '0'
  root.appendChild(el)
  const resolved = property === 'color' ? getComputedStyle(el).color : getComputedStyle(el).backgroundColor
  root.removeChild(el)
  return resolved && resolved !== 'rgba(0, 0, 0, 0)' ? resolved : 'rgb(128, 128, 128)'
}

function readCornerRadiusPx(root: HTMLElement): number {
  const el = document.createElement('div')
  el.style.position = 'fixed'
  el.style.left = '-9999px'
  el.style.top = '0'
  el.style.borderRadius = 'var(--radius)'
  root.appendChild(el)
  const px = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0
  root.removeChild(el)
  return px
}

function readKonvaPaletteFromDom(): Omit<
  KonvaPalette,
  'gridMinor' | 'gridMajor' | 'shadow'
> {
  const root = document.documentElement
  return {
    canvasBg: readColorVar(root, 'backgroundColor', '--background'),
    card: readColorVar(root, 'backgroundColor', '--card'),
    header: readColorVar(root, 'backgroundColor', '--diagram-table-header'),
    border: readColorVar(root, 'backgroundColor', '--border'),
    borderFocus: readColorVar(root, 'backgroundColor', '--ring'),
    foreground: readColorVar(root, 'color', '--card-foreground'),
    mutedForeground: readColorVar(root, 'color', '--muted-foreground'),
    edge: readColorVar(root, 'backgroundColor', '--sidebar-border'),
    edgePending: readColorVar(root, 'backgroundColor', '--primary'),
    edgeHover: readColorVar(root, 'backgroundColor', '--ring'),
    groupFrame: readColorVar(root, 'backgroundColor', '--muted'),
    cornerRadiusPx: readCornerRadiusPx(root),
  }
}
