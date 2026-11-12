import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import {
  DEFAULT_AI_PROVIDER,
  getAiProvider,
  inferAiProvider,
  isAiProviderId,
  isLocalAiEndpoint,
  type AiProviderId,
} from '@/lib/ai-providers'

export type AppTheme = 'system' | 'light' | 'dark' | 'sepia' | 'ocean' | 'forest' | 'rose' | 'slate' | 'amber'
export type FontSize = number | 'sm' | 'md' | 'lg'
export type NullDisplay = 'null' | 'NULL' | 'dash' | 'empty'
export type ChartPaperTint = 'auto' | 'neutral' | 'accent'
export type ChartPaperStrength = 'off' | 'soft' | 'medium'

export type ToastLevel = 'success' | 'error'
export type ToastLevels = Record<ToastLevel, boolean>

export type AppSettings = {
  theme: AppTheme
  chartPaperTint: ChartPaperTint
  chartPaperStrength: ChartPaperStrength
  fontSize: FontSize
  monospaceFont: string
  tabWidth: number
  showLineNumbers: boolean
  lintDebounceMs: number
  maxQueryRows: number
  nullDisplay: NullDisplay
  clickToCopy: boolean
  autoReconnect: boolean
  pingIntervalSec: number
  veloxyProvider: AiProviderId
  /** Key for `veloxyProvider`, loaded from the OS keychain; never persisted. */
  veloxyApiKey: string
  veloxyModel: string
  veloxyBaseUrl: string
  toastLevels: ToastLevels
}

const defaults: AppSettings = {
  theme: 'system',
  chartPaperTint: 'auto',
  chartPaperStrength: 'medium',
  fontSize: 14,
  monospaceFont: "'JetBrains Mono', 'Fira Code', 'Menlo', monospace",
  tabWidth: 2,
  showLineNumbers: true,
  lintDebounceMs: 280,
  maxQueryRows: 1000,
  nullDisplay: 'null',
  clickToCopy: true,
  autoReconnect: true,
  pingIntervalSec: 30,
  veloxyProvider: DEFAULT_AI_PROVIDER,
  veloxyApiKey: '',
  veloxyModel: getAiProvider(DEFAULT_AI_PROVIDER).models[0]?.id ?? '',
  veloxyBaseUrl: getAiProvider(DEFAULT_AI_PROVIDER).baseUrl,
  toastLevels: { success: true, error: true },
}

export function resolveFontSizePx(size: FontSize | undefined): number {
  if (typeof size === 'number' && !Number.isNaN(size)) {
    return Math.max(10, Math.min(32, Math.round(size)));
  }
  if (size === 'sm') return 12;
  if (size === 'md') return 14;
  if (size === 'lg') return 16;
  if (typeof size === 'string') {
    const parsed = parseInt(size, 10);
    if (!Number.isNaN(parsed)) return Math.max(10, Math.min(32, parsed));
  }
  return 14;
}

export { isLocalAiEndpoint } from '@/lib/ai-providers'

export type IsVeloxyConfiguredOptions = {
  provider?: AiProviderId | null;
  apiKey?: string | null;
  model?: string | null;
  baseUrl?: string | null;
};

export function isVeloxyConfigured(options: IsVeloxyConfiguredOptions): boolean {
  const hasModel = Boolean(options.model?.trim());
  if (!hasModel || !options.baseUrl?.trim()) return false;
  if (isLocalAiEndpoint(options.baseUrl)) return true;
  const requiresKey = options.provider ? getAiProvider(options.provider).requiresKey : true;
  return !requiresKey || Boolean(options.apiKey?.trim());
}

/**
 * v0 had no provider: it stored an OpenRouter-style base URL and kept the key
 * in `veloxyOpenRouterApiKey`. Infer the provider from the URL so existing
 * users keep working, and carry any plaintext key over so it is moved into
 * the keychain on load.
 */
export function migrateSettings(persisted: unknown, version: number): AppSettings {
  const state = { ...(persisted as Record<string, unknown>) }
  if (version < 1) {
    if (!isAiProviderId(state.veloxyProvider)) {
      state.veloxyProvider = inferAiProvider(state.veloxyBaseUrl as string | undefined)
    }
    if (typeof state.veloxyOpenRouterApiKey === 'string' && state.veloxyOpenRouterApiKey) {
      state.veloxyApiKey = state.veloxyOpenRouterApiKey
    }
    delete state.veloxyOpenRouterApiKey
    delete state.veloxyCloudModel
  }
  return state as AppSettings
}

