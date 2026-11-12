import { CheckIcon, FilePdfIcon, WarningCircleIcon } from '@phosphor-icons/react'
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
import { generateReportPdf } from '@/features/dashboards/reports/reports-client'

type ExportReportDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  dashboard: Dashboard
}

function fileSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'dashboard'
}

/**
 * Exports a dashboard to a local file. Nothing leaves the machine. Mount it
 * only while open so each opening starts with fresh state.
 */
export function ExportReportDialog({ open, onOpenChange, dashboard }: ExportReportDialogProps) {
  const [title, setTitle] = useState(dashboard.name)
  const [isExporting, setIsExporting] = useState(false)
  const [savedPath, setSavedPath] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleExportPdf = async () => {
    setError(null)
    setSavedPath(null)
    const outputPath = await save({
      defaultPath: `${fileSlug(title || dashboard.name)}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    })
    if (!outputPath) return

    setIsExporting(true)
    try {
      // TODO(phase 3): send each widget's real query rows instead of this summary.
      const widgets = Object.values(dashboard.widgets).map((widget) => ({
        id: widget.id,
        title: widget.title,
        kind: String(widget.kind),
        columns: ['Metric', 'Value'],
        rows: [{ Metric: 'Status', Value: 'Active' }],
        content: undefined,
      }))
      await generateReportPdf({
        title: title.trim() || dashboard.name,
        description: dashboard.description || undefined,
        outputPath,
        widgets,
      })
      setSavedPath(outputPath)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border border-border p-6 shadow-2xl">
        <DialogHeader className="space-y-1 pb-1">
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <FilePdfIcon className="size-4" />
            </div>
            <DialogTitle className="text-sm font-semibold">Export Dashboard</DialogTitle>
          </div>
          <DialogDescription className="text-xs text-muted-foreground">
            Save a report of this dashboard to your computer. Nothing is uploaded.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 pt-1">
          <label className="block space-y-1">
            <span className="text-[11px] font-medium text-muted-foreground">Report title</span>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} className="h-8 text-xs" />
          </label>

          <Button
            className="w-full h-9 text-xs font-semibold gap-2"
            disabled={isExporting}
            onClick={() => { void handleExportPdf() }}
          >
            <FilePdfIcon className="size-4" />
            <span>{isExporting ? 'Exporting PDF…' : 'Export as PDF'}</span>
          </Button>

          {savedPath ? (
            <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 p-2 text-xs text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
              <CheckIcon className="size-3.5 shrink-0" />
              <span className="truncate">Saved to {savedPath}</span>
            </div>
          ) : null}
          {error ? (
            <div className="flex items-center gap-2 rounded-lg bg-destructive/10 p-2.5 text-xs text-destructive border border-destructive/20">
              <WarningCircleIcon className="size-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}
        </div>

        <DialogFooter className="pt-2 border-t border-border">
          <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
