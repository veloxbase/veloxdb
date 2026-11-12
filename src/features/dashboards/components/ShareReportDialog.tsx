import {
  ArrowSquareOutIcon,
  ArrowsClockwiseIcon,
  CaretDownIcon,
  CaretRightIcon,
  CheckIcon,
  CopyIcon,
  FilePdfIcon,
  GlobeIcon,
  LockSimpleIcon,
  ShieldCheckIcon,
  TrashIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react'
import { useEffect, useMemo, useState } from 'react'
import { openUrl } from '@tauri-apps/plugin-opener'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { Dashboard } from '@/data/types'
import {
  compileAndPublishReport,
  generateReportPdf,
  revokePublishedReport,
  type PublishReportResponse,
} from '@/features/dashboards/reports/reports-client'
import { subscribeLiveAgent } from '@/features/auth/live-agent'

const EXPIRY_PRESETS = [
  { label: 'Never', value: undefined },
  { label: '24 hours', value: 24 },
  { label: '7 days', value: 168 },
  { label: '30 days', value: 720 },
] as const

type ShareReportDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  dashboard: Dashboard
  variableValues?: Record<string, string>
}

export function ShareReportDialog({
  open,
  onOpenChange,
  dashboard,
  variableValues = {},
}: ShareReportDialogProps) {
  // Advanced options state
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [title, setTitle] = useState(dashboard.name)
  const [slug, setSlug] = useState('')
  const [passcode, setPasscode] = useState('')
  const [requirePasscode, setRequirePasscode] = useState(false)
  const [expiresInHours, setExpiresInHours] = useState<number | undefined>(undefined)
  const [columnMasks, setColumnMasks] = useState<Record<string, string[]>>({})

  // Status & action state
  const [isPublishing, setIsPublishing] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)
  const [publishedReport, setPublishedReport] = useState<PublishReportResponse | null>(null)
  const [copied, setCopied] = useState(false)
  const [isRevoking, setIsRevoking] = useState(false)
  const [isPdfGenerating, setIsPdfGenerating] = useState(false)
  const [pdfSuccess, setPdfSuccess] = useState<string | null>(null)
  const [liveEnabled, setLiveEnabled] = useState(false)
  const [scheduleCadence, setScheduleCadence] = useState<'off' | '1h' | '6h' | 'daily'>('off')
  const [scheduleEmails, setScheduleEmails] = useState('')
  const [agentOnline, setAgentOnline] = useState(false)

  // Load existing shared state on dialog open
  useEffect(() => {
    if (open) {
      setTitle(dashboard.name)
      setPublishError(null)
      setPdfSuccess(null)
      try {
        const stored = localStorage.getItem(`veloxdb.shared_report.${dashboard.id}`)
        if (stored) {
          setPublishedReport(JSON.parse(stored) as PublishReportResponse)
        } else {
          setPublishedReport(null)
        }
      } catch {
        setPublishedReport(null)
      }
    }
  }, [open, dashboard.id, dashboard.name])

  useEffect(() => subscribeLiveAgent(setAgentOnline), [])

  const widgetsList = useMemo(() => {
    return Object.values(dashboard.widgets)
  }, [dashboard.widgets])

  const toggleColumnMask = (widgetId: string, col: string) => {
    setColumnMasks((prev) => {
      const existing = prev[widgetId] || []
      const updated = existing.includes(col)
        ? existing.filter((c) => c !== col)
        : [...existing, col]
      return { ...prev, [widgetId]: updated }
    })
  }

  const handlePublish = async () => {
    setIsPublishing(true)
    setPublishError(null)

    try {
      const response = await compileAndPublishReport({
        dashboardId: dashboard.id,
        title: title.trim() || dashboard.name,
        description: dashboard.description || undefined,
        slug: slug.trim() || undefined,
        passcode: requirePasscode && passcode.trim() ? passcode.trim() : undefined,
        expiresInHours,
        columnMasks,
        variableValues,
        liveEnabled,
        schedule: scheduleCadence === 'off' ? [] : [{
          id: `${dashboard.id}:republish:${scheduleCadence}`,
          kind: 'republish',
          cadence: scheduleCadence,
          emails: scheduleEmails.split(',').map((item) => item.trim()).filter(Boolean),
        }],
      })

      setPublishedReport(response)
      try {
        localStorage.setItem(`veloxdb.shared_report.${dashboard.id}`, JSON.stringify(response))
      } catch {
        // Storage failover
      }

      // Automatically copy to clipboard for maximum ease
      try {
        await navigator.clipboard.writeText(response.url)
        setCopied(true)
        setTimeout(() => setCopied(false), 2500)
      } catch {
        // Clipboard may be restricted in non-interactive callback
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      setPublishError(message)
    } finally {
      setIsPublishing(false)
    }
  }

  const handleCopy = () => {
    if (!publishedReport) return
    navigator.clipboard.writeText(publishedReport.url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleOpenBrowser = async () => {
    if (!publishedReport) return
    try {
      await openUrl(publishedReport.url)
    } catch {
      window.open(publishedReport.url, '_blank')
    }
  }

  const handleRevoke = async () => {
    if (!publishedReport) return
    if (!confirm('Unpublish this dashboard? The link will stop working immediately.')) {
      return
    }

    setIsRevoking(true)
    try {
      await revokePublishedReport(publishedReport.slug)
      localStorage.removeItem(`veloxdb.shared_report.${dashboard.id}`)
      setPublishedReport(null)
    } catch (err: unknown) {
      alert(`Failed to unpublish: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setIsRevoking(false)
    }
  }

  const handleDownloadPdf = async () => {
    setIsPdfGenerating(true)
    setPdfSuccess(null)

    try {
      const outputPath = `/tmp/${dashboard.name.toLowerCase().replace(/[^a-z0-9]/g, '-') || 'dashboard'}.pdf`
      const summaries = widgetsList.map((w) => ({
        id: w.id,
        title: w.title,
        kind: String(w.kind),
        columns: ['Metric', 'Value'],
        rows: [{ Metric: 'Status', Value: 'Active' }],
        content: undefined,
      }))

      await generateReportPdf({
        title: title.trim() || dashboard.name,
        description: dashboard.description || undefined,
        outputPath,
        widgets: summaries,
      })

      setPdfSuccess(`PDF saved to ${outputPath}`)
    } catch (err: unknown) {
      alert(`PDF export failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setIsPdfGenerating(false)
    }
  }

  const totalMaskedCols = Object.values(columnMasks).reduce((acc, cols) => acc + cols.length, 0)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border border-border p-6 shadow-2xl">
        <DialogHeader className="space-y-1 pb-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <GlobeIcon className="size-4" />
              </div>
              <DialogTitle className="text-sm font-semibold">Share Dashboard</DialogTitle>
            </div>
            {publishedReport ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-500 border border-emerald-500/20">
                <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Live on Web
              </span>
            ) : (
              <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                Private
              </span>
            )}
          </div>
          <DialogDescription className="text-xs text-muted-foreground">
            {publishedReport
              ? 'Anyone with this link can view an interactive, read-only report.'
              : 'Publish an interactive web report. No database credentials are ever shared.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {/* Main Sharing Box */}
          {publishedReport ? (
            /* Live Share View */
            <div className="space-y-3 rounded-xl border border-border bg-card p-3.5 shadow-xs">
              <div className="flex items-center gap-1.5">
                <Input
                  readOnly
                  value={publishedReport.url}
                  className="h-9 font-mono text-xs flex-1 bg-muted/30 select-all"
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <Button
                  size="sm"
                  variant={copied ? 'secondary' : 'default'}
                  className="h-9 gap-1.5 shrink-0 px-3.5 transition-all"
                  onClick={handleCopy}
                >
                  {copied ? <CheckIcon className="size-3.5 text-emerald-500" /> : <CopyIcon className="size-3.5" />}
                  <span>{copied ? 'Copied!' : 'Copy Link'}</span>
                </Button>
                <Button
                  size="icon-sm"
                  variant="outline"
                  className="h-9 w-9 shrink-0"
                  onClick={handleOpenBrowser}
                  title="Open report in browser"
                >
                  <ArrowSquareOutIcon className="size-4" />
                </Button>
              </div>

              <label className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
                <span>
                  <span className="block text-xs font-medium">Live while desktop is online</span>
                  <span className="block text-[11px] text-muted-foreground">{agentOnline ? 'Agent connected' : 'Desktop agent offline'}</span>
                </span>
                <input type="checkbox" checked={liveEnabled} onChange={(e) => setLiveEnabled(e.target.checked)} />
              </label>

              <div className="flex items-center justify-between pt-1 text-[11px] text-muted-foreground">
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs px-2 text-muted-foreground hover:text-foreground gap-1"
                    disabled={isPublishing}
                    onClick={handlePublish}
                    title="Re-run queries and update the live web snapshot"
                  >
                    <ArrowsClockwiseIcon className={`size-3.5 ${isPublishing ? 'animate-spin' : ''}`} />
                    <span>{isPublishing ? 'Updating...' : 'Update Data'}</span>
                  </Button>
                </div>

                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs px-2 text-destructive hover:text-destructive hover:bg-destructive/10 gap-1"
                  disabled={isRevoking}
                  onClick={handleRevoke}
                  title="Revoke and delete the public link"
                >
                  <TrashIcon className="size-3" />
                  <span>{isRevoking ? 'Unpublishing...' : 'Unpublish'}</span>
                </Button>
              </div>
            </div>
          ) : (
            /* Publish Prompt View */
            <div className="rounded-xl border border-dashed border-border bg-muted/20 p-5 text-center space-y-3">
              <div className="space-y-1">
                <p className="font-semibold text-xs text-foreground">
                  Ready to share &ldquo;{dashboard.name}&rdquo;?
                </p>
                <p className="text-[11px] text-muted-foreground max-w-xs mx-auto">
                  Compiles {widgetsList.length} widgets into a responsive web report with live charts and sortable tables.
                </p>
              </div>

              <label className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-left">
                <span>
                  <span className="block text-xs font-medium">Live while desktop is online</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {agentOnline ? 'Agent connected' : 'Open this app signed in to enable live filters'}
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={liveEnabled}
                  onChange={(e) => setLiveEnabled(e.target.checked)}
                />
              </label>
              {liveEnabled ? (
                <div className="grid gap-2 text-left">
                  <label className="text-[11px] text-muted-foreground">Scheduled refresh</label>
                  <select
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    value={scheduleCadence}
                    onChange={(e) => setScheduleCadence(e.target.value as typeof scheduleCadence)}
                  >
                    <option value="off">Off</option>
                    <option value="1h">Every hour</option>
                    <option value="6h">Every 6 hours</option>
                    <option value="daily">Daily</option>
                  </select>
                  <Input
                    value={scheduleEmails}
                    onChange={(e) => setScheduleEmails(e.target.value)}
                    placeholder="PDF emails, comma separated"
                    className="h-8 text-xs"
                  />
                </div>
              ) : null}

              <Button
                size="default"
                disabled={isPublishing}
                onClick={handlePublish}
                className="w-full h-9 text-xs font-semibold gap-2 shadow-sm"
              >
                <GlobeIcon className="size-4" />
                <span>{isPublishing ? 'Compiling in Rust & Publishing...' : 'Publish & Copy Link'}</span>
              </Button>
            </div>
          )}

          {publishError && (
            <div className="flex items-center gap-2 rounded-lg bg-destructive/10 p-2.5 text-xs text-destructive border border-destructive/20">
              <WarningCircleIcon className="size-4 shrink-0" />
              <span>{publishError}</span>
            </div>
          )}

          {pdfSuccess && (
            <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 p-2 text-xs text-emerald-500 border border-emerald-500/20">
              <CheckIcon className="size-3.5 shrink-0" />
              <span className="truncate">{pdfSuccess}</span>
            </div>
          )}

          {/* Progressive Disclosure: Settings & Security Accordion */}
          <div className="rounded-xl border border-border/80 bg-background overflow-hidden text-xs">
            <button
              type="button"
              onClick={() => setShowAdvanced((prev) => !prev)}
              className="w-full flex items-center justify-between p-3 text-left font-medium text-xs text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
            >
              <div className="flex items-center gap-2">
                {showAdvanced ? <CaretDownIcon className="size-3.5" /> : <CaretRightIcon className="size-3.5" />}
                <span>Security & Options</span>
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                {requirePasscode && (
                  <span className="bg-amber-500/10 text-amber-500 px-1.5 py-0.2 rounded border border-amber-500/20">
                    Passcode
                  </span>
                )}
                {totalMaskedCols > 0 && (
                  <span className="bg-destructive/10 text-destructive px-1.5 py-0.2 rounded border border-destructive/20">
                    {totalMaskedCols} Masked
                  </span>
                )}
                <span className="opacity-70">{showAdvanced ? 'Hide' : 'Customize'}</span>
              </div>
            </button>

            {showAdvanced && (
              <div className="p-3.5 pt-1 space-y-3.5 border-t border-border/60 bg-muted/10">
                {/* Passcode Toggle */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-1.5 font-medium text-xs cursor-pointer">
                      <LockSimpleIcon className="size-3.5 text-muted-foreground" />
                      <span>Require Passcode</span>
                    </label>
                    <input
                      type="checkbox"
                      checked={requirePasscode}
                      onChange={(e) => setRequirePasscode(e.target.checked)}
                      className="rounded border-border accent-primary cursor-pointer size-4"
                    />
                  </div>
                  {requirePasscode && (
                    <Input
                      type="password"
                      value={passcode}
                      onChange={(e) => setPasscode(e.target.value)}
                      placeholder="Enter access passcode"
                      className="h-8 text-xs bg-background"
                      autoFocus
                    />
                  )}
                </div>

                {/* Expiration Presets */}
                <div>
                  <label className="block text-[11px] font-medium text-muted-foreground mb-1.5">
                    Link Expiration
                  </label>
                  <div className="grid grid-cols-4 gap-1">
                    {EXPIRY_PRESETS.map((preset) => {
                      const isSelected = expiresInHours === preset.value
                      return (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() => setExpiresInHours(preset.value)}
                          className={`py-1 text-[11px] rounded-md font-medium border transition-colors ${
                            isSelected
                              ? 'bg-primary text-primary-foreground border-primary'
                              : 'bg-background text-muted-foreground border-border hover:text-foreground'
                          }`}
                        >
                          {preset.label}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Custom Vanity Slug */}
                <div>
                  <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                    Custom Vanity URL (Optional)
                  </label>
                  <div className="flex items-center rounded-md border border-input bg-background px-2.5 text-xs font-mono">
                    <span className="text-muted-foreground/60 select-none">/r/</span>
                    <input
                      type="text"
                      value={slug}
                      onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, '-'))}
                      placeholder="e.g. q3-performance"
                      className="h-7 w-full bg-transparent pl-0.5 focus:outline-none"
                    />
                  </div>
                </div>

                {/* Privacy & Column Redaction */}
                <div className="space-y-1.5 pt-1">
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-1.5 font-medium text-xs">
                      <ShieldCheckIcon className="size-3.5 text-muted-foreground" />
                      <span>Privacy Column Redaction</span>
                    </label>
                    <span className="text-[10px] text-muted-foreground">Native in-memory</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Click to permanently mask sensitive columns before data leaves your machine:
                  </p>
                  <div className="max-h-28 overflow-y-auto space-y-1.5 pt-0.5">
                    {widgetsList.map((w) => {
                      const masks = columnMasks[w.id] || []
                      return (
                        <div key={w.id} className="rounded border border-border/60 bg-background p-2">
                          <div className="text-[11px] font-medium mb-1 truncate">{w.title}</div>
                          <div className="flex flex-wrap gap-1">
                            {['email', 'salary', 'user_id', 'id', 'token', 'phone', 'ip'].map((col) => {
                              const isMasked = masks.includes(col)
                              return (
                                <button
                                  key={col}
                                  type="button"
                                  onClick={() => toggleColumnMask(w.id, col)}
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-mono border transition-colors ${
                                    isMasked
                                      ? 'bg-destructive/10 text-destructive border-destructive/40 font-semibold'
                                      : 'bg-muted/40 text-muted-foreground border-border hover:border-foreground/40'
                                  }`}
                                >
                                  {isMasked ? `✕ Masked: ${col}` : `+ ${col}`}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* PDF Export Action */}
                <div className="pt-2 border-t border-border/50 flex items-center justify-between">
                  <div className="text-[11px] text-muted-foreground">Offline vector report</div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1.5"
                    disabled={isPdfGenerating}
                    onClick={handleDownloadPdf}
                  >
                    <FilePdfIcon className="size-3.5" />
                    <span>{isPdfGenerating ? 'Compiling PDF...' : 'Download PDF (Rust)'}</span>
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="pt-2 border-t border-border">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
