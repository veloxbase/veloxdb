import { invoke } from '@tauri-apps/api/core'

import type { AiProviderId } from '@/lib/ai-providers'
import { useSettings } from '@/lib/settings'

/**
 * Each provider's API key lives in the OS keychain, not in localStorage. The
 * active provider's key is mirrored into `settings.veloxyApiKey` so the rest
 * of the app can read it synchronously.
 */

let migrated = false

async function readKey(provider: AiProviderId): Promise<string> {
  return (await invoke<string | null>('get_ai_api_key', { provider })) ?? ''
}

/** Loads the active provider's key into memory. Safe to call repeatedly. */
export async function loadAiApiKey(): Promise<void> {
  const { veloxyProvider, veloxyApiKey } = useSettings.getState()

  // One-time migration: an older build may have persisted a key in
  // localStorage. Move it into the keychain; the store's `partialize` then
  // drops the plaintext copy on the next write.
  if (!migrated) {
    migrated = true
    if (veloxyApiKey.trim()) {
      try {
        await invoke('store_ai_api_key', { provider: veloxyProvider, apiKey: veloxyApiKey })
      } catch {
        return // keep the in-memory key so Veloxy still works this session
      }
    }
  }

  try {
    const stored = await readKey(veloxyProvider)
    // Ignore a stale response if the user switched providers meanwhile.
    if (useSettings.getState().veloxyProvider === veloxyProvider) {
      useSettings.setState({ veloxyApiKey: stored })
    }
  } catch {
    // Leave whatever is already in memory.
  }
}

export async function saveAiApiKey(provider: AiProviderId, apiKey: string): Promise<void> {
  // Write the keychain first so the UI only shows the key as saved once it is.
  await invoke('store_ai_api_key', { provider, apiKey })
  if (useSettings.getState().veloxyProvider === provider) {
    useSettings.setState({ veloxyApiKey: apiKey })
  }
}
