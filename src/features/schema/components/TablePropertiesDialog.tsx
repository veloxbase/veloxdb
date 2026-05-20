import { useMemo, useState } from 'react'
import { SpinnerGapIcon, CheckIcon } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { ColumnProperties, TableInfo } from '@/data/types'
import { useApplyTablePropertiesMutation, useTablePropertiesQuery } from '@/features/schema/queries'
import { cn } from '@/lib/utils'

type TablePropertiesDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  connectionId: string | undefined
  tablePropertyEditingSupported?: boolean
  table: TableInfo | null
}

type DraftColumn = {
  isNullable: boolean
  isUnique: boolean
}

function ToggleButton({
  checked,
  disabled,
  onClick,
}: {
  checked: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={cn(
        'flex items-center justify-center rounded-sm border p-1 transition disabled:opacity-50',
        checked
          ? 'border-[color:var(--control-accent)] bg-[color:var(--control-accent-muted)] text-[color:var(--control-accent)]'
          : 'border-border/80 bg-background/50 hover:bg-muted/30',
      )}
      disabled={disabled}
      aria-pressed={checked}
      onClick={onClick}
    >
      {checked ? (
        <CheckIcon className="size-3 shrink-0" weight="bold" aria-hidden />
      ) : (
        <span
          className="size-3 shrink-0 rounded-[2px] border border-[color:color-mix(in_oklab,var(--control-accent),var(--border)_78%)] bg-muted/15"
          aria-hidden
        />
      )}
    </button>
  )
}

function formatConstraintHint(column: ColumnProperties, t: (key: string) => string) {
  if (column.isPrimaryKey) return t("model.primaryKey")
  if (column.isPartOfCompositeUnique) return t("model.compositeUnique")
  return undefined
}

