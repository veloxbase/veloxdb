import { CheckIcon, FilePdfIcon, ImageIcon, WarningCircleIcon } from '@phosphor-icons/react'
import { save } from '@tauri-apps/plugin-dialog'
import { useState } from 'react'

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
  captureDashboardSnapshot,
  exportDashboardPdf,
  saveDashboardPng,
} from '@/features/dashboards/reports/reports-client'

type ExportReportDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  dashboard: Dashboard
}

type ExportKind = 'pdf' | 'png'

function fileSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'dashboard'
}

/**
 * Exports the dashboard exactly as it looks on screen, as a PDF or PNG on this
 * computer. Nothing is uploaded. Mount it only while open so each opening
 * starts with fresh state.
 */
export function ExportReportDialog({ open, onOpenChange, dashboard }: ExportReportDialogProps) {
  const [title, setTitle] = useState(dashboard.name)
  const [busy, setBusy] = useState<ExportKind | null>(null)
  const [savedPath, setSavedPath] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleExport = async (kind: ExportKind) => {
    setError(null)
    setSavedPath(null)
    const reportTitle = title.trim() || dashboard.name
    const outputPath = await save({
      defaultPath: `${fileSlug(reportTitle)}.${kind}`,
      filters: kind === 'pdf'
        ? [{ name: 'PDF', extensions: ['pdf'] }]
        : [{ name: 'PNG image', extensions: ['png'] }],
    })
    if (!outputPath) return

    setBusy(kind)
    try {
      if (kind === 'pdf') {
        const snapshot = await captureDashboardSnapshot(dashboard.id, 'jpeg')
        await exportDashboardPdf({
          title: reportTitle,
          description: dashboard.description || undefined,
          outputPath,
          snapshot,
        })
      } else {
        const snapshot = await captureDashboardSnapshot(dashboard.id, 'png')
        await saveDashboardPng(snapshot, outputPath)
      }
      setSavedPath(outputPath)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-5 p-6 sm:max-w-md">
        <DialogHeader className="min-w-0 space-y-1.5">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <FilePdfIcon className="size-4" />
            </div>
            <DialogTitle className="text-sm font-semibold">Export dashboard</DialogTitle>
          </div>
          <DialogDescription className="text-xs leading-relaxed text-muted-foreground">
            Saves the dashboard as it looks right now. Files stay on your computer.
          </DialogDescription>
        </DialogHeader>

        <div className="min-w-0 space-y-4">
          <label className="block min-w-0 space-y-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">Report title</span>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} className="h-9 w-full text-xs" />
          </label>

          <div className="grid min-w-0 grid-cols-2 gap-2">
            <Button
              className="h-9 gap-2 text-xs font-semibold"
              disabled={busy !== null}
              onClick={() => { void handleExport('pdf') }}
            >
              <FilePdfIcon className="size-4" />
              {busy === 'pdf' ? 'Exporting…' : 'Export PDF'}
            </Button>
            <Button
              variant="outline"
              className="h-9 gap-2 text-xs"
              disabled={busy !== null}
              onClick={() => { void handleExport('png') }}
            >
              <ImageIcon className="size-4" />
              {busy === 'png' ? 'Saving…' : 'Save PNG'}
            </Button>
          </div>

          {savedPath ? (
            <div className="flex min-w-0 items-start gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/10 p-2.5 text-xs text-emerald-600 dark:text-emerald-400">
              <CheckIcon className="mt-0.5 size-3.5 shrink-0" />
              <span className="min-w-0 break-all">Saved to {savedPath}</span>
            </div>
          ) : null}
          {error ? (
            <div className="flex min-w-0 items-start gap-2 rounded-md border border-destructive/20 bg-destructive/10 p-2.5 text-xs text-destructive">
              <WarningCircleIcon className="mt-0.5 size-4 shrink-0" />
              <span className="min-w-0 break-words">{error}</span>
            </div>
          ) : null}
        </div>

        <DialogFooter className="border-t border-border pt-3">
          <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
