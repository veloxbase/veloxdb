import { invoke } from '@tauri-apps/api/core'

import { useSettings } from '@/lib/settings'

/**
 * The OpenRouter API key lives in the OS keychain, not in localStorage. These
 * helpers keep the in-memory zustand state in sync with the keychain so the
 * rest of the app can keep reading `settings.veloxyOpenRouterApiKey`.
 */

let loaded = false

export async function loadOpenRouterApiKey(): Promise<void> {
  if (loaded) return
  loaded = true

  // One-time migration: an older build may have persisted the key in
  // localStorage. Move it into the keychain so the next write (below) scrubs
  // the plaintext copy via the store's `partialize`.
  const persisted = useSettings.getState().veloxyOpenRouterApiKey
  if (persisted.trim()) {
    try {
      await invoke('store_openrouter_api_key', { apiKey: persisted })
    } catch {
      // Keep the in-memory key so Veloxy still works this session.
      return
    }
  }

  try {
    const stored = await invoke<string | null>('get_openrouter_api_key')
    // Re-setting state triggers a partialized persist, removing any lingering
    // plaintext key from localStorage.
    useSettings.setState({ veloxyOpenRouterApiKey: stored ?? persisted })
  } catch {
    // Leave whatever is already in memory.
  }
}

export async function saveOpenRouterApiKey(apiKey: string): Promise<void> {
  useSettings.setState({ veloxyOpenRouterApiKey: apiKey })
  await invoke('store_openrouter_api_key', { apiKey })
}
