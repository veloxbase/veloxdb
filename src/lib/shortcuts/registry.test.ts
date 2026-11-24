import { describe, expect, it } from 'vitest'
import {
  SHORTCUTS,
  formatHotkeyForPlatform,
  getShortcut,
  getShortcutDisplay,
} from './registry'

describe('shortcuts/registry', () => {
  it('has valid shortcut definitions for all commands', () => {
    for (const [id, def] of Object.entries(SHORTCUTS)) {
      expect(def.id).toBe(id)
      expect(def.hotkey).toBeTruthy()
      expect(def.category).toBeTruthy()
      expect(def.labelKey).toBeTruthy()
    }
  })

  it('formats hotkeys correctly for Mac', () => {
    expect(formatHotkeyForPlatform('Mod+P', true)).toBe('⌘P')
    expect(formatHotkeyForPlatform('Mod+Shift+E', true)).toBe('⌘⇧E')
    expect(formatHotkeyForPlatform('Mod+Enter', true)).toBe('⌘↵')
    expect(formatHotkeyForPlatform('Mod+Shift+C', true)).toBe('⌘⇧C')
  })

  it('formats hotkeys correctly for Windows/Linux', () => {
    expect(formatHotkeyForPlatform('Mod+P', false)).toBe('Ctrl+P')
    expect(formatHotkeyForPlatform('Mod+Shift+E', false)).toBe('Ctrl+Shift+E')
    expect(formatHotkeyForPlatform('Mod+Enter', false)).toBe('Ctrl+Enter')
  })

  it('retrieves shortcut and shortcut display text by id', () => {
    const shortcut = getShortcut('fixQueryError')
    expect(shortcut.hotkey).toBe('Mod+Shift+E')
    expect(getShortcutDisplay('fixQueryError', true)).toBe('⌘⇧E')
    expect(getShortcutDisplay('fixQueryError', false)).toBe('Ctrl+Shift+E')
  })
})
