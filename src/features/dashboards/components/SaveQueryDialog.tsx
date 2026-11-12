import { useEffect, useState } from 'react'

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
import { Textarea } from '@/components/ui/textarea'
import { useSaveSavedQueryMutation } from '@/features/dashboards/queries'
import { notifyError, notifySuccess } from '@/lib/error-notifier'

type SaveQueryDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  sql: string
  connectionId: string | null
}

export function SaveQueryDialog({ open, onOpenChange, sql, connectionId }: SaveQueryDialogProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  useEffect(() => {
    if (!open) return
    setName('')
    setDescription('')
  }, [open])

  const saveMutation = useSaveSavedQueryMutation({
    onSuccess: () => {
      notifySuccess('Query saved')
      onOpenChange(false)
    },
    onError: (error) => notifyError(error, { title: 'Failed to save query' }),
  })

  const trimmedName = name.trim()
  const trimmedSql = sql.trim()
  const canSave = Boolean(connectionId && trimmedName && trimmedSql && !saveMutation.isPending)
  const blockedReason = !connectionId
    ? 'Connect to a database to save this query.'
    : !trimmedSql
      ? 'The editor has no SQL to save.'
      : !trimmedName
        ? 'Enter a name for this query.'
        : null

  const handleConfirm = () => {
    if (!connectionId || !trimmedName || !trimmedSql) return
    saveMutation.mutate({
      name: trimmedName,
      description: description.trim() || undefined,
      connectionId,
      sql,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border border-border p-0">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            handleConfirm()
          }}
        >
          <DialogHeader className="border-b border-border px-6 py-4">
            <DialogTitle>Save query</DialogTitle>
            <DialogDescription>
              Saved queries can be reused as dashboard widget data sources.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3 px-6 py-4">
            <div>
              <label htmlFor="saved-query-name" className="mb-1.5 block text-xs text-muted-foreground">
                Name
              </label>
              <Input
                id="saved-query-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                autoComplete="off"
              />
            </div>
            <div>
              <label htmlFor="saved-query-description" className="mb-1.5 block text-xs text-muted-foreground">
                Description (optional)
              </label>
              <Textarea
                id="saved-query-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
              />
            </div>
            <pre className="max-h-32 overflow-auto border border-border bg-muted/30 p-2 text-[11px] whitespace-pre-wrap text-muted-foreground">
              {trimmedSql || 'No SQL in the focused tab.'}
            </pre>
            {blockedReason ? (
              <p className="text-[11px] text-amber-700 dark:text-amber-400">{blockedReason}</p>
            ) : null}
          </div>

          <DialogFooter className="border-t border-border px-6 py-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSave}>
              {saveMutation.isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
