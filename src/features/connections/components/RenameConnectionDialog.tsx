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
import type { ConnectionSummary } from '@/data/types'

type RenameConnectionDialogProps = {
  connection: ConnectionSummary | null
  onConfirm: (connection: ConnectionSummary, newName: string) => void
  onCancel: () => void
}

export function RenameConnectionDialog(
  { connection, onConfirm, onCancel }: RenameConnectionDialogProps,
) {
  const [name, setName] = useState(connection?.name ?? '')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (connection) {
      inputRef.current?.select()
    }
  }, [connection])

  const handleConfirm = () => {
    if (!connection || !name.trim()) return
    onConfirm(connection, name.trim())
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleConfirm()
    if (e.key === 'Escape') onCancel()
  }

  return (
    <Dialog open={!!connection} onOpenChange={(open) => { if (!open) onCancel() }}>
      <DialogContent className="max-w-sm border border-border p-0">
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle>Rename connection</DialogTitle>
        </DialogHeader>

        <div className="px-6 py-4">
          <label htmlFor="connection-name" className="mb-2 block text-sm text-muted-foreground">
            Connection name
          </label>
          <Input
            id="connection-name"
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
