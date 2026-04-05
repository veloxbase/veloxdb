import { useMemo, useState } from 'react'
import { SpinnerGapIcon, CheckIcon, TrashIcon } from '@phosphor-icons/react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { ColumnProperties, TableInfo } from '@/data/types'
import type {
  ColumnOverride,
  PendingModelColumn,
  PendingModelForeignKey,
  TableIdentityDraft,
} from '@/features/model/apply-entire-model'
import { tableKey, type TableKey } from '@/features/model/model-types'
import { IndexInspectorSection } from '@/features/model/components/IndexInspectorSection'
import { useTablePropertiesQuery } from '@/features/schema/queries'
import { cn } from '@/lib/utils'

type PendingFkInput = {
  /** When omitted, the inspector table is the FK source. */
  fromKey?: TableKey
  fromColumn: string
  toKey: TableKey
  toColumn: string
  constraintName?: string
}

type ModelInspectorProps = {
  connectionId: string
  table: TableInfo | null
  tableKeyStr: TableKey | null
  /** Default header `#rrggbb` when the user has not picked a custom color (diagram uses a distinct color per table). */
  defaultDiagramHeaderHex: string
  /** User override for diagram node header; omit to use the distinct default for this table. */
  tableHeaderColor?: string
  onTableHeaderColorChange: (hex: string | null) => void
  identityDraft: TableIdentityDraft | null
  onIdentityDraftChange: (next: TableIdentityDraft) => void
  columnOverrides: Record<string, ColumnOverride>
  onColumnOverridesChange: (next: Record<string, ColumnOverride>) => void
  catalogTables: TableInfo[]
  pendingAddColumns: PendingModelColumn[]
  onPendingAddColumnsChange: (next: PendingModelColumn[]) => void
  pendingForeignKeys: PendingModelForeignKey[]
  onAddPendingForeignKey: (row: PendingFkInput) => void
  onRemovePendingForeignKey: (id: string) => void
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

function formatConstraintHint(column: ColumnProperties) {
  if (column.isPrimaryKey) return 'Primary key'
  if (column.isPartOfCompositeUnique) return 'Composite UNIQUE'
  return undefined
}

const selectClass =
  'h-8 w-full min-w-0 border border-input bg-transparent px-2 text-xs text-foreground outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 dark:bg-input/30'

export function ModelInspector({
  connectionId,
  table,
  tableKeyStr,
  defaultDiagramHeaderHex,
  tableHeaderColor,
  onTableHeaderColorChange,
  identityDraft,
  onIdentityDraftChange,
  columnOverrides,
  onColumnOverridesChange,
  catalogTables,
  pendingAddColumns,
  onPendingAddColumnsChange,
  pendingForeignKeys,
  onAddPendingForeignKey,
  onRemovePendingForeignKey,
}: ModelInspectorProps) {
  const propertiesQuery = useTablePropertiesQuery({
    connectionId,
    table,
    enabled: Boolean(connectionId && table),
  })

  const [newColName, setNewColName] = useState('')
  const [newColType, setNewColType] = useState('integer')
  const [newColNullable, setNewColNullable] = useState(true)
  const [newColDefault, setNewColDefault] = useState('')

  const [fkFromColumn, setFkFromColumn] = useState('')
  const [fkToKey, setFkToKey] = useState<TableKey>('')
  const [fkToColumn, setFkToColumn] = useState('')
  const [fkConstraintName, setFkConstraintName] = useState('')

  const fkTargetTable = useMemo(() => {
    if (!fkToKey) return null
    return catalogTables.find((t) => tableKey(t) === fkToKey) ?? null
  }, [catalogTables, fkToKey])

  const fkTargetPropsQuery = useTablePropertiesQuery({
    connectionId,
    table: fkTargetTable,
    enabled: Boolean(connectionId && fkTargetTable),
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

  const pendingFksHere = useMemo(
    () => pendingForeignKeys.filter((fk) => fk.fromKey === tableKeyStr),
    [pendingForeignKeys, tableKeyStr],
  )

  const existingColumnNames = useMemo(() => {
    const s = new Set<string>()
    for (const c of propertiesQuery.data ?? []) s.add(c.columnName)
    for (const p of pendingAddColumns) s.add(p.columnName.trim())
    return s
  }, [propertiesQuery.data, pendingAddColumns])

  const pushPendingColumn = () => {
    const name = newColName.trim()
    const dataType = newColType.trim()
    if (!name || !dataType) return
    if (existingColumnNames.has(name)) return
    onPendingAddColumnsChange([
      ...pendingAddColumns,
      {
        id: crypto.randomUUID(),
        columnName: name,
        dataType,
        nullable: newColNullable,
        defaultSql: newColDefault.trim() || undefined,
      },
    ])
    setNewColName('')
    setNewColDefault('')
  }

  const pushPendingFk = () => {
    if (!tableKeyStr || !fkFromColumn || !fkToKey || !fkToColumn) return
    if (fkToKey === tableKeyStr) return
    onAddPendingForeignKey({
      fromKey: tableKeyStr,
      fromColumn: fkFromColumn,
      toKey: fkToKey,
      toColumn: fkToColumn,
      constraintName: fkConstraintName.trim() || undefined,
    })
    setFkFromColumn('')
    setFkToKey('')
    setFkToColumn('')
    setFkConstraintName('')
  }

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
        {tableKeyStr ? (
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            <label
              className="text-[10px] font-medium text-muted-foreground"
              htmlFor="model-inspector-header-color"
            >
              Diagram header
            </label>
            <input
              id="model-inspector-header-color"
              type="color"
              className="h-8 w-10 cursor-pointer rounded border border-input bg-transparent p-0.5 dark:bg-input/30"
              value={tableHeaderColor ?? defaultDiagramHeaderHex}
              onChange={(e) => onTableHeaderColorChange(e.target.value)}
              title="Color of this table’s header on the diagram"
              aria-label="Diagram table header color"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-[10px]"
              disabled={tableHeaderColor == null}
              onClick={() => onTableHeaderColorChange(null)}
            >
              Reset
            </Button>
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
        <IndexInspectorSection
          connectionId={connectionId}
          table={table}
          columnNames={columns.map((c) => c.columnName)}
        />

        <div className="mb-4 space-y-2 border-b border-border pb-4">
          <p className="text-[10px] font-medium text-muted-foreground">Add column (pending)</p>
          <p className="text-[10px] leading-snug text-muted-foreground">
            Applied with <span className="font-medium text-foreground">Apply entire model</span> as{' '}
            <code className="text-foreground/90">ALTER TABLE … ADD COLUMN</code>. Type is a PostgreSQL type
            fragment (not quoted).
          </p>
          <div className="grid gap-2">
            <Input
              className="h-8 text-xs"
              placeholder="Column name"
              value={newColName}
              onChange={(e) => setNewColName(e.target.value)}
              spellCheck={false}
            />
            <Input
              className="h-8 text-xs"
              placeholder="Type, e.g. text, integer, timestamptz"
              value={newColType}
              onChange={(e) => setNewColType(e.target.value)}
              spellCheck={false}
            />
            <Input
              className="h-8 text-xs"
              placeholder="DEFAULT expression (optional)"
              value={newColDefault}
              onChange={(e) => setNewColDefault(e.target.value)}
              spellCheck={false}
            />
            <label className="flex items-center gap-2 text-[10px] text-muted-foreground">
              <ToggleButton checked={newColNullable} onClick={() => setNewColNullable((v) => !v)} />
              Nullable
            </label>
            <Button
              type="button"
              size="sm"
              className="h-8 w-full text-xs"
              disabled={!newColName.trim() || !newColType.trim() || existingColumnNames.has(newColName.trim())}
              onClick={pushPendingColumn}
            >
              Queue column
            </Button>
          </div>
          {pendingAddColumns.length > 0 ? (
            <ul className="mt-2 space-y-1.5 text-[10px]">
              {pendingAddColumns.map((p) => (
                <li
                  key={p.id}
                  className="flex items-start justify-between gap-2 border border-border/60 bg-muted/20 px-2 py-1.5"
                >
                  <span className="min-w-0 break-all font-mono text-foreground/90">
                    {p.columnName} {p.dataType}
                    {!p.nullable ? ' NOT NULL' : ''}
                    {p.defaultSql ? ` DEFAULT ${p.defaultSql}` : ''}
                  </span>
                  <button
                    type="button"
                    className="shrink-0 text-muted-foreground transition hover:text-destructive"
                    aria-label={`Remove ${p.columnName}`}
                    onClick={() => onPendingAddColumnsChange(pendingAddColumns.filter((x) => x.id !== p.id))}
                  >
                    <TrashIcon className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="mb-4 space-y-2 border-b border-border pb-4">
          <p className="text-[10px] font-medium text-muted-foreground">Add foreign key (pending)</p>
          <p className="text-[10px] leading-snug text-muted-foreground">
            Single-column FK. Runs as <code className="text-foreground/90">ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY</code>
            .
          </p>
          <div className="grid gap-2">
            <label className="text-[10px] text-muted-foreground" htmlFor="fk-from-col">
              From column (this table)
            </label>
            <select
              id="fk-from-col"
              className={selectClass}
              value={fkFromColumn}
              onChange={(e) => setFkFromColumn(e.target.value)}
            >
              <option value="">Select column…</option>
              {pendingAddColumns.map((p) => (
                <option key={p.id} value={p.columnName.trim()}>
                  {p.columnName} (pending)
                </option>
              ))}
              {columns.map((c) => (
                <option key={c.columnName} value={c.columnName}>
                  {c.columnName}
                </option>
              ))}
            </select>
            <label className="text-[10px] text-muted-foreground" htmlFor="fk-to-table">
              Referenced table
            </label>
            <select
              id="fk-to-table"
              className={selectClass}
              value={fkToKey}
              onChange={(e) => {
                setFkToKey(e.target.value as TableKey)
                setFkToColumn('')
              }}
            >
              <option value="">Select table…</option>
              {catalogTables.map((t) => {
                const k = tableKey(t)
                return (
                  <option key={k} value={k} disabled={k === tableKeyStr}>
                    {k}
                  </option>
                )
              })}
            </select>
            <label className="text-[10px] text-muted-foreground" htmlFor="fk-to-col">
              Referenced column
            </label>
            <select
              id="fk-to-col"
              className={selectClass}
              value={fkToColumn}
              onChange={(e) => setFkToColumn(e.target.value)}
              disabled={!fkToKey}
            >
              <option value="">Select column…</option>
              {(fkTargetPropsQuery.data ?? []).map((c) => (
                <option key={c.columnName} value={c.columnName}>
                  {c.columnName}
                </option>
              ))}
            </select>
            <Input
              className="h-8 text-xs"
              placeholder="Constraint name (optional)"
              value={fkConstraintName}
              onChange={(e) => setFkConstraintName(e.target.value)}
              spellCheck={false}
            />
            <Button
              type="button"
              size="sm"
              className="h-8 w-full text-xs"
              disabled={!fkFromColumn || !fkToKey || !fkToColumn || fkToKey === tableKeyStr}
              onClick={pushPendingFk}
            >
              Queue foreign key
            </Button>
          </div>
          {pendingFksHere.length > 0 ? (
            <ul className="mt-2 space-y-1.5 text-[10px]">
              {pendingFksHere.map((fk) => (
                <li
                  key={fk.id}
                  className="flex items-start justify-between gap-2 border border-border/60 bg-muted/20 px-2 py-1.5"
                >
                  <span className="min-w-0 break-all text-foreground/90">
                    {fk.fromColumn} → {fk.toKey} ({fk.toColumn})
                  </span>
                  <button
                    type="button"
                    className="shrink-0 text-muted-foreground transition hover:text-destructive"
                    aria-label="Remove foreign key"
                    onClick={() => onRemovePendingForeignKey(fk.id)}
                  >
                    <TrashIcon className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

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
            <p className="pb-2 text-[10px] font-medium text-muted-foreground">Existing columns</p>
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
        inspector changes, queued columns, and queued foreign keys.
      </div>
    </div>
  )
}
