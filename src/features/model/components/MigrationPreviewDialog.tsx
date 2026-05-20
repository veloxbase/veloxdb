import {
  ArrowsClockwiseIcon,
  CubeIcon,
  FileSqlIcon,
  LinkSimpleIcon,
  PencilSimpleIcon,
  ShieldIcon,
  LightningIcon,
  LockKeyIcon,
  DownloadSimpleIcon,
} from '@phosphor-icons/react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { type MigrationSummary, buildMigrationSql } from '@/features/model/migration-preview'

type MigrationPreviewDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  summary: MigrationSummary | null
  onApply: () => void
  isApplying: boolean
}

const kindIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  add_column: CubeIcon,
  add_foreign_key: LinkSimpleIcon,
  rename_table: PencilSimpleIcon,
  column_identity_change: ArrowsClockwiseIcon,
  column_override: PencilSimpleIcon,
  rule: LightningIcon,
  trigger: ShieldIcon,
  rls_policy: LockKeyIcon,
}

export function MigrationPreviewDialog({
  open,
  onOpenChange,
  summary,
  onApply,
  isApplying,
}: MigrationPreviewDialogProps) {
  const { t } = useTranslation()
  const changes = summary?.changes ?? []
  const hasChanges = changes.length > 0

  const kindLabels: Record<string, string> = {
    add_column: t("model.addColumn"),
    add_foreign_key: t("model.foreignKey"),
    rename_table: t("model.renameTable"),
    column_identity_change: t("model.columnChange"),
    column_override: t("model.columnConstraint"),
    rule: t("model.rule"),
    trigger: t("model.trigger"),
    rls_policy: t("model.rlsPolicy"),
  }

  const handleDownloadSql = useCallback(() => {
    if (!summary) return
    const sql = buildMigrationSql(summary)
    const blob = new Blob([sql], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `migration_${new Date().toISOString().replace(/[:.]+/g, '-').slice(0, 19)}.sql`
    a.click()
    URL.revokeObjectURL(url)
  }, [summary])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl border-border p-0 sm:max-w-2xl">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle>{t("model.migrationPreview")}</DialogTitle>
          <DialogDescription>
            {hasChanges
              ? t("model.migrationChangesDesc", { changes: changes.length, statements: summary?.totalStatements ?? 0 })
              : t("model.noPendingChanges")}
          </DialogDescription>
        </DialogHeader>

        {!hasChanges ? (
          <div className="flex flex-col items-center gap-2 px-5 py-8 text-center text-xs text-muted-foreground">
            <FileSqlIcon className="size-8 opacity-30" />
            <p>{t("model.noPendingChangesDesc")}</p>
          </div>
        ) : (
          <div className="max-h-[50vh] overflow-y-auto divide-y divide-border">
            {changes.map((change, i) => {
              const Icon = kindIcons[change.kind] ?? CubeIcon
              const sqls = Array.isArray(change.sql) ? change.sql : [change.sql]
              return (
                <div key={`${change.kind}-${i}`} className="px-5 py-3">
                  <div className="flex items-start gap-2.5">
                    <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="text-xs font-medium">{change.description}</span>
                        <span className={cn(
                          'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium',
                          change.kind === 'add_foreign_key' && 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
                          change.kind === 'add_column' && 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
                          change.kind === 'rename_table' && 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
                          change.kind === 'column_identity_change' && 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
                          change.kind === 'column_override' && 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
                        )}>
                          {kindLabels[change.kind] ?? change.kind}
                        </span>
                      </div>
                      <div className="mt-2 space-y-1">
                        {sqls.filter((s) => s.trim()).map((sql, si) => (
                          <pre
                            key={si}
                            className="overflow-x-auto rounded bg-muted/60 px-2.5 py-1.5 text-[10px] leading-relaxed text-foreground/80 font-mono"
                          >
                            {sql}
                          </pre>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <DialogFooter className="border-t border-border px-5 py-3">
          {hasChanges && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={handleDownloadSql}
            >
              <DownloadSimpleIcon className="mr-1.5 size-3.5" aria-hidden />
              {t("model.downloadSql")}
            </Button>
          )}
          <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-8 text-xs"
            disabled={!hasChanges || isApplying}
            onClick={onApply}
          >
            {isApplying ? 'Applying...' : 'Apply Migration'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
