import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link'
import { openUrl } from '@tauri-apps/plugin-opener'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { queryKeys } from '@/data/query-keys'
import { isProBuild } from '@/lib/build-config'
import {
  exchangeDesktopCode,
  fetchMe,
  type CloudUser,
} from '@/features/auth/cloud-client'
import { DESKTOP_REDIRECT_URI, getCloudUrl } from '@/features/auth/cloud-config'
import {
  clearCloudApiKey,
  getCloudApiKeySync,
  loadCloudApiKey,
  saveCloudApiKey,
} from '@/features/auth/cloud-credentials'
import { connectLiveAgent, disconnectLiveAgent } from '@/features/auth/live-agent'
import { createPkcePair, parseDesktopCallbackUrl } from '@/features/auth/pkce'

export type CloudSessionStatus = 'loading' | 'signed_out' | 'signed_in'

type PendingPkce = {
  state: string
  codeVerifier: string
}

type CloudAuthContextValue = {
  status: CloudSessionStatus
  user: CloudUser | null
  hasSession: boolean
  signIn: () => Promise<void>
  signOut: () => Promise<void>
  connectWithApiKey: (apiKey: string) => Promise<void>
}

const defaultAuthValue: CloudAuthContextValue = {
  status: 'signed_out',
  user: null,
  hasSession: false,
  signIn: async () => {},
  signOut: async () => {},
  connectWithApiKey: async () => {},
}

const CloudAuthContext = createContext<CloudAuthContextValue>(defaultAuthValue)

let pendingPkce: PendingPkce | null = null

function isDesktopCallbackUrl(url: string): boolean {
  return url.startsWith('veloxdb://auth/callback') || url.includes('/callback?') || url.includes('/callback&')
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<CloudSessionStatus>(isProBuild ? 'loading' : 'signed_out')
  const [user, setUser] = useState<CloudUser | null>(null)

  const invalidateCloudQueries = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.session() })
    void queryClient.invalidateQueries({ queryKey: queryKeys.entitlements() })
    void queryClient.invalidateQueries({ queryKey: queryKeys.cloudUsage() })
    void queryClient.invalidateQueries({ queryKey: queryKeys.cloudModels() })
  }, [queryClient])

  const applySession = useCallback(
    (nextUser: CloudUser | null) => {
      setUser(nextUser)
      setStatus(nextUser ? 'signed_in' : 'signed_out')
      invalidateCloudQueries()
    },
    [invalidateCloudQueries],
  )

  const completeCallback = useCallback(
    async (url: string) => {
      const pending = pendingPkce
      if (!pending) return
      const { code, state } = parseDesktopCallbackUrl(url)
      if (state && state !== pending.state) {
        throw new Error('Sign-in state did not match. Try again.')
      }
      const exchanged = await exchangeDesktopCode({
        code,
        code_verifier: pending.codeVerifier,
      })
      pendingPkce = null
      await saveCloudApiKey(exchanged.accessToken)
      applySession(exchanged.user)
    },
    [applySession],
  )

  useEffect(() => {
    if (!isProBuild) return

    let cancelled = false
    const unlistenFns: Array<() => void> = []

    void (async () => {
      const key = await loadCloudApiKey()
      if (cancelled) return
      if (!key) {
        applySession(null)
      } else {
        try {
          applySession(await fetchMe(key))
        } catch {
          await clearCloudApiKey()
          if (!cancelled) applySession(null)
        }
      }

      const handleUrls = (urls: string[]) => {
        const callback = urls.find(isDesktopCallbackUrl)
        if (!callback) return
        void completeCallback(callback).catch((error) => {
          console.error('Velox Cloud sign-in failed', error)
        })
      }

      try {
        const startUrls = await getCurrent()
        if (!cancelled && startUrls?.length) handleUrls(startUrls)
      } catch {
        // Deep-link plugin may be unavailable in some test/dev hosts.
      }

      try {
        unlistenFns.push(await onOpenUrl(handleUrls))
      } catch {
        // Same as getCurrent — ignore if the plugin is not ready.
      }

      try {
        unlistenFns.push(
          await listen<string>('desktop-auth-callback', (event) => {
            if (typeof event.payload === 'string') handleUrls([event.payload])
          }),
        )
      } catch {
        // Event listen is unavailable outside Tauri.
      }
    })()

    return () => {
      cancelled = true
      for (const unlisten of unlistenFns) unlisten()
    }
  }, [applySession, completeCallback])

  const signIn = useCallback(async () => {
    const { state, codeVerifier, codeChallenge } = await createPkcePair()
    pendingPkce = { state, codeVerifier }

    // veloxdb:// is not delivered to `tauri dev` on macOS. Use a loopback
    // HTTP callback locally; keep the custom scheme for packaged builds.
    const redirectUri = import.meta.env.DEV
      ? await invoke<string>('start_desktop_auth_callback')
      : DESKTOP_REDIRECT_URI

    const stops: Array<() => void> = []
    try {
      const callbackUrl = await new Promise<string>((resolve, reject) => {
        let settled = false
        const finish = (url: string) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          resolve(url)
        }

        const timer = setTimeout(() => {
          reject(new Error('Sign-in timed out. Try again.'))
        }, 180_000)

        void (async () => {
          try {
            stops.push(
              await listen<string>('desktop-auth-callback', (event) => {
                if (typeof event.payload === 'string') finish(event.payload)
              }),
            )
            try {
              stops.push(
                await onOpenUrl((urls) => {
                  const callback = urls.find(isDesktopCallbackUrl)
                  if (callback) finish(callback)
                }),
              )
            } catch {
              // Deep-link listener is optional in local loopback mode.
            }

            const url = new URL('/auth/desktop', getCloudUrl())
            url.searchParams.set('state', state)
            url.searchParams.set('code_challenge', codeChallenge)
            url.searchParams.set('code_challenge_method', 'S256')
            url.searchParams.set('redirect_uri', redirectUri)
            await openUrl(url.toString())
          } catch (error) {
            reject(error instanceof Error ? error : new Error('Could not open the browser.'))
          }
        })()
      })

      await completeCallback(callbackUrl)
    } finally {
      for (const stop of stops) stop()
    }
  }, [completeCallback])

  const signOut = useCallback(async () => {
    pendingPkce = null
    await clearCloudApiKey()
    applySession(null)
  }, [applySession])

  const connectWithApiKey = useCallback(
    async (apiKey: string) => {
      const trimmed = apiKey.trim()
      if (!trimmed.startsWith('velox_')) {
        throw new Error('Velox API keys start with velox_.')
      }
      await saveCloudApiKey(trimmed)
      try {
        applySession(await fetchMe(trimmed))
      } catch (error) {
        await clearCloudApiKey()
        applySession(null)
        throw error
      }
    },
    [applySession],
  )

  const value = useMemo<CloudAuthContextValue>(
    () => ({
      status,
      user,
      hasSession: status === 'signed_in' && Boolean(getCloudApiKeySync()),
      signIn,
      signOut,
      connectWithApiKey,
    }),
    [connectWithApiKey, signIn, signOut, status, user],
  )

  useEffect(() => {
    if (status === 'signed_in' && getCloudApiKeySync()) {
      connectLiveAgent()
      return () => disconnectLiveAgent()
    }
    disconnectLiveAgent()
  }, [status])

  return <CloudAuthContext.Provider value={value}>{children}</CloudAuthContext.Provider>
}

export function useCloudAuth(): CloudAuthContextValue {
  const value = useContext(CloudAuthContext)
  if (!value) {
    throw new Error('useCloudAuth must be used within AuthProvider')
  }
  return value
}
