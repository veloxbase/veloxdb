import { useHotkey, type UseHotkeyOptions, type RegisterableHotkey } from '@tanstack/react-hotkeys'
import { getShortcut, type ShortcutCommandId } from './registry'

/**
 * Type-safe hook registering a keyboard shortcut from the central command registry.
 */
export function useAppHotkey(
  commandId: ShortcutCommandId,
  callback: (event: KeyboardEvent) => void,
  options?: UseHotkeyOptions,
) {
  const shortcut = getShortcut(commandId)
  useHotkey(shortcut.hotkey as RegisterableHotkey, callback, options)
}

export { useHotkey, useHotkeys, HotkeysProvider } from '@tanstack/react-hotkeys'
