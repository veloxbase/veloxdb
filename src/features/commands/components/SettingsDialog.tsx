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
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

import { loadAiApiKey, saveAiApiKey } from '@/lib/ai-credentials'
import { AI_PROVIDERS, fetchProviderModels, getAiProvider, type AiModelOption, type AiProviderId } from '@/lib/ai-providers'
import { cn } from '@/lib/utils'
import { useSettings, isLocalAiEndpoint, type AppTheme, type ChartPaperStrength, type ChartPaperTint, type NullDisplay, themeLabels, resolveFontSizePx } from '@/lib/settings'
import { useAppHotkey } from '@/lib/shortcuts/use-app-hotkey'
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

  useAppHotkey('openSettings', () => {
    onOpenChange(true)
  })

  const [tab, setTab] = useState('appearance')

  const handleExport = useCallback(() => {
    const exportable = { ...useSettings.getState() } as Record<string, unknown>
    delete exportable.veloxyApiKey
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

  const [modelOptions, setModelOptions] = useState<AiModelOption[]>(() => getAiProvider(settings.veloxyProvider).models)
  const [modelsStatus, setModelsStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [modelsError, setModelsError] = useState<string | null>(null)

  const { data: updateInfo, isLoading: isCheckingUpdates, isError: updateCheckFailed, refetch: checkForUpdates } = useUpdateCheck(
    { enabled: open },
  )

  const refreshModels = useCallback(async () => {
    const { veloxyProvider, veloxyApiKey, veloxyBaseUrl } = useSettings.getState()
    const provider = getAiProvider(veloxyProvider)
    setModelOptions(provider.models)
    if (provider.requiresKey && !veloxyApiKey.trim()) {
      setModelsStatus('idle')
      setModelsError(null)
      return
    }
    setModelsStatus('loading')
    setModelsError(null)
    try {
      const options = await fetchProviderModels(veloxyProvider, veloxyApiKey, veloxyBaseUrl)
      if (useSettings.getState().veloxyProvider === veloxyProvider) setModelOptions(options)
      setModelsStatus('idle')
    } catch (error) {
      setModelsStatus('error')
      setModelsError(error instanceof Error ? error.message : 'Failed to fetch models')
    }
  }, [])

  const selectProvider = useCallback(async (id: AiProviderId) => {
    const provider = getAiProvider(id)
    const current = useSettings.getState()
    useSettings.setState({
      veloxyProvider: id,
      veloxyApiKey: '',
      // Keep a custom URL when switching to Custom; presets bring their own.
      veloxyBaseUrl: provider.baseUrl || (id === 'custom' ? current.veloxyBaseUrl : ''),
      veloxyModel: provider.models[0]?.id ?? '',
    })
    setModelOptions(provider.models)
    await loadAiApiKey()
    void refreshModels()
  }, [refreshModels])

  const selectSettingsTab = useCallback(
    (id: string) => {
      setTab(id)
      const st = useSettings.getState()
      if (id === 'veloxy' && (st.veloxyApiKey.trim() || isLocalAiEndpoint(st.veloxyBaseUrl))) {
        void refreshModels()
      }
    },
    [refreshModels],
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
              <Field label={t("settings.chartPaperTint")} desc={t("settings.chartPaperTintDesc")}>
                <Select
                  value={settings.chartPaperTint ?? 'auto'}
                  onChange={(v) => useSettings.setState({ chartPaperTint: v as ChartPaperTint })}
                  opts={[
                    { v: 'auto', l: t("settings.chartPaperTintAuto") },
                    { v: 'neutral', l: t("settings.chartPaperTintNeutral") },
                    { v: 'accent', l: t("settings.chartPaperTintAccent") },
                  ]}
                />
              </Field>
              <Field label={t("settings.chartPaperStrength")} desc={t("settings.chartPaperStrengthDesc")}>
                <Select
                  value={settings.chartPaperStrength ?? 'medium'}
                  onChange={(v) => useSettings.setState({ chartPaperStrength: v as ChartPaperStrength })}
                  opts={[
                    { v: 'off', l: t("settings.chartPaperStrengthOff") },
                    { v: 'soft', l: t("settings.chartPaperStrengthSoft") },
                    { v: 'medium', l: t("settings.chartPaperStrengthMedium") },
                  ]}
                />
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
                      className="h-8 w-[80px] text-xs pr-6 text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    <span className="absolute right-2 text-xs text-muted-foreground pointer-events-none select-none">
                      px
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    {[12, 14, 16, 18, 20].map((size) => {
                      const current = resolveFontSizePx(settings.fontSize)
                      const isActive = current === size
                      return (
                        <button
                          key={size}
                          type="button"
                          onClick={() => useSettings.setState({ fontSize: size })}
                          className={cn(
                            'h-8 px-2.5 text-xs transition-colors border border-input cursor-pointer',
                            isActive
                              ? 'bg-primary text-primary-foreground border-primary font-medium'
                              : 'bg-muted/30 text-muted-foreground hover:bg-accent hover:text-foreground',
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

            {tab === 'veloxy' && (() => {
              const provider = getAiProvider(settings.veloxyProvider)
              return <Section title={t("settings.veloxy")}>
                <Field label="AI provider" desc="Veloxy uses your own key. Pick a provider, or a model running on this machine.">
                  <select
                    value={provider.id}
                    onChange={(e) => { void selectProvider(e.target.value as AiProviderId) }}
                    className="h-8 w-[260px] rounded-md border border-input bg-background px-2.5 text-xs shadow-sm transition-colors focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    {AI_PROVIDERS.map((option) => (
                      <option key={option.id} value={option.id}>{option.label}</option>
                    ))}
                  </select>
                </Field>
                <Field
                  label={provider.requiresKey ? `${provider.label} API key` : 'API key (optional)'}
                  desc={provider.local
                    ? 'Not needed for a local server.'
                    : `Stored in your OS keychain.${provider.keyUrl ? ` Get one at ${provider.keyUrl}.` : ''}`}
                >
                  <Input
                    type="password"
                    value={settings.veloxyApiKey}
                    onChange={(e) => {
                      const value = e.target.value
                      void saveAiApiKey(provider.id, value)
                      if (value.trim() || !provider.requiresKey) void refreshModels()
                    }}
                    className="h-8 w-[260px] text-[11px]"
                    placeholder={provider.keyPlaceholder}
                    spellCheck={false}
                    autoComplete="off"
                  />
                </Field>
                <Field label={t("settings.baseUrl")} desc="OpenAI-compatible endpoint. Change it only for a proxy or self-hosted server.">
                  <Input
                    value={settings.veloxyBaseUrl}
                    onChange={(e) => useSettings.setState({ veloxyBaseUrl: e.target.value })}
                    onBlur={() => { void refreshModels() }}
                    className="h-8 w-[260px] text-[11px]"
                    placeholder={provider.baseUrl || 'https://your-server.example.com/v1'}
                    spellCheck={false}
                  />
                </Field>
                <Field label={t("settings.model")} desc="Pick a suggestion or type any model id the provider supports.">
                  <div className="flex items-center gap-2">
                    <Input
                      list="veloxy-model-options"
                      value={settings.veloxyModel}
                      onChange={(e) => useSettings.setState({ veloxyModel: e.target.value })}
                      className="h-8 w-[172px] text-[11px]"
                      placeholder={provider.models[0]?.id ?? 'model-id'}
                      spellCheck={false}
                    />
                    <datalist id="veloxy-model-options">
                      {modelOptions.map((m) => (
                        <option key={m.id} value={m.id}>{m.label}</option>
                      ))}
                    </datalist>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs"
                      onClick={() => void refreshModels()}
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
              </Section>
            })()}

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
