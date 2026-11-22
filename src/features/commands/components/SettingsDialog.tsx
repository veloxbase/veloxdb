import {
  TrashIcon,
  DownloadSimpleIcon,
  UploadSimpleIcon,
  PaintBrushIcon,
  CodeIcon,
  TableIcon,
  PlugIcon,
  DatabaseIcon,
  SparkleIcon,
  InfoIcon,
  ArrowSquareOutIcon,
  ArrowsClockwiseIcon,
  BellIcon,
  CaretDownIcon,
} from '@phosphor-icons/react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { saveOpenRouterApiKey } from '@/lib/openrouter-credentials'
import { fetchOpenRouterModels, OPENROUTER_POPULAR_MODELS, type OpenRouterModelOption } from '@/lib/openrouter-models'
import { cn } from '@/lib/utils'
import { useSettings, type AppTheme, type NullDisplay, themeLabels, resolveFontSizePx } from '@/lib/settings'
import { useUpdateCheck } from '@/hooks/useUpdateCheck'
import pkg from '../../../../package.json'

const GITHUB_REPO = 'abeni16/veloxdb'
const VELOXDB_SITE = 'https://veloxdb.dev'

const THEME_SWATCHES: Record<AppTheme, { bg: string; accent: string }> = {
  system: { bg: 'linear-gradient(135deg, #f5f5f5 50%, #18181b 50%)', accent: '#6366f1' },
  light:  { bg: '#ffffff', accent: '#18181b' },
  dark:   { bg: '#18181b', accent: '#e4e4e7' },
  sepia:  { bg: '#f6f0e4', accent: '#6b4f35' },
  ocean:  { bg: '#131c2b', accent: '#38bdf8' },
  forest: { bg: '#0f1c16', accent: '#34d399' },
  rose:   { bg: '#1e1419', accent: '#fb7185' },
  slate:  { bg: '#141923', accent: '#94a3b8' },
  amber:  { bg: '#1c1710', accent: '#f59e0b' },
}

const THEME_ORDER: AppTheme[] = ['system', 'light', 'dark', 'sepia', 'ocean', 'forest', 'rose', 'slate', 'amber']

