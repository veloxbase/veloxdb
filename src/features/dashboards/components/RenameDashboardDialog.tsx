import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { Dashboard } from '@/data/types'

type RenameDashboardDialogProps = {
  dashboard: Dashboard | null
  onConfirm: (dashboard: Dashboard, newName: string) => void
  onCancel: () => void
}

export function RenameDashboardDialog({ dashboard, onConfirm, onCancel }: RenameDashboardDialogProps) {
  const [name, setName] = useState(dashboard?.name ?? '')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (dashboard) inputRef.current?.select()
  }, [dashboard])

  const handleConfirm = () => {
    if (!dashboard || !name.trim()) return
    onConfirm(dashboard, name.trim())
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleConfirm()
    if (e.key === 'Escape') onCancel()
  }

  return (
    <Dialog open={!!dashboard} onOpenChange={(open) => { if (!open) onCancel() }}>
      <DialogContent className="max-w-sm border border-border p-0">
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle>Rename dashboard</DialogTitle>
        </DialogHeader>

        <div className="px-6 py-4">
          <label htmlFor="dashboard-name" className="mb-2 block text-sm text-muted-foreground">
            Dashboard name
          </label>
          <Input
            id="dashboard-name"
            ref={inputRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={handleKeyDown}
            autoComplete="off"
          />
        </div>

        <DialogFooter className="border-t border-border px-6 py-4">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!name.trim()}>
            Rename
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
