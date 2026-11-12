import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { ConnectionSummary } from '@/data/types'
import { engineLabel } from '@/hooks/useAppState'

type DashboardConnectionPickerDialogProps = {
  open: boolean
  title: string
  description: string
  connections: ConnectionSummary[]
  onSelect: (connection: ConnectionSummary) => void
  onCancel: () => void
}

export function DashboardConnectionPickerDialog({
  open,
  title,
  description,
  connections,
  onSelect,
  onCancel,
}: DashboardConnectionPickerDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onCancel() }}>
      <DialogContent className="max-w-sm border border-border p-0">
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle>{title}</DialogTitle>
          <p className="text-sm text-muted-foreground">{description}</p>
        </DialogHeader>

        <div className="max-h-64 overflow-auto px-3 py-2">
          {connections.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">
              No SQL connections available. Add a connection first.
            </p>
          ) : (
            connections.map((conn) => (
              <button
                key={conn.id}
                type="button"
                className="flex w-full flex-col rounded-md px-3 py-2 text-left text-sm transition hover:bg-muted"
                onClick={() => onSelect(conn)}
              >
                <span className="font-medium">{conn.name}</span>
                <span className="text-xs text-muted-foreground">{engineLabel(conn.engine)}</span>
              </button>
            ))
          )}
        </div>

        <DialogFooter className="border-t border-border px-6 py-4">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
