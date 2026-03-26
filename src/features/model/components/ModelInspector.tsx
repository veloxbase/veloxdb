import { useMemo } from 'react'
import { SpinnerGapIcon, CheckIcon } from '@phosphor-icons/react'

import { Input } from '@/components/ui/input'
import type { ColumnProperties, TableInfo } from '@/data/types'
import type { ColumnOverride, TableIdentityDraft } from '@/features/model/apply-entire-model'
import { useTablePropertiesQuery } from '@/features/schema/queries'
import type { TableKey } from '@/features/model/model-types'

type ModelInspectorProps = {
  connectionId: string
  table: TableInfo | null
  tableKeyStr: TableKey | null
  identityDraft: TableIdentityDraft | null
  onIdentityDraftChange: (next: TableIdentityDraft) => void
  columnOverrides: Record<string, ColumnOverride>
  onColumnOverridesChange: (next: Record<string, ColumnOverride>) => void
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
      className="flex items-center justify-center rounded-sm border border-border/80 bg-background/50 p-1 transition hover:bg-muted/30 disabled:opacity-50"
      disabled={disabled}
      aria-pressed={checked}
      onClick={onClick}
    >
      {checked ? <CheckIcon className="size-3" /> : <span className="size-3 rounded-[2px] border border-border/80" />}
    </button>
  )
}

function formatConstraintHint(column: ColumnProperties) {
  if (column.isPrimaryKey) return 'Primary key'
  if (column.isPartOfCompositeUnique) return 'Composite UNIQUE'
  return undefined
}

export function ModelInspector({
  connectionId,
  table,
  tableKeyStr,
  identityDraft,
  onIdentityDraftChange,
  columnOverrides,
  onColumnOverridesChange,
}: ModelInspectorProps) {
  const propertiesQuery = useTablePropertiesQuery({
    connectionId,
    table,
    enabled: Boolean(connectionId && table),
  })

  const columns = propertiesQuery.data ?? []
  const tk = tableKeyStr ?? '__none__'

  const draft = useMemo(() => {
    const base: Record<string, ColumnOverride> = {}
    for (const col of propertiesQuery.data ?? []) {
      base[col.columnName] = { isNullable: col.isNullable, isUnique: col.isUnique }
    }
    return { ...base, ...columnOverrides }
  }, [propertiesQuery.data, columnOverrides])

  if (!table || !identityDraft) {
    return (
      <div className="flex h-full items-center justify-center border-l border-border bg-muted/10 p-4 text-center text-xs text-muted-foreground">
        Select a table on the diagram or in the catalog to edit properties.
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 min-w-[280px] max-w-[380px] flex-col border-l border-border bg-background/50">
      <div className="shrink-0 space-y-2 border-b border-border px-3 py-2">
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Inspector</p>
        <p className="text-[10px] text-muted-foreground">Catalog id: {tk}</p>

        <div className="space-y-1.5">
          <label className="text-[10px] font-medium text-muted-foreground" htmlFor="model-inspector-schema">
            Schema
          </label>
          <Input
            id="model-inspector-schema"
            className="h-8 text-xs"
            value={identityDraft.schema}
            onChange={(e) => onIdentityDraftChange({ ...identityDraft, schema: e.target.value })}
            spellCheck={false}
            autoComplete="off"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] font-medium text-muted-foreground" htmlFor="model-inspector-table">
            Table name
          </label>
          <Input
            id="model-inspector-table"
            className="h-8 text-xs"
            value={identityDraft.name}
            onChange={(e) => onIdentityDraftChange({ ...identityDraft, name: e.target.value })}
            spellCheck={false}
            autoComplete="off"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
        {propertiesQuery.isLoading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
            <SpinnerGapIcon className="size-4 animate-spin" />
            Loading columns…
          </div>
        ) : null}

        {propertiesQuery.isError ? (
          <div className="py-3 text-xs text-destructive">
            {propertiesQuery.error instanceof Error ? propertiesQuery.error.message : 'Failed to load'}
          </div>
        ) : null}

        {propertiesQuery.isSuccess && columns.length === 0 ? (
          <div className="py-3 text-xs text-muted-foreground">No columns.</div>
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
              const hint = formatConstraintHint(col)

              const patchOverride = (next: ColumnOverride) => {
                const matchesServer =
                  next.isNullable === col.isNullable && next.isUnique === col.isUnique
                onColumnOverridesChange((() => {
                  const prev = { ...columnOverrides }
                  if (matchesServer) {
                    delete prev[col.columnName]
                  } else {
                    prev[col.columnName] = next
                  }
                  return prev
                })())
              }

              return (
                <div
                  key={col.columnName}
                  className="grid grid-cols-1 gap-2 py-3 sm:grid-cols-[1fr_auto_auto] sm:items-center"
                >
                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium">{col.columnName}</div>
                    <div className="truncate text-[11px] text-muted-foreground">{col.dataType}</div>
                    {hint ? <div className="mt-1 text-[10px] text-muted-foreground">{hint}</div> : null}
                  </div>

                  <div className="flex items-center justify-end gap-2">
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Null</span>
                    <ToggleButton
                      checked={d.isNullable}
                      disabled={nullableDisabled}
                      onClick={() =>
                        patchOverride({ isNullable: !d.isNullable, isUnique: d.isUnique })
                      }
                    />
                  </div>

                  <div className="flex items-center justify-end gap-2">
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Unique</span>
                    <ToggleButton
                      checked={d.isUnique}
                      disabled={uniqueDisabled}
                      onClick={() =>
                        patchOverride({ isNullable: d.isNullable, isUnique: !d.isUnique })
                      }
                    />
                  </div>
                </div>
              )
            })}
          </div>
        ) : null}
      </div>

      <div className="shrink-0 border-t border-border px-3 py-2 text-[10px] text-muted-foreground">
        Use <span className="font-medium text-foreground">Apply entire model</span> in the toolbar to persist all
        inspector changes.
      </div>
    </div>
  )
}
