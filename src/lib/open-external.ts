import { isTauri } from '@tauri-apps/api/core'
import { openUrl } from '@tauri-apps/plugin-opener'

/** Opens an http(s) URL in the user's default browser. */
export async function openExternal(url: string): Promise<void> {
  const target = /^https?:\/\//i.test(url) ? url : `https://${url}`
  if (isTauri()) {
    await openUrl(target)
    return
  }
  window.open(target, '_blank', 'noopener,noreferrer')
}
