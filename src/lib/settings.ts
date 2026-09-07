import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type AppTheme = 'system' | 'light' | 'dark' | 'sepia' | 'ocean' | 'forest' | 'rose' | 'slate' | 'amber'
export type FontSize = number | 'sm' | 'md' | 'lg'
export type NullDisplay = 'null' | 'NULL' | 'dash' | 'empty'

export type ToastLevel = 'success' | 'error'
export type ToastLevels = Record<ToastLevel, boolean>

export type AppSettings = {
  theme: AppTheme
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
  veloxyBaseUrl: string
  toastLevels: ToastLevels
}

const defaults: AppSettings = {
  theme: 'system',
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