export function TablePropertiesDialog({
  open,
  onOpenChange,
  connectionId,
  tablePropertyEditingSupported = false,
  table,
}: TablePropertiesDialogProps) {
  const { t } = useTranslation()
  const propertiesQuery = useTablePropertiesQuery({
    connectionId,
    table,
    enabled: open && Boolean(connectionId && table),
  })
  const applyMutation = useApplyTablePropertiesMutation()

  const columns = propertiesQuery.data ?? []

  const tableKey = table ? `${table.schema}.${table.name}` : '__no_table__'
  const [overridesByTableKey, setOverridesByTableKey] = useState<
    Record<string, Record<string, DraftColumn>>
  >({})

  const draft = useMemo(() => {
    const base: Record<string, DraftColumn> = {}

    for (const col of propertiesQuery.data ?? []) {
      base[col.columnName] = { isNullable: col.isNullable, isUnique: col.isUnique }
    }

    const overrides = overridesByTableKey[tableKey] ?? {}
    return { ...base, ...overrides }
  }, [propertiesQuery.data, overridesByTableKey, tableKey])

  const targetTableLabel = table ? `${table.schema}.${table.name}` : '—'

  const isDirty = useMemo(() => {
    if (!propertiesQuery.data) return false
    return propertiesQuery.data.some((col) => {
      const d = draft[col.columnName]
      return d ? d.isNullable !== col.isNullable || d.isUnique !== col.isUnique : false
    })
  }, [propertiesQuery.data, draft])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl border border-border p-0 sm:max-w-3xl">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle>{t("table.tableProperties")}</DialogTitle>
          <DialogDescription>{t("table.tablePropertiesDesc")}</DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[70vh] flex-col overflow-hidden">
          <div className="px-5 py-3 text-xs text-muted-foreground">
            {t("table.editing")}: <span className="text-foreground">{targetTableLabel}</span>
          </div>
          {!tablePropertyEditingSupported ? (
            <div className="px-5 pb-3 text-xs text-amber-600">
              {t("table.tablePropertyEditingPostgresOnly")}
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-auto px-5 pb-5">
            {propertiesQuery.isLoading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
                <SpinnerGapIcon className="size-4 animate-spin" />
                {t("table.loadingProperties")}
              </div>
            ) : null}

            {propertiesQuery.isError ? (
              <div className="py-4 text-xs text-destructive">
                {propertiesQuery.error instanceof Error ? propertiesQuery.error.message : t("table.failedToLoadProperties")}
              </div>
            ) : null}

            {propertiesQuery.isSuccess && columns.length === 0 ? (
              <div className="py-4 text-xs text-muted-foreground">{t("table.noColumnsFound")}</div>
            ) : null}

            {propertiesQuery.isSuccess && columns.length > 0 ? (
              <div className="divide-y divide-border">
                {columns.map((col) => {
                  const d = draft[col.columnName] ?? {
                    isNullable: col.isNullable,
                    isUnique: col.isUnique,
                  }

                  const uniqueDisabled = col.isPrimaryKey || col.isPartOfCompositeUnique
                  const nullableDisabled = col.isPrimaryKey
                  const hint = formatConstraintHint(col, t)

                  return (
                    <div key={col.columnName} className="grid grid-cols-[1.4fr_1fr_auto_auto] items-center gap-3 py-3">
                      <div className="min-w-0">
                        <div className="truncate text-xs font-medium text-foreground">{col.columnName}</div>
                        <div className="truncate text-[11px] text-muted-foreground">{col.dataType}</div>
                      </div>

                      <div className="min-w-0 text-xs text-muted-foreground">
                        {hint ? <span className="rounded-sm border border-border/60 bg-muted/30 px-2 py-0.5">{hint}</span> : null}
                      </div>

                      <div className="flex items-center justify-end gap-2">
                        <span className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{t("model.nullable")}</span>
                        <ToggleButton
                          checked={d.isNullable}
                          disabled={nullableDisabled}
                          onClick={() =>
                            setOverridesByTableKey((current) => {
                              const prev = current[tableKey] ?? {}
                              const nextIsNullable = !d.isNullable
                              const next: DraftColumn = { isNullable: nextIsNullable, isUnique: d.isUnique }

                              const matchesServer =
                                next.isNullable === col.isNullable && next.isUnique === col.isUnique

                              if (matchesServer) {
                                const rest = { ...prev }
                                delete rest[col.columnName]
                                return { ...current, [tableKey]: rest }
                              }

                              return { ...current, [tableKey]: { ...prev, [col.columnName]: next } }
                            })
                          }
                        />
                      </div>

                      <div className="flex items-center justify-end gap-2">
                        <span className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{t("model.unique")}</span>
                        <ToggleButton
                          checked={d.isUnique}
                          disabled={uniqueDisabled}
                          onClick={() =>
                            setOverridesByTableKey((current) => {
                              const prev = current[tableKey] ?? {}
                              const nextIsUnique = !d.isUnique
                              const next: DraftColumn = { isNullable: d.isNullable, isUnique: nextIsUnique }

                              const matchesServer =
                                next.isNullable === col.isNullable && next.isUnique === col.isUnique

                              if (matchesServer) {
                                const rest = { ...prev }
                                delete rest[col.columnName]
                                return { ...current, [tableKey]: rest }
                              }

                              return { ...current, [tableKey]: { ...prev, [col.columnName]: next } }
                            })
                          }
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : null}
          </div>
        </div>

        <DialogFooter className="border-t border-border px-5 py-4">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={applyMutation.isPending}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={
              applyMutation.isPending ||
              !isDirty ||
              !table ||
              !connectionId ||
              !tablePropertyEditingSupported
            }
            onClick={async () => {
              if (!table || !connectionId) return

              const columnsUpdate = columns.map((col) => ({
                columnName: col.columnName,
                isNullable: draft[col.columnName]?.isNullable ?? col.isNullable,
                isUnique: draft[col.columnName]?.isUnique ?? col.isUnique,
              }))

              await applyMutation.mutateAsync({
                connectionId,
                tableSchema: table.schema,
                tableName: table.name,
                columns: columnsUpdate,
              })
              onOpenChange(false)
            }}
          >
            {applyMutation.isPending ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

