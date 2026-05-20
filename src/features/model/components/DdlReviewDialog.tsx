import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { DatabaseEngine } from '@/data/types'
import { useExecuteDdlTransactionMutation } from '@/features/model/queries'

type DdlReviewDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  connectionId: string
  engine: DatabaseEngine
}

function splitStatements(sql: string): string[] {
  return sql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith('--'))
}

export function DdlReviewDialog({ open, onOpenChange, connectionId, engine }: DdlReviewDialogProps) {
  const { t } = useTranslation()
  const [text, setText] = useState(
    '-- Paste one or more SQL statements separated by semicolons.\n-- They run in a single transaction.\n',
  )
  const mutation = useExecuteDdlTransactionMutation()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl border border-border">
        <DialogHeader>
          <DialogTitle>{t("model.runDdlScript")}</DialogTitle>
          <DialogDescription>
            {engine === 'postgres'
              ? t("model.ddlPostgresDesc")
              : t("model.ddlEngineDesc", { engine })}
          </DialogDescription>
        </DialogHeader>

        <textarea
          className="min-h-[200px] w-full resize-y rounded-md border border-border bg-background px-3 py-2 font-mono text-xs"
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
        />

        {mutation.isError ? (
          <p className="text-xs text-destructive">
            {mutation.error instanceof Error ? mutation.error.message : t("model.executionFailed")}
          </p>
        ) : null}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={mutation.isPending}
            onClick={async () => {
              const statements = splitStatements(text)
              if (statements.length === 0) return
              await mutation.mutateAsync({ connectionId, statements })
              onOpenChange(false)
            }}
          >
            {mutation.isPending ? 'Running…' : 'Execute'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