export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const settings = useSettings()
  const { t, i18n } = useTranslation()

  const tabs = [
    { id: 'appearance', label: t("settings.appearance"), Icon: PaintBrushIcon },
    { id: 'editor', label: t("settings.editor"), Icon: CodeIcon },
    { id: 'results', label: t("settings.results"), Icon: TableIcon },
    { id: 'connections', label: t("settings.connections"), Icon: PlugIcon },
    { id: 'veloxy', label: t("settings.veloxy"), Icon: SparkleIcon },
    { id: 'notifications', label: t("settings.notifications"), Icon: BellIcon },
    { id: 'data', label: t("settings.data"), Icon: DatabaseIcon },
    { id: 'about', label: t("settings.about"), Icon: InfoIcon },
  ]

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ',') { e.preventDefault(); onOpenChange(true) }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onOpenChange])

  const [tab, setTab] = useState('appearance')

  const handleExport = useCallback(() => {
    const exportable = { ...useSettings.getState() }
    delete (exportable as Partial<typeof exportable>).veloxyOpenRouterApiKey
    const data = JSON.stringify(exportable, null, 2)
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'veloxdb-settings.json'; a.click()
    URL.revokeObjectURL(url)
  }, [])

  const handleImport = useCallback(() => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.json'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return
      const r = new FileReader()
      r.onload = () => { try { useSettings.setState(JSON.parse(r.result as string)) } catch { /* */ } }
      r.readAsText(file)
    }
    input.click()
  }, [])

  const [modelOptions, setModelOptions] = useState<OpenRouterModelOption[]>(OPENROUTER_POPULAR_MODELS)
  const [modelsStatus, setModelsStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [modelsError, setModelsError] = useState<string | null>(null)

  const { data: updateInfo, isLoading: isCheckingUpdates, isError: updateCheckFailed, refetch: checkForUpdates } = useUpdateCheck(
    { enabled: open },
  )

  const refreshOpenRouterModels = useCallback(async () => {
    setModelsStatus('loading')
    setModelsError(null)
    const { veloxyOpenRouterApiKey, veloxyBaseUrl } = useSettings.getState()
    try {
      const options = await fetchOpenRouterModels(
        veloxyOpenRouterApiKey,
        veloxyBaseUrl,
      )
      setModelOptions(options)
      setModelsStatus('idle')
    } catch (error) {
      setModelsStatus('error')
      setModelsError(error instanceof Error ? error.message : 'Failed to fetch models')
      setModelOptions(OPENROUTER_POPULAR_MODELS)
    }
  }, [])

  const selectSettingsTab = useCallback(
    (id: string) => {
      setTab(id)
      if (id === 'veloxy' && useSettings.getState().veloxyOpenRouterApiKey.trim()) {
        void refreshOpenRouterModels()
      }
    },
    [refreshOpenRouterModels],
  )

  const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)
  const shortcutLabel = isMac ? '⌘ ,' : 'Ctrl + ,'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden rounded-xl border border-border/80 bg-popover p-0 shadow-2xl sm:max-w-[740px]">
        <div className="flex items-center justify-between border-b border-border/70 bg-muted/20 px-5 py-3.5 pr-12">
          <div className="flex items-center gap-3">
            <DialogTitle className="text-sm font-semibold tracking-tight text-foreground">
              {t("settings.title")}
            </DialogTitle>
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <kbd className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground shadow-2xs">
                {shortcutLabel}
              </kbd>
            </span>
          </div>
        </div>

        <div className="flex h-[500px] max-h-[78vh]">
          <nav className="flex w-[196px] shrink-0 flex-col justify-between border-r border-border/70 bg-muted/15 p-2.5">
            <div className="space-y-0.5">
              {tabs.map(({ id, label, Icon }) => {
                const active = tab === id
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => selectSettingsTab(id)}
                    className={cn(
                      'flex w-full cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-left text-xs transition-colors',
                      active
                        ? 'bg-accent text-foreground font-medium shadow-2xs'
                        : 'text-muted-foreground hover:bg-accent/45 hover:text-foreground',
                    )}
                  >
                    <Icon
                      className={cn('size-4 shrink-0', active ? 'text-primary' : 'text-muted-foreground')}
                      weight={active ? 'fill' : 'regular'}
                    />
                    <span className="truncate">{label}</span>
                  </button>
                )
              })}
            </div>
            <div className="border-t border-border/50 px-3 pt-2.5 text-[11px] text-muted-foreground/70">
              VeloxDB v{pkg.version}
            </div>
          </nav>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {tab === 'appearance' && <Section title={t("settings.appearance")}>
              <Field label={t("settings.language")} desc={t("settings.languageDesc")}>
                <Select value={i18n.language} onChange={(v) => i18n.changeLanguage(v)}
                  opts={[{ v: 'en', l: 'English' }, { v: 'zh', l: '中文' }]} />
              </Field>
              <Field label={t("settings.theme")} desc={t("settings.themeDesc")} stacked>
                <ThemeGrid value={settings.theme} onChange={(v) => useSettings.setState({ theme: v })} />
              </Field>
              <Field label={t("settings.fontSize")} desc={t("settings.fontSizeDesc")}>
                <div className="flex items-center gap-2">
                  <div className="relative flex items-center">
                    <Input
                      type="number"
                      min={10}
                      max={32}
                      step={1}
                      value={resolveFontSizePx(settings.fontSize)}
                      onChange={(e) => {
                        const val = Number(e.target.value)
                        if (!Number.isNaN(val) && val > 0) {
                          useSettings.setState({ fontSize: Math.max(10, Math.min(32, val)) })
                        }
                      }}
                      className="h-8 w-[72px] rounded-md pr-6 text-right text-xs [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    <span className="pointer-events-none absolute right-2 select-none text-[11px] text-muted-foreground">
                      px
                    </span>
                  </div>
                  <div className="flex items-center overflow-hidden rounded-md border border-input bg-muted/20">
                    {[12, 14, 16, 18, 20].map((size) => {
                      const isActive = resolveFontSizePx(settings.fontSize) === size
                      return (
                        <button
                          key={size}
                          type="button"
                          onClick={() => useSettings.setState({ fontSize: size })}
                          className={cn(
                            'h-8 cursor-pointer px-2.5 text-xs transition-colors border-r border-input last:border-r-0',
                            isActive
                              ? 'bg-primary text-primary-foreground font-medium'
                              : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                          )}
                        >
                          {size}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </Field>
              <Field label={t("settings.monospaceFont")} desc={t("settings.monospaceFontDesc")}>
                <Input value={settings.monospaceFont} onChange={(e) => useSettings.setState({ monospaceFont: e.target.value })}
                  className="h-8 w-[240px] rounded-md font-mono text-[11px]" spellCheck={false} />
              </Field>
              <Field label={t("settings.borderRadius")} desc={t("settings.borderRadiusDesc")}>
                <div className="flex items-center overflow-hidden rounded-md border border-input bg-muted/20">
                  {[
                    { value: 0, label: '0px' },
                    { value: 4, label: '4px' },
                    { value: 8, label: '8px' },
                    { value: 12, label: '12px' },
                  ].map((opt) => {
                    const isActive = (settings.borderRadius ?? 0) === opt.value
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => useSettings.setState({ borderRadius: opt.value })}
                        className={cn(
                          'h-8 cursor-pointer border-r border-input px-2.5 text-xs transition-colors last:border-r-0',
                          isActive
                            ? 'bg-primary text-primary-foreground font-medium'
                            : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                        )}
                      >
                        {opt.label}
                      </button>
                    )
                  })}
                </div>
              </Field>
              <Field label={t("settings.windowOpacity")} desc={t("settings.windowOpacityDesc")}>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={40}
                    max={100}
                    step={1}
                    value={settings.windowOpacity ?? 100}
                    onChange={(e) => useSettings.setState({ windowOpacity: Number(e.target.value) })}
                    className="h-1.5 w-[140px] cursor-pointer accent-primary"
                  />
                  <span className="w-10 text-right font-mono text-xs text-muted-foreground">
                    {settings.windowOpacity ?? 100}%
                  </span>
                </div>
              </Field>
              <Field label={t("settings.backgroundBlur")} desc={t("settings.backgroundBlurDesc")}>
                <Toggle
                  value={settings.backgroundBlur ?? false}
                  onChange={(v) => {
                    if (v && (useSettings.getState().windowOpacity ?? 100) > 80) {
                      useSettings.setState({ backgroundBlur: true, windowOpacity: 72 })
                    } else {
                      useSettings.setState({ backgroundBlur: v })
                    }
                  }}
                />
              </Field>
            </Section>}

            {tab === 'editor' && <Section title={t("settings.editor")}>
              <Field label={t("settings.tabWidth")} desc={t("settings.tabWidthDesc")}>
                <Select value={String(settings.tabWidth)} onChange={(v) => useSettings.setState({ tabWidth: Number(v) })}
                  opts={[{ v: '2', l: '2 spaces' }, { v: '4', l: '4 spaces' }]} />
              </Field>
              <Field label={t("settings.lineNumbers")} desc={t("settings.lineNumbersDesc")}>
                <Toggle value={settings.showLineNumbers} onChange={(v) => useSettings.setState({ showLineNumbers: v })} />
              </Field>
              <Field label={t("settings.lintDebounce")} desc={t("settings.lintDebounceDesc")}>
                <Select value={String(settings.lintDebounceMs)} onChange={(v) => useSettings.setState({ lintDebounceMs: Number(v) })}
                  opts={[{ v: '100', l: '100 ms' }, { v: '280', l: '280 ms' }, { v: '500', l: '500 ms' }, { v: '800', l: '800 ms' }]} />
              </Field>
            </Section>}

            {tab === 'results' && <Section title={t("settings.results")}>
              <Field label={t("settings.maxRows")} desc={t("settings.maxRowsDesc")}>
                <Select value={String(settings.maxQueryRows)} onChange={(v) => useSettings.setState({ maxQueryRows: Number(v) })}
                  opts={[{ v: '500', l: '500' }, { v: '1000', l: '1,000' }, { v: '5000', l: '5,000' }, { v: '10000', l: '10,000' }]} />
              </Field>
              <Field label={t("settings.nullDisplay")} desc={t("settings.nullDisplayDesc")}>
                <Select value={settings.nullDisplay} onChange={(v) => useSettings.setState({ nullDisplay: v as NullDisplay })}
                  opts={[{ v: 'null', l: '(null)' }, { v: 'NULL', l: 'NULL' }, { v: 'dash', l: t("settings.dash") }, { v: 'empty', l: t("settings.empty") }]} />
              </Field>
              <Field label={t("settings.clickToCopy")} desc={t("settings.clickToCopyDesc")}>
                <Toggle value={settings.clickToCopy} onChange={(v) => useSettings.setState({ clickToCopy: v })} />
              </Field>
            </Section>}

            {tab === 'connections' && <Section title={t("settings.connections")}>
              <Field label={t("settings.autoReconnect")} desc={t("settings.autoReconnectDesc")}>
                <Toggle value={settings.autoReconnect} onChange={(v) => useSettings.setState({ autoReconnect: v })} />
              </Field>
              <Field label={t("settings.healthPing")} desc={t("settings.healthPingDesc")}>
                <Select value={String(settings.pingIntervalSec)} onChange={(v) => useSettings.setState({ pingIntervalSec: Number(v) })}
                  opts={[{ v: '0', l: t("settings.off") }, { v: '15', l: '15s' }, { v: '30', l: '30s' }, { v: '60', l: '1 min' }, { v: '120', l: '2 min' }]} />
              </Field>
            </Section>}

            {tab === 'veloxy' && <Section title={t("settings.veloxy")}>
              <Field label={t("settings.provider")} desc={t("settings.providerDesc")}>
                <span className="inline-flex h-8 items-center rounded-md border border-border bg-muted/40 px-3 text-xs font-medium text-foreground">
                  OpenRouter
                </span>
              </Field>
              <Field label={t("settings.openRouterApiKey")} desc={t("settings.openRouterApiKeyDesc")}>
                <Input
                  type="password"
                  value={settings.veloxyOpenRouterApiKey}
                  onChange={(e) => {
                    const value = e.target.value
                    void saveOpenRouterApiKey(value)
                    if (value.trim()) void refreshOpenRouterModels()
                  }}
                  className="h-8 w-[240px] rounded-md text-xs"
                  placeholder="sk-or-v1-..."
                  spellCheck={false}
                />
              </Field>
              <Field label={t("settings.baseUrl")} desc={t("settings.baseUrlDesc")}>
                <Input
                  value={settings.veloxyBaseUrl}
                  onChange={(e) => {
                    useSettings.setState({ veloxyBaseUrl: e.target.value })
                    if (useSettings.getState().veloxyOpenRouterApiKey.trim()) {
                      void refreshOpenRouterModels()
                    }
                  }}
                  className="h-8 w-[240px] rounded-md text-xs"
                  placeholder="https://openrouter.ai/api/v1"
                  spellCheck={false}
                />
              </Field>
              <Field label={t("settings.model")} desc={t("settings.modelDesc")}>
                <div className="flex items-center gap-2">
                  <Select
                    value={settings.veloxyModel}
                    onChange={(v) => useSettings.setState({ veloxyModel: v })}
                    className="w-[180px]"
                    opts={modelOptions.slice(0, 120).map((m) => ({
                      v: m.id,
                      l: m.source === 'popular' ? `${m.label} (popular)` : m.label,
                    }))}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-md text-xs"
                    onClick={() => void refreshOpenRouterModels()}
                    disabled={modelsStatus === 'loading'}
                  >
                    <ArrowsClockwiseIcon className={cn('mr-1 size-3.5', modelsStatus === 'loading' && 'animate-spin')} />
                    {t("settings.refreshModels")}
                  </Button>
                </div>
              </Field>
              {modelsError ? (
                <p className="pt-2 text-xs text-destructive">{modelsError}</p>
              ) : null}
            </Section>}

            {tab === 'notifications' && <Section title={t("settings.notifications")}>
              <Field label={t("settings.successToasts")} desc={t("settings.successToastsDesc")}>
                <Toggle
                  value={settings.toastLevels.success}
                  onChange={(v) => useSettings.setState({ toastLevels: { ...settings.toastLevels, success: v } })}
                />
              </Field>
              <Field label={t("settings.errorToasts")} desc={t("settings.errorToastsDesc")}>
                <Toggle
                  value={settings.toastLevels.error}
                  onChange={(v) => useSettings.setState({ toastLevels: { ...settings.toastLevels, error: v } })}
                />
              </Field>
              <Field label={t("settings.queryResultToasts")} desc={t("settings.queryResultToastsDesc")}>
                <Toggle
                  value={settings.showQueryResultToasts}
                  onChange={(v) => useSettings.setState({ showQueryResultToasts: v })}
                />
              </Field>
            </Section>}

            {tab === 'data' && <Section title={t("settings.data")}>
              <Field label={t("settings.exportSettings")} desc={t("settings.exportSettingsDesc")}>
                <Button variant="outline" size="sm" className="h-8 rounded-md text-xs" onClick={handleExport}>
                  <DownloadSimpleIcon className="mr-1.5 size-3.5" />{t("settings.exportSettings")}
                </Button>
              </Field>
              <Field label={t("settings.importSettings")} desc={t("settings.importSettingsDesc")}>
                <Button variant="outline" size="sm" className="h-8 rounded-md text-xs" onClick={handleImport}>
                  <UploadSimpleIcon className="mr-1.5 size-3.5" />{t("settings.importSettings")}
                </Button>
              </Field>
              <Field label={t("settings.clearHistory")} desc={t("settings.clearHistoryDesc")}>
                <Button variant="outline" size="sm" className="h-8 rounded-md border-destructive/40 text-xs text-destructive hover:bg-destructive/10" onClick={() => {
                  if (window.confirm(t("settings.clearHistoryConfirm"))) { localStorage.removeItem('veloxdb.queryWorkspace.v2'); localStorage.removeItem('veloxdb.queryFavorites'); window.location.reload() }
                }}>
                  <TrashIcon className="mr-1.5 size-3.5" />{t("settings.clearHistory")}
                </Button>
              </Field>
            </Section>}

            {tab === 'about' && <Section title={t("settings.about")}>
              <Field label={t("settings.version")} desc={`VeloxDB v${pkg.version}`}>
                <span className="inline-flex h-7 items-center rounded-md border border-border bg-muted/40 px-2.5 font-mono text-xs text-foreground">
                  v{pkg.version}
                </span>
              </Field>

              <Field label={t("settings.license")} desc={t("settings.licenseDesc")}>
                <span className="text-xs font-medium text-muted-foreground">MIT</span>
              </Field>

              <Field label={t("settings.website")} desc={t("settings.websiteDesc")}>
                <a
                  href={VELOXDB_SITE}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  veloxdb.dev
                  <ArrowSquareOutIcon className="size-3.5" />
                </a>
              </Field>

              <Field label={t("settings.github")} desc={t("settings.githubDesc")}>
                <a
                  href={`https://github.com/${GITHUB_REPO}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  github.com/abeni16/veloxdb
                  <ArrowSquareOutIcon className="size-3.5" />
                </a>
              </Field>

              <Field label={t("settings.support")} desc={t("settings.supportDesc")}>
                <iframe
                  src="https://github.com/sponsors/abeni16/button"
                  title="Sponsor abeni16"
                  height="32"
                  width="114"
                  style={{ border: 0, borderRadius: 6 }}
                />
              </Field>

              <Field label={t("settings.checkUpdates")} desc={t("settings.checkUpdatesDesc")}>
                <div className="flex items-center gap-2.5">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-md text-xs"
                    onClick={() => checkForUpdates()}
                    disabled={isCheckingUpdates}
                  >
                    {isCheckingUpdates ? t("settings.checking") : t("settings.checkNow")}
                  </Button>
                  {updateInfo && !updateInfo.hasUpdate && (
                    <span className="text-xs font-medium text-emerald-500">{t("settings.upToDate")}</span>
                  )}
                  {updateInfo?.hasUpdate && updateInfo.latestVersion && (
                    <a
                      href={updateInfo.downloadUrl || `https://github.com/${GITHUB_REPO}/releases/tag/v${updateInfo.latestVersion}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-medium text-amber-500 hover:underline"
                    >
                      {t("settings.available", { version: updateInfo.latestVersion })}
                      <ArrowSquareOutIcon className="size-3.5" />
                    </a>
                  )}
                  {updateCheckFailed && (
                    <span className="text-xs text-destructive">{t("settings.failedToCheck")}</span>
                  )}
                </div>
              </Field>
            </Section>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="px-6 py-5">
      <h3 className="border-b border-border/60 pb-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {title}
      </h3>
      <div className="divide-y divide-border/40">
        {children}
      </div>
    </div>
  )
}

