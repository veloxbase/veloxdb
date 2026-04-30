import {
  TrashIcon,
  DownloadSimpleIcon,
  UploadSimpleIcon,
  PaintBrushIcon,
  CodeIcon,
  TableIcon,
  PlugIcon,
  DatabaseIcon,
} from '@phosphor-icons/react'
import { useCallback, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useSettings, type AppTheme, type FontSize, type NullDisplay } from '@/lib/settings'

const tabs = [
  { id: 'appearance', label: 'Appearance', Icon: PaintBrushIcon },
  { id: 'editor', label: 'Editor', Icon: CodeIcon },
  { id: 'results', label: 'Results', Icon: TableIcon },
  { id: 'connections', label: 'Connections', Icon: PlugIcon },
  { id: 'data', label: 'Data', Icon: DatabaseIcon },
]

export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const settings = useSettings()

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ',') { e.preventDefault(); onOpenChange(true) }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onOpenChange])

  const [tab, setTab] = useState('appearance')

  const handleExport = useCallback(() => {
    const data = JSON.stringify(useSettings.getState(), null, 2)
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden border-border p-0 sm:max-w-[580px]">
        {/* header */}
        <div className="border-b border-border px-5 py-3.5">
          <p className="text-sm font-medium text-foreground">Settings</p>
          <p className="text-xs text-muted-foreground">
            Press <kbd className="rounded border border-border bg-muted px-1 py-px text-[10px] font-mono">⌘,</kbd> anytime.
          </p>
        </div>

        {/* body */}
        <div className="flex min-h-[400px]">
          <div className="flex w-[150px] shrink-0 flex-col border-r border-border bg-muted/20 py-2">
            {tabs.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
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
            {tab === 'appearance' && <Section title="Appearance">
              <Field label="Theme" desc="Light, dark, or follow system preference.">
                <Select value={settings.theme} onChange={(v) => useSettings.setState({ theme: v as AppTheme })}
                  opts={[{ v: 'system', l: 'System' }, { v: 'light', l: 'Light' }, { v: 'dark', l: 'Dark' }]} />
              </Field>
              <Field label="Font size" desc="Base font size across the application.">
                <Select value={settings.fontSize} onChange={(v) => useSettings.setState({ fontSize: v as FontSize })}
                  opts={[{ v: 'sm', l: 'Small (12px)' }, { v: 'md', l: 'Medium (14px)' }, { v: 'lg', l: 'Large (16px)' }]} />
              </Field>
              <Field label="Monospace font" desc="Font family for the SQL editor.">
                <Input value={settings.monospaceFont} onChange={(e) => useSettings.setState({ monospaceFont: e.target.value })}
                  className="h-8 w-[240px] font-mono text-[11px]" spellCheck={false} />
              </Field>
            </Section>}

            {tab === 'editor' && <Section title="Editor">
              <Field label="Tab width" desc="Indentation in spaces.">
                <Select value={String(settings.tabWidth)} onChange={(v) => useSettings.setState({ tabWidth: Number(v) })}
                  opts={[{ v: '2', l: '2 spaces' }, { v: '4', l: '4 spaces' }]} />
              </Field>
              <Field label="Line numbers" desc="Show line numbers in the SQL editor.">
                <Toggle value={settings.showLineNumbers} onChange={(v) => useSettings.setState({ showLineNumbers: v })} />
              </Field>
              <Field label="Lint debounce" desc="Delay before checking SQL syntax.">
                <Select value={String(settings.lintDebounceMs)} onChange={(v) => useSettings.setState({ lintDebounceMs: Number(v) })}
                  opts={[{ v: '100', l: '100 ms' }, { v: '280', l: '280 ms' }, { v: '500', l: '500 ms' }, { v: '800', l: '800 ms' }]} />
              </Field>
            </Section>}

            {tab === 'results' && <Section title="Results">
              <Field label="Max rows" desc="Maximum rows returned per query.">
                <Select value={String(settings.maxQueryRows)} onChange={(v) => useSettings.setState({ maxQueryRows: Number(v) })}
                  opts={[{ v: '500', l: '500' }, { v: '1000', l: '1,000' }, { v: '5000', l: '5,000' }, { v: '10000', l: '10,000' }]} />
              </Field>
              <Field label="Null display" desc="How NULL values appear in results.">
                <Select value={settings.nullDisplay} onChange={(v) => useSettings.setState({ nullDisplay: v as NullDisplay })}
                  opts={[{ v: 'null', l: '(null)' }, { v: 'NULL', l: 'NULL' }, { v: 'dash', l: '— (dash)' }, { v: 'empty', l: 'Empty' }]} />
              </Field>
              <Field label="Click to copy" desc="Single-click a cell to copy its value.">
                <Toggle value={settings.clickToCopy} onChange={(v) => useSettings.setState({ clickToCopy: v })} />
              </Field>
            </Section>}

            {tab === 'connections' && <Section title="Connections">
              <Field label="Auto-reconnect" desc="Restore the last active connection on startup.">
                <Toggle value={settings.autoReconnect} onChange={(v) => useSettings.setState({ autoReconnect: v })} />
              </Field>
              <Field label="Health ping" desc="How often to check connection health.">
                <Select value={String(settings.pingIntervalSec)} onChange={(v) => useSettings.setState({ pingIntervalSec: Number(v) })}
                  opts={[{ v: '0', l: 'Off' }, { v: '15', l: '15s' }, { v: '30', l: '30s' }, { v: '60', l: '1 min' }, { v: '120', l: '2 min' }]} />
              </Field>
            </Section>}

            {tab === 'data' && <Section title="Data">
              <Field label="Export settings" desc="Download all settings as a JSON file.">
                <Button variant="outline" size="sm" className="h-8 text-xs" onClick={handleExport}>
                  <DownloadSimpleIcon className="mr-1.5 size-3.5" />Export JSON
                </Button>
              </Field>
              <Field label="Import settings" desc="Restore settings from a JSON file.">
                <Button variant="outline" size="sm" className="h-8 text-xs" onClick={handleImport}>
                  <UploadSimpleIcon className="mr-1.5 size-3.5" />Import JSON
                </Button>
              </Field>
              <Field label="Clear query history" desc="Remove all saved query history and favorites.">
                <Button variant="outline" size="sm" className="h-8 text-xs text-destructive hover:bg-destructive/10" onClick={() => {
                  if (window.confirm('Clear all query history?')) { localStorage.removeItem('veloxdb.queryWorkspace.v2'); localStorage.removeItem('veloxdb.queryFavorites'); window.location.reload() }
                }}>
                  <TrashIcon className="mr-1.5 size-3.5" />Clear history
                </Button>
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

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return <button type="button" role="switch" aria-checked={value} onClick={() => onChange(!value)} className={cn('relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-150', value ? 'bg-primary' : 'bg-muted-foreground/25')}><span className={cn('pointer-events-none inline-block size-3.5 rounded-full bg-background shadow-sm transition-transform duration-150', value ? 'translate-x-[18px]' : 'translate-x-[2px]')} /></button>
}
