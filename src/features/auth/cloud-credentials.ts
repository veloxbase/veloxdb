import { invoke } from '@tauri-apps/api/core'

let cachedKey: string | null = null
let loaded = false

export function getCloudApiKeySync(): string | null {
  return cachedKey
}

export async function loadCloudApiKey(): Promise<string | null> {
  if (loaded) return cachedKey
  loaded = true
  try {
    const stored = await invoke<string | null>('get_cloud_api_key')
    cachedKey = stored?.trim() ? stored : null
  } catch {
    cachedKey = null
  }
  return cachedKey
}

export async function saveCloudApiKey(apiKey: string): Promise<void> {
  const trimmed = apiKey.trim()
  cachedKey = trimmed || null
  loaded = true
  if (!trimmed) {
    await invoke('delete_cloud_api_key')
    return
  }
  await invoke('store_cloud_api_key', { apiKey: trimmed })
}

export async function clearCloudApiKey(): Promise<void> {
  cachedKey = null
  loaded = true
  try {
    await invoke('delete_cloud_api_key')
  } catch {
    // Session is already cleared in memory.
  }
}

export function resetCloudApiKeyCache(): void {
  cachedKey = null
  loaded = false
}
