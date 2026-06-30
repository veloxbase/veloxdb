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
} from '@phosphor-icons/react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { saveOpenRouterApiKey } from '@/lib/openrouter-credentials'
import { fetchOpenRouterModels, OPENROUTER_POPULAR_MODELS, type OpenRouterModelOption } from '@/lib/openrouter-models'
import { cn } from '@/lib/utils'
import { useSettings, type AppTheme, type FontSize, type NullDisplay, themeLabels } from '@/lib/settings'
import { useUpdateCheck } from '@/hooks/useUpdateCheck'
import pkg from '../../../../package.json'

const GITHUB_REPO = 'abeni16/veloxdb'
const VELOXDB_SITE = 'https://veloxdb.dev'

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
    const { veloxyOpenRouterApiKey: _omitApiKey, ...exportable } = useSettings.getState()
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden border-border p-0 sm:max-w-[580px]">
        {/* header */}
        <div className="border-b border-border px-5 py-3.5">
          <p className="text-sm font-medium text-foreground">{t("settings.title")}</p>
          <p className="text-xs text-muted-foreground">
            {t("settings.pressShortcut")}
          </p>
        </div>

        {/* body */}
        <div className="flex min-h-[400px]">
          <div className="flex w-[150px] shrink-0 flex-col border-r border-border bg-muted/20 py-2">
            {tabs.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => selectSettingsTab(id)}
                className={cn(
                  'flex items-center gap-2.5 px-4 py-2.5 text-left text-xs transition-colors',
                  tab === id
                    ? 'bg-accent text-accent-foreground font-medium border-r-2 border-r-primary -mr-px'
                    : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground',
                )}
              >
                <Icon className="size-4 shrink-0" weight={tab === id ? 'fill' : 'regular'} />
                {label}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            {tab === 'appearance' && <Section title={t("settings.appearance")}>
              <Field label={t("settings.language")} desc={t("settings.languageDesc")}>
                <Select value={i18n.language} onChange={(v) => i18n.changeLanguage(v)}
                  opts={[{ v: 'en', l: 'English' }, { v: 'zh', l: '中文' }]} />
              </Field>
              <Field label={t("settings.theme")} desc={t("settings.themeDesc")}>
                <ThemeSelect value={settings.theme} onChange={(v) => useSettings.setState({ theme: v as AppTheme })} />
              </Field>
              <Field label={t("settings.fontSize")} desc={t("settings.fontSizeDesc")}>
                <Select value={settings.fontSize} onChange={(v) => useSettings.setState({ fontSize: v as FontSize })}
                  opts={[{ v: 'sm', l: t("settings.small") }, { v: 'md', l: t("settings.medium") }, { v: 'lg', l: t("settings.large") }]} />
              </Field>
              <Field label={t("settings.monospaceFont")} desc={t("settings.monospaceFontDesc")}>
                <Input value={settings.monospaceFont} onChange={(e) => useSettings.setState({ monospaceFont: e.target.value })}
                  className="h-8 w-[240px] font-mono text-[11px]" spellCheck={false} />
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
                <span className="inline-flex items-center h-8 px-3 rounded-md border border-border bg-muted/50 text-xs text-foreground">
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
                  className="h-8 w-[260px] text-[11px]"
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
                  className="h-8 w-[260px] text-[11px]"
                  placeholder="https://openrouter.ai/api/v1"
                  spellCheck={false}
                />
              </Field>
              <Field label={t("settings.model")} desc={t("settings.modelDesc")}>
                <div className="flex items-center gap-2">
                  <Select
                    value={settings.veloxyModel}
                    onChange={(v) => useSettings.setState({ veloxyModel: v })}
                    opts={modelOptions.slice(0, 120).map((m) => ({
                      v: m.id,
                      l: m.source === 'popular' ? `${m.label} (popular)` : m.label,
                    }))}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => void refreshOpenRouterModels()}
                    disabled={modelsStatus === 'loading'}
                  >
                    <ArrowsClockwiseIcon className={cn('mr-1 size-3.5', modelsStatus === 'loading' && 'animate-spin')} />
                    {t("settings.refreshModels")}
                  </Button>
                </div>
              </Field>
              {modelsError ? (
                <p className="text-[11px] text-destructive">{modelsError}</p>
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
            </Section>}

            {tab === 'data' && <Section title={t("settings.data")}>
              <Field label={t("settings.exportSettings")} desc={t("settings.exportSettingsDesc")}>
                <Button variant="outline" size="sm" className="h-8 text-xs" onClick={handleExport}>
                  <DownloadSimpleIcon className="mr-1.5 size-3.5" />{t("settings.exportSettings")}
                </Button>
              </Field>
              <Field label={t("settings.importSettings")} desc={t("settings.importSettingsDesc")}>
                <Button variant="outline" size="sm" className="h-8 text-xs" onClick={handleImport}>
                  <UploadSimpleIcon className="mr-1.5 size-3.5" />{t("settings.importSettings")}
                </Button>
              </Field>
              <Field label={t("settings.clearHistory")} desc={t("settings.clearHistoryDesc")}>
                <Button variant="outline" size="sm" className="h-8 text-xs text-destructive hover:bg-destructive/10" onClick={() => {
                  if (window.confirm(t("settings.clearHistoryConfirm"))) { localStorage.removeItem('veloxdb.queryWorkspace.v2'); localStorage.removeItem('veloxdb.queryFavorites'); window.location.reload() }
                }}>
                  <TrashIcon className="mr-1.5 size-3.5" />{t("settings.clearHistory")}
                </Button>
              </Field>
            </Section>}

            {tab === 'about' && <Section title={t("settings.about")}>
              <Field label={t("settings.version")} desc={`VeloxDB v${pkg.version}`}>
                <span className="inline-flex items-center h-8 px-3 rounded-md border border-border bg-muted/50 text-xs font-mono text-foreground">
                  v{pkg.version}
                </span>
              </Field>

              <Field label={t("settings.license")} desc={t("settings.licenseDesc")}>
                <span className="text-xs text-muted-foreground">MIT</span>
              </Field>

              <Field label={t("settings.website")} desc={t("settings.websiteDesc")}>
                <a
                  href={VELOXDB_SITE}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  veloxdb.dev
                  <ArrowSquareOutIcon className="size-3" />
                </a>
              </Field>

              <Field label={t("settings.github")} desc={t("settings.githubDesc")}>
                <a
                  href={`https://github.com/${GITHUB_REPO}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  github.com/abeni16/veloxdb
                  <ArrowSquareOutIcon className="size-3" />
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
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => checkForUpdates()}
                    disabled={isCheckingUpdates}
                  >
                    {isCheckingUpdates ? t("settings.checking") : t("settings.checkNow")}
                  </Button>
                  {updateInfo && !updateInfo.hasUpdate && (
                    <span className="text-xs text-emerald-600">{t("settings.upToDate")}</span>
                  )}
                  {updateInfo?.hasUpdate && updateInfo.latestVersion && (
                    <a
                      href={updateInfo.downloadUrl || `https://github.com/${GITHUB_REPO}/releases/tag/v${updateInfo.latestVersion}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-amber-500 hover:underline"
                    >
                      {t("settings.available", { version: updateInfo.latestVersion })}
                      <ArrowSquareOutIcon className="size-3" />
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
  return <div className="p-5"><h3 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{title}</h3><div className="space-y-4">{children}</div></div>
}

function Field({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return <div className="flex items-start justify-between gap-4"><div className="min-w-0 pt-0.5"><p className="text-xs font-medium text-foreground">{label}</p>{desc && <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{desc}</p>}</div><div className="shrink-0">{children}</div></div>
}

function Select({ value, onChange, opts }: { value: string; onChange: (v: string) => void; opts: { v: string; l: string }[] }) {
  return <select value={value} onChange={(e) => onChange(e.target.value)} className="h-8 w-[140px] rounded-md border border-input bg-background px-2.5 text-xs shadow-sm transition-colors focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring">{opts.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}</select>
}

const THEME_ORDER: AppTheme[] = ['system', 'light', 'dark', 'sepia', 'ocean', 'forest', 'rose', 'slate', 'amber']

function ThemeSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 w-[140px] rounded-md border border-input bg-background px-2.5 text-xs shadow-sm transition-colors focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
    >
      {THEME_ORDER.map((theme) => (
        <option key={theme} value={theme}>{themeLabels[theme]}</option>
      ))}
    </select>
  )
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return <button type="button" role="switch" aria-checked={value} onClick={() => onChange(!value)} className={cn('relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-150', value ? 'bg-primary' : 'bg-muted-foreground/25')}><span className={cn('pointer-events-none inline-block size-3.5 rounded-full bg-background shadow-sm transition-transform duration-150', value ? 'translate-x-[18px]' : 'translate-x-[2px]')} /></button>
}