export const useSettings = create<AppSettings>()(
  persist(() => defaults, {
    name: 'veloxdb.settings',
    version: 1,
    migrate: migrateSettings,
    // API keys live in the OS keychain, never in localStorage.
    partialize: (s) => {
      const rest = { ...s }
      delete (rest as Partial<AppSettings>).veloxyApiKey
      return rest
    },
  }),
)

export function resolveTheme(theme: AppTheme): 'light' | 'dark' {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  if (theme === 'light' || theme === 'sepia') return 'light'
  return 'dark'
}

export function themeClassName(theme: AppTheme): string | null {
  switch (theme) {
    case 'dark':   return 'dark'
    case 'sepia':  return 'theme-sepia'
    case 'ocean':  return 'theme-ocean'
    case 'forest': return 'theme-forest'
    case 'rose':   return 'theme-rose'
    case 'slate':  return 'theme-slate'
    case 'amber':  return 'theme-amber'
    default:       return null
  }
}

export const themeLabels: Record<AppTheme, string> = {
  system: 'System',
  light:  'Light',
  dark:   'Dark',
  sepia:  'Sepia',
  ocean:  'Ocean',
  forest: 'Forest',
  rose:   'Rose',
  slate:  'Slate',
  amber:  'Amber',
}

export const THEME_CLASSES = ['dark', 'theme-sepia', 'theme-ocean', 'theme-forest', 'theme-rose', 'theme-slate', 'theme-amber'] as const

export const THEME_ORDER: AppTheme[] = [
  'system',
  'dark',
  'light',
  'ocean',
  'slate',
  'forest',
  'amber',
  'sepia',
  'rose',
]

export type ThemeSwatch = {
  bg: string
  accent: string
  border: string
}

export const THEME_SWATCHES: Record<AppTheme, ThemeSwatch> = {
  system: { bg: '#18181b', accent: '#5e95ff', border: '#27272a' },
  dark:   { bg: '#141414', accent: '#5e95ff', border: '#262626' },
  light:  { bg: '#ffffff', accent: '#2563eb', border: '#e2e8f0' },
  ocean:  { bg: '#0c1524', accent: '#4592ff', border: '#1a273e' },
  slate:  { bg: '#0d1117', accent: '#4493f8', border: '#21262d' },
  forest: { bg: '#101a14', accent: '#3eb875', border: '#1e2e23' },
  amber:  { bg: '#0a0701', accent: '#f59e0b', border: '#2b1c04' },
  sepia:  { bg: '#f7f4ec', accent: '#8f5724', border: '#e0d9cb' },
  rose:   { bg: '#1a1017', accent: '#e36399', border: '#301d29' },
}

/**
 * Ultra-fast, GPU-composited theme switcher using modern View Transitions.
 * Sweeps a circular clip-path ripple from the click coordinate without frame drops.
 */
export function switchThemeWithAnimation(newTheme: AppTheme, event?: React.MouseEvent | MouseEvent) {
  const doc = typeof document !== 'undefined' ? (document as Document & { startViewTransition?: (cb: () => void) => { ready?: Promise<void> } }) : null
  const prefersReducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  if (!doc?.startViewTransition || prefersReducedMotion) {
    useSettings.setState({ theme: newTheme })
    return
  }

  const x = event?.clientX ?? window.innerWidth / 2
  const y = event?.clientY ?? 0
  const endRadius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y),
  )

  const transition = doc.startViewTransition(() => {
    useSettings.setState({ theme: newTheme })
  })

  transition.ready?.then(() => {
    document.documentElement.animate(
      {
        clipPath: [
          `circle(0px at ${x}px ${y}px)`,
          `circle(${endRadius}px at ${x}px ${y}px)`,
        ],
      },
      {
        duration: 260,
        easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
        pseudoElement: '::view-transition-new(root)',
      },
    )
  }).catch(() => {
    // Ignore if transition canceled or unmounted
  })
}
