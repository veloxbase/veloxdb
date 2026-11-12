export type ShortcutCategory = 'global' | 'query' | 'ai' | 'diagram' | 'results'

export interface ShortcutDefinition {
  id: string
  category: ShortcutCategory
  hotkey: string
  labelKey: string
  defaultLabel: string
  descriptionKey?: string
  defaultDescription?: string
}

export const SHORTCUTS: Record<string, ShortcutDefinition> = {
  // Global
  commandPalette: {
    id: 'commandPalette',
    category: 'global',
    hotkey: 'Mod+P',
    labelKey: 'shortcuts.commandPalette',
    defaultLabel: 'Command Palette',
    defaultDescription: 'Quick action and navigation palette',
  },
  openSettings: {
    id: 'openSettings',
    category: 'global',
    hotkey: 'Mod+,',
    labelKey: 'shortcuts.openSettings',
    defaultLabel: 'Settings',
    defaultDescription: 'Open application preferences',
  },
  newConnection: {
    id: 'newConnection',
    category: 'global',
    hotkey: 'Mod+Shift+C',
    labelKey: 'shortcuts.openConnection',
    defaultLabel: 'New Connection',
    defaultDescription: 'Open database connection modal',
  },
  shortcutSheet: {
    id: 'shortcutSheet',
    category: 'global',
    hotkey: 'Mod+/',
    labelKey: 'shortcuts.showSheet',
    defaultLabel: 'Keyboard Shortcuts',
    defaultDescription: 'Open keyboard shortcuts sheet',
  },
  undo: {
    id: 'undo',
    category: 'global',
    hotkey: 'Mod+Z',
    labelKey: 'shortcuts.undo',
    defaultLabel: 'Undo',
  },
  redo: {
    id: 'redo',
    category: 'global',
    hotkey: 'Mod+Shift+Z',
    labelKey: 'shortcuts.redo',
    defaultLabel: 'Redo',
  },

  // Query Workspace
  runQuery: {
    id: 'runQuery',
    category: 'query',
    hotkey: 'Mod+Enter',
    labelKey: 'shortcuts.runQuery',
    defaultLabel: 'Run Query',
    defaultDescription: 'Execute selected statement or full query',
  },
  runSelection: {
    id: 'runSelection',
    category: 'query',
    hotkey: 'Mod+Shift+Enter',
    labelKey: 'shortcuts.runSelection',
    defaultLabel: 'Run Selected SQL',
    defaultDescription: 'Execute only the highlighted SQL selection',
  },
  formatSql: {
    id: 'formatSql',
    category: 'query',
    hotkey: 'Mod+Shift+F',
    labelKey: 'shortcuts.formatSql',
    defaultLabel: 'Format SQL',
    defaultDescription: 'Pretty-print and format active SQL editor text',
  },

  // AI & Veloxy
  inlineRefactor: {
    id: 'inlineRefactor',
    category: 'ai',
    hotkey: 'Mod+K',
    labelKey: 'shortcuts.inlineRefactor',
    defaultLabel: 'Inline Edit with Veloxy',
    defaultDescription: 'Refactor or generate SQL directly in the editor',
  },
  toggleAskVeloxy: {
    id: 'toggleAskVeloxy',
    category: 'ai',
    hotkey: 'Mod+L',
    labelKey: 'shortcuts.toggleAskVeloxy',
    defaultLabel: 'Toggle Ask Veloxy',
    defaultDescription: 'Open schema-aware AI SQL copilot drawer',
  },
  fixQueryError: {
    id: 'fixQueryError',
    category: 'ai',
    hotkey: 'Mod+Shift+E',
    labelKey: 'shortcuts.fixQueryError',
    defaultLabel: 'Fix with Veloxy',
    defaultDescription: 'Diagnose and automatically fix query execution error',
  },

  // Visual Diagram
  clearSelection: {
    id: 'clearSelection',
    category: 'diagram',
    hotkey: 'Escape',
    labelKey: 'shortcuts.clearSelection',
    defaultLabel: 'Clear Selection',
  },
  zoomIn: {
    id: 'zoomIn',
    category: 'diagram',
    hotkey: '+',
    labelKey: 'shortcuts.zoomIn',
    defaultLabel: 'Zoom In',
  },
  zoomOut: {
    id: 'zoomOut',
    category: 'diagram',
    hotkey: '-',
    labelKey: 'shortcuts.zoomOut',
    defaultLabel: 'Zoom Out',
  },
  resetZoom: {
    id: 'resetZoom',
    category: 'diagram',
    hotkey: '0',
    labelKey: 'shortcuts.resetZoom',
    defaultLabel: 'Reset Zoom',
  },

  // Results Grid
  copyRows: {
    id: 'copyRows',
    category: 'results',
    hotkey: 'Mod+C',
    labelKey: 'shortcuts.copyRows',
    defaultLabel: 'Copy Rows',
  },
} as const

export type ShortcutCommandId = keyof typeof SHORTCUTS

export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  return (
    navigator.platform?.includes('Mac') ||
    navigator.userAgent?.includes('Mac') ||
    false
  )
}

/**
 * Converts a canonical hotkey string (e.g. 'Mod+Shift+E') to platform display format (e.g. '⌘⇧E' or 'Ctrl+Shift+E').
 */
export function formatHotkeyForPlatform(hotkey: string, isMac = isMacPlatform()): string {
  if (!hotkey) return ''

  if (isMac) {
    return hotkey
      .replace(/Mod/gi, '⌘')
      .replace(/Meta/gi, '⌘')
      .replace(/Shift/gi, '⇧')
      .replace(/Alt/gi, '⌥')
      .replace(/Option/gi, '⌥')
      .replace(/Control/gi, '⌃')
      .replace(/Ctrl/gi, '⌃')
      .replace(/Enter/gi, '↵')
      .replace(/\+/g, '')
  }

  return hotkey
    .replace(/Mod/gi, 'Ctrl')
    .replace(/Meta/gi, 'Win')
    .replace(/Option/gi, 'Alt')
}

export function getShortcut(id: ShortcutCommandId): ShortcutDefinition {
  return SHORTCUTS[id]
}

export function getShortcutDisplay(id: ShortcutCommandId, isMac = isMacPlatform()): string {
  const shortcut = SHORTCUTS[id]
  return shortcut ? formatHotkeyForPlatform(shortcut.hotkey, isMac) : ''
}
