import { create } from 'zustand'
import { persist } from 'zustand/middleware'

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
  veloxyOpenRouterApiKey: string
  veloxyModel: string
  veloxyCloudModel: string
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
  veloxyOpenRouterApiKey: '',
  veloxyModel: 'deepseek/deepseek-chat',
  veloxyCloudModel: '',
  veloxyBaseUrl: 'https://openrouter.ai/api/v1',
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

export function isLocalAiEndpoint(baseUrl: string | null | undefined): boolean {
  if (!baseUrl) return false;
  const lower = baseUrl.toLowerCase();
  return (
    lower.includes('localhost') ||
    lower.includes('127.0.0.1') ||
    lower.includes('0.0.0.0') ||
    lower.includes(':11434') ||
    lower.includes(':1234')
  );
}

export type IsVeloxyConfiguredOptions = {
  authMode?: 'cloud' | 'byok';
  hasSession?: boolean;
  apiKey?: string | null;
  model?: string | null;
  cloudModel?: string | null;
  baseUrl?: string | null;
};

export function isVeloxyConfigured(options: IsVeloxyConfiguredOptions): boolean {
  if (options.authMode === 'cloud') {
    return Boolean(options.hasSession && options.cloudModel?.trim());
  }
  const isLocal = isLocalAiEndpoint(options.baseUrl);
  const hasModel = Boolean(options.model?.trim());
  if (isLocal) {
    return hasModel;
  }
  return Boolean(options.apiKey?.trim() && hasModel);
}

export const useSettings = create<AppSettings>()(
  persist(() => defaults, {
    name: 'veloxdb.settings',
    // The OpenRouter API key is kept in the OS keychain, never in localStorage.
    partialize: (s) => {
      const rest = { ...s }
      delete (rest as Partial<AppSettings>).veloxyOpenRouterApiKey
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
