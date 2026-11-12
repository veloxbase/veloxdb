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
  BellIcon,
} from '@phosphor-icons/react'
import { useCallback, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

import { cn } from '@/lib/utils'
import { useSettings, type AppTheme, type ChartPaperStrength, type ChartPaperTint, type NullDisplay, themeLabels, resolveFontSizePx } from '@/lib/settings'
import { getShortcutDisplay } from '@/lib/shortcuts/registry'
import { useAppHotkey } from '@/lib/shortcuts/use-app-hotkey'
import { useUpdateCheck } from '@/hooks/useUpdateCheck'
import pkg from '../../../../package.json'
import { openExternal } from '@/lib/open-external'

import { SettingsGroup, SettingsPage, SettingsRow, SettingsToggle, settingsSelectClass } from './settings-layout'
import { VeloxySettingsPanel } from './VeloxySettingsPanel'

const GITHUB_REPO = 'abeni16/veloxdb'
const VELOXDB_SITE = 'https://veloxdb.dev'

export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const settings = useSettings()
  const { t, i18n } = useTranslation()

  // Grouped by what they affect; groups are separated by space, not labels.
  const tabGroups = [
    [
      { id: 'appearance', label: t("settings.appearance"), Icon: PaintBrushIcon },
      { id: 'editor', label: t("settings.editor"), Icon: CodeIcon },
      { id: 'results', label: t("settings.results"), Icon: TableIcon },
    ],
    [
      { id: 'connections', label: t("settings.connections"), Icon: PlugIcon },
      { id: 'veloxy', label: 'Veloxy AI', Icon: SparkleIcon },
    ],
    [
      { id: 'notifications', label: t("settings.notifications"), Icon: BellIcon },
      { id: 'data', label: t("settings.data"), Icon: DatabaseIcon },
      { id: 'about', label: t("settings.about"), Icon: InfoIcon },
    ],
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

  const { data: updateInfo, isLoading: isCheckingUpdates, isError: updateCheckFailed, refetch: checkForUpdates } = useUpdateCheck(
    { enabled: open },
  )

  const selectSettingsTab = setTab

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="flex h-[min(660px,88vh)] gap-0 overflow-hidden border-border p-0 sm:max-w-[880px]"
      >
        <DialogTitle className="sr-only">{t("settings.title")}</DialogTitle>
        <nav className="flex w-[200px] shrink-0 flex-col border-r border-border bg-muted/25">
          <p className="px-5 pt-5 pb-3 text-sm font-semibold tracking-tight text-foreground">{t("settings.title")}</p>
          <div className="flex-1 space-y-4 overflow-y-auto px-2.5 pb-3">
            {tabGroups.map((group, index) => (
              <div key={index} className="space-y-0.5">
                {group.map(({ id, label, Icon }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => selectSettingsTab(id)}
                    aria-current={tab === id ? 'page' : undefined}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      tab === id
                        ? 'bg-background font-medium text-foreground shadow-xs ring-1 ring-border'
                        : 'text-muted-foreground hover:bg-background/60 hover:text-foreground',
                    )}
                  >
                    <Icon className={cn('size-4 shrink-0', tab === id && 'text-primary')} weight={tab === id ? 'fill' : 'regular'} />
                    {label}
                  </button>
                ))}
              </div>
            ))}
          </div>
          <div className="border-t border-border px-5 py-3 text-[11px] leading-relaxed text-muted-foreground">
            <p>VeloxDB {pkg.version}</p>
            <p>
              <Trans
                i18nKey="settings.pressShortcut"
                values={{ shortcut: getShortcutDisplay('openSettings') }}
                components={{ kbd: <kbd className="rounded border border-border bg-background px-1 font-mono text-[10px] text-foreground" /> }}
              />
            </p>
          </div>
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto">
            {tab === 'appearance' && <Section title={t("settings.appearance")} description={t("settings.pageDesc.appearance")}>
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

            {tab === 'editor' && <Section title={t("settings.editor")} description={t("settings.pageDesc.editor")}>
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

            {tab === 'results' && <Section title={t("settings.results")} description={t("settings.pageDesc.results")}>
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

            {tab === 'connections' && <Section title={t("settings.connections")} description={t("settings.pageDesc.connections")}>
              <Field label={t("settings.autoReconnect")} desc={t("settings.autoReconnectDesc")}>
                <Toggle value={settings.autoReconnect} onChange={(v) => useSettings.setState({ autoReconnect: v })} />
              </Field>
              <Field label={t("settings.healthPing")} desc={t("settings.healthPingDesc")}>
                <Select value={String(settings.pingIntervalSec)} onChange={(v) => useSettings.setState({ pingIntervalSec: Number(v) })}
                  opts={[{ v: '0', l: t("settings.off") }, { v: '15', l: '15s' }, { v: '30', l: '30s' }, { v: '60', l: '1 min' }, { v: '120', l: '2 min' }]} />
              </Field>
            </Section>}

            {tab === 'veloxy' && <VeloxySettingsPanel />}

            {tab === 'notifications' && <Section title={t("settings.notifications")} description={t("settings.pageDesc.notifications")}>
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

            {tab === 'data' && <Section title={t("settings.data")} description={t("settings.pageDesc.data")}>
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

            {tab === 'about' && <Section title={t("settings.about")} description={t("settings.pageDesc.about")}>
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
                  onClick={(e) => { e.preventDefault(); void openExternal(e.currentTarget.href) }}
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  veloxdb.dev
                  <ArrowSquareOutIcon className="size-3" />
                </a>
              </Field>

              <Field label={t("settings.github")} desc={t("settings.githubDesc")}>
                <a
                  href={`https://github.com/${GITHUB_REPO}`}
                  onClick={(e) => { e.preventDefault(); void openExternal(e.currentTarget.href) }}
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
                      onClick={(e) => { e.preventDefault(); void openExternal(e.currentTarget.href) }}
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
      </DialogContent>
    </Dialog>
  )
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <SettingsPage title={title} description={description}>
      <SettingsGroup>{children}</SettingsGroup>
    </SettingsPage>
  )
}

function Field({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return <SettingsRow label={label} description={desc}>{children}</SettingsRow>
}

function Select({ value, onChange, opts }: { value: string; onChange: (v: string) => void; opts: { v: string; l: string }[] }) {
  return <select value={value} onChange={(e) => onChange(e.target.value)} className={settingsSelectClass}>{opts.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}</select>
}

const THEME_ORDER: AppTheme[] = ['system', 'light', 'dark', 'sepia', 'ocean', 'forest', 'rose', 'slate', 'amber']

function ThemeSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={settingsSelectClass}
    >
      {THEME_ORDER.map((theme) => (
        <option key={theme} value={theme}>{themeLabels[theme]}</option>
      ))}
    </select>
  )
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return <SettingsToggle value={value} onChange={onChange} />
}
