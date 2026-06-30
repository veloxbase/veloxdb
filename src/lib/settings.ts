import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type AppTheme = 'system' | 'light' | 'dark' | 'sepia' | 'ocean' | 'forest' | 'rose' | 'slate' | 'amber'
export type FontSize = 'sm' | 'md' | 'lg'
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
  fontSize: 'md',
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

export const useSettings = create<AppSettings>()(
  persist(() => defaults, {
    name: 'veloxdb.settings',
    // The OpenRouter API key is kept in the OS keychain, never in localStorage.
    partialize: ({ veloxyOpenRouterApiKey: _omitApiKey, ...rest }) => rest,
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

export const fontSizeClasses: Record<FontSize, string> = {
  sm: 'text-[12px]',
  md: 'text-[14px]',
  lg: 'text-[16px]',
}
