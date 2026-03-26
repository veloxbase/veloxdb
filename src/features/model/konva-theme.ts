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
  shadow: string
}

export function readKonvaPalette(isDark: boolean): KonvaPalette {
  const base = readKonvaPaletteFromDom()
  return {
    ...base,
    shadow: isDark ? 'rgba(0, 0, 0, 0.55)' : 'rgba(15, 23, 42, 0.14)',
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

function readKonvaPaletteFromDom(): Omit<KonvaPalette, 'shadow'> {
  const root = document.documentElement
  return {
    canvasBg: readColorVar(root, 'backgroundColor', '--background'),
    card: readColorVar(root, 'backgroundColor', '--card'),
    header: readColorVar(root, 'backgroundColor', '--secondary'),
    border: readColorVar(root, 'backgroundColor', '--border'),
    borderFocus: readColorVar(root, 'backgroundColor', '--ring'),
    foreground: readColorVar(root, 'color', '--card-foreground'),
    mutedForeground: readColorVar(root, 'color', '--muted-foreground'),
    edge: readColorVar(root, 'backgroundColor', '--sidebar-border'),
  }
}