function Field({
  label,
  desc,
  stacked = false,
  children,
}: {
  label: string
  desc?: string
  stacked?: boolean
  children: React.ReactNode
}) {
  if (stacked) {
    return (
      <div className="space-y-3 py-4 first:pt-3.5 last:pb-0">
        <div>
          <p className="text-[13px] font-medium text-foreground">{label}</p>
          {desc && <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{desc}</p>}
        </div>
        <div>{children}</div>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-between gap-6 py-4 first:pt-3.5 last:pb-0">
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-foreground">{label}</p>
        {desc && <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{desc}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function Select({
  value,
  onChange,
  opts,
  className,
}: {
  value: string
  onChange: (v: string) => void
  opts: { v: string; l: string }[]
  className?: string
}) {
  return (
    <div className={cn('relative w-[156px]', className)}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-full cursor-pointer appearance-none rounded-md border border-input bg-muted/20 pl-3 pr-8 text-xs text-foreground shadow-2xs transition-colors hover:bg-muted/40 focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
      >
        {opts.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
      <CaretDownIcon className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
    </div>
  )
}

function ThemeGrid({ value, onChange }: { value: AppTheme; onChange: (v: AppTheme) => void }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {THEME_ORDER.map((theme) => {
        const active = value === theme
        const swatch = THEME_SWATCHES[theme]
        return (
          <button
            key={theme}
            type="button"
            onClick={() => onChange(theme)}
            className={cn(
              'flex cursor-pointer items-center gap-2.5 rounded-md border px-2.5 py-2 text-left text-xs transition-colors',
              active
                ? 'border-primary bg-accent/70 font-medium text-foreground ring-1 ring-primary/30'
                : 'border-border/70 bg-muted/15 text-muted-foreground hover:border-border hover:bg-accent/35 hover:text-foreground',
            )}
          >
            <span
              className="relative size-4 shrink-0 rounded-full border border-foreground/20 shadow-2xs"
              style={{ background: swatch.bg }}
            >
              <span
                className="absolute right-0 bottom-0 size-1.5 rounded-full"
                style={{ backgroundColor: swatch.accent }}
              />
            </span>
            <span className="truncate">{themeLabels[theme]}</span>
          </button>
        )
      })}
    </div>
  )
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      onClick={() => onChange(!value)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        value ? 'bg-primary' : 'bg-muted-foreground/30',
      )}
    >
      <span
        className={cn(
          'pointer-events-none inline-block size-3.5 rounded-full bg-background shadow-sm transition-transform duration-150',
          value ? 'translate-x-4' : 'translate-x-0.5',
        )}
      />
    </button>
  )
}
