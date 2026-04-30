import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type AppTheme = 'system' | 'light' | 'dark'
export type FontSize = 'sm' | 'md' | 'lg'
export type NullDisplay = 'null' | 'NULL' | 'dash' | 'empty'

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
}

export const useSettings = create<AppSettings>()(
  persist(() => defaults, { name: 'veloxdb.settings' }),
)

export function resolveTheme(theme: AppTheme): 'light' | 'dark' {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return theme
}

export const fontSizeClasses: Record<FontSize, string> = {
  sm: 'text-[12px]',
  md: 'text-[14px]',
  lg: 'text-[16px]',
}
