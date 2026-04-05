import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { IndexInfo, TableInfo } from '@/data/types'
import {
  useExecuteDdlStatementMutation,
  useExecuteDdlTransactionMutation,
} from '@/features/model/queries'
import { useTableIndexesQuery } from '@/features/schema/queries'
import { formatBytes } from '@/lib/format-bytes'
import { quoteIdent } from '@/lib/sql-ident'
import { cn } from '@/lib/utils'

type IndexInspectorSectionProps = {
  connectionId: string
  table: TableInfo
  columnNames: string[]
}

function buildCreateIndexSql(opts: {
  schema: string
  table: string
  columns: string[]
  indexName: string
  unique: boolean
  where: string
  concurrent: boolean
}): string {
  const baseName =
    opts.indexName.trim() ||
    `veloxdb_idx_${opts.table}_${opts.columns.join('_')}`.replace(/[^\w]/g, '_')
  const idxName = baseName.length > 63 ? baseName.slice(0, 63) : baseName
  const cols = opts.columns.map((c) => quoteIdent(c)).join(', ')
  const uniq = opts.unique ? 'UNIQUE ' : ''
  const conc = opts.concurrent ? 'CONCURRENTLY ' : ''
  const on = `${quoteIdent(opts.schema)}.${quoteIdent(opts.table)}`
  let sql = `CREATE ${uniq}INDEX ${conc}${quoteIdent(idxName)} ON ${on} (${cols})`
  const w = opts.where.trim()
  if (w) sql += ` WHERE ${w}`
  return sql
}

function buildDropIndexSql(schema: string, indexName: string): string {
  return `DROP INDEX IF EXISTS ${quoteIdent(schema)}.${quoteIdent(indexName)}`
}

function IndexBadge({
  label,
  variant = 'default',
}: {
  label: string
  variant?: 'default' | 'warn' | 'muted'
}) {
  return (
    <span
      className={cn(
        'rounded px-1 py-0.5 text-[9px] font-medium uppercase tracking-wide',
        variant === 'default' && 'bg-primary/15 text-primary',
        variant === 'warn' && 'bg-destructive/15 text-destructive',
        variant === 'muted' && 'bg-muted text-muted-foreground',
      )}
    >
      {label}
    </span>
  )
}

function IndexRow({
  row,
  onDrop,
  dropPending,
}: {
  row: IndexInfo
  onDrop: (sql: string) => void
  dropPending: boolean
}) {
  return (
    <li className="space-y-1.5 border border-border/60 bg-muted/15 px-2 py-2">
      <div className="flex flex-wrap items-center gap-1">
        <span className="truncate font-mono text-[11px] text-foreground/90" title={row.indexName}>
          {row.indexName}
        </span>
        {row.isPrimary ? <IndexBadge label="PK" /> : null}
        {row.isUnique && !row.isPrimary ? <IndexBadge label="Unique" /> : null}
        {row.isPartial ? <IndexBadge label="Partial" variant="muted" /> : null}
        {!row.isValid ? <IndexBadge label="Invalid" variant="warn" /> : null}
      </div>
      <div className="text-[10px] text-muted-foreground">
        {formatBytes(row.indexBytes)}
        {' · '}
        scans {row.idxScan.toLocaleString()}
        {' · '}
        tup_read {row.idxTupRead.toLocaleString()}
        {' · '}
        tup_fetch {row.idxTupFetch.toLocaleString()}
      </div>
      <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-all rounded border border-border/50 bg-background/80 p-1.5 font-mono text-[10px] leading-snug text-foreground/85">
        {row.definition}
      </pre>
      {!row.isPrimary ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 w-full text-[10px]"
          disabled={dropPending}
          onClick={() => onDrop(buildDropIndexSql(row.indexSchema, row.indexName))}
        >
          Drop index…
        </Button>
      ) : (
        <p className="text-[10px] text-muted-foreground">Primary key indexes are managed via table constraints.</p>
      )}
    </li>
  )
}

export function IndexInspectorSection({ connectionId, table, columnNames }: IndexInspectorSectionProps) {
  const indexesQuery = useTableIndexesQuery({
    connectionId,
    table,
    enabled: Boolean(connectionId && table),
  })

  const txnMutation = useExecuteDdlTransactionMutation()
  const stmtMutation = useExecuteDdlStatementMutation()

  const [newIndexName, setNewIndexName] = useState('')
  const [selectedCols, setSelectedCols] = useState<Record<string, boolean>>({})
  const [newUnique, setNewUnique] = useState(false)
  const [newWhere, setNewWhere] = useState('')
  const [newConcurrent, setNewConcurrent] = useState(false)

  const [pendingDdl, setPendingDdl] = useState<{
    sql: string
    mode: 'txn' | 'stmt'
    title: string
  } | null>(null)

  const selectedColumnList = useMemo(() => {
    return columnNames.filter((c) => selectedCols[c])
  }, [columnNames, selectedCols])

  const createSqlPreview = useMemo(() => {
    if (selectedColumnList.length === 0) return ''
    return buildCreateIndexSql({
      schema: table.schema,
      table: table.name,
      columns: selectedColumnList,
      indexName: newIndexName,
      unique: newUnique,
      where: newWhere,
      concurrent: newConcurrent,
    })
  }, [newConcurrent, newIndexName, newUnique, newWhere, selectedColumnList, table.name, table.schema])

  const runPending = async () => {
    if (!pendingDdl) return
    const sql = pendingDdl.sql
    if (pendingDdl.mode === 'stmt') {
      await stmtMutation.mutateAsync({ connectionId, statement: sql })
    } else {
      await txnMutation.mutateAsync({ connectionId, statements: [sql] })
    }
    setPendingDdl(null)
  }

  const dropPending = txnMutation.isPending || stmtMutation.isPending

  return (
    <div className="mb-4 space-y-3 border-b border-border pb-4">
      <p className="text-[10px] font-medium text-muted-foreground">Indexes</p>
      <p className="text-[10px] leading-snug text-muted-foreground">
        Usage stats come from <span className="font-mono text-foreground/80">pg_stat_user_indexes</span> (reset on
        crash or stats reset). Create with <span className="font-medium text-foreground">CONCURRENTLY</span> runs
        outside a transaction.
      </p>

      {indexesQuery.isLoading ? (
        <p className="text-[10px] text-muted-foreground">Loading indexes…</p>
      ) : null}
      {indexesQuery.isError ? (
        <p className="text-[10px] text-destructive">
          {indexesQuery.error instanceof Error ? indexesQuery.error.message : 'Failed to load indexes'}
        </p>
      ) : null}

      {indexesQuery.data?.truncated ? (
        <p className="text-[10px] text-amber-600 dark:text-amber-500">
          List truncated (over 500 indexes for this table).
        </p>
      ) : null}

      {indexesQuery.data && indexesQuery.data.indexes.length === 0 ? (
        <p className="text-[10px] text-muted-foreground">No indexes found (unusual for a table with data).</p>
      ) : null}

      {indexesQuery.data && indexesQuery.data.indexes.length > 0 ? (
        <ul className="max-h-64 space-y-2 overflow-y-auto pr-0.5">
          {indexesQuery.data.indexes.map((row) => (
            <IndexRow
              key={`${row.indexSchema}.${row.indexName}`}
              row={row}
              dropPending={dropPending}
              onDrop={(sql) => setPendingDdl({ sql, mode: 'txn', title: 'Drop index' })}
            />
          ))}
        </ul>
      ) : null}

      <div className="space-y-2 rounded-md border border-border/70 bg-muted/10 p-2">
        <p className="text-[10px] font-medium text-muted-foreground">Create index</p>
        <Input
          className="h-8 text-xs"
          placeholder="Index name (optional)"
          value={newIndexName}
          onChange={(e) => setNewIndexName(e.target.value)}
          spellCheck={false}
        />
        <p className="text-[10px] text-muted-foreground">Columns</p>
        <div className="flex max-h-32 flex-col gap-1 overflow-y-auto">
          {columnNames.length === 0 ? (
            <span className="text-[10px] text-muted-foreground">Load table columns first.</span>
          ) : (
            columnNames.map((c) => (
              <label key={c} className="flex cursor-pointer items-center gap-2 text-[10px]">
                <input
                  type="checkbox"
                  className="rounded border-input"
                  checked={Boolean(selectedCols[c])}
                  onChange={(e) => setSelectedCols((prev) => ({ ...prev, [c]: e.target.checked }))}
                />
                <span className="font-mono">{c}</span>
              </label>
            ))
          )}
        </div>
        <Input
          className="h-8 text-xs font-mono"
          placeholder="WHERE predicate (optional, partial index)"
          value={newWhere}
          onChange={(e) => setNewWhere(e.target.value)}
          spellCheck={false}
        />
        <label className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <input
            type="checkbox"
            className="rounded border-input"
            checked={newUnique}
            onChange={(e) => setNewUnique(e.target.checked)}
          />
          UNIQUE
        </label>
        <label className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <input
            type="checkbox"
            className="rounded border-input"
            checked={newConcurrent}
            onChange={(e) => setNewConcurrent(e.target.checked)}
          />
          CONCURRENTLY (non-transactional; cannot combine with other DDL here)
        </label>
        {createSqlPreview ? (
          <pre className="max-h-20 overflow-auto whitespace-pre-wrap break-all rounded border border-border/50 bg-background p-1.5 font-mono text-[10px]">
            {createSqlPreview}
          </pre>
        ) : null}
        <Button
          type="button"
          size="sm"
          className="h-8 w-full text-xs"
          disabled={selectedColumnList.length === 0 || dropPending}
          onClick={() => {
            if (!createSqlPreview) return
            setPendingDdl({
              sql: createSqlPreview,
              mode: newConcurrent ? 'stmt' : 'txn',
              title: 'Create index',
            })
          }}
        >
          Review &amp; create…
        </Button>
      </div>

      <Dialog open={pendingDdl != null} onOpenChange={(o) => !o && setPendingDdl(null)}>
        <DialogContent className="max-w-lg border border-border">
          <DialogHeader>
            <DialogTitle>{pendingDdl?.title ?? 'DDL'}</DialogTitle>
            <DialogDescription>
              {pendingDdl?.mode === 'stmt'
                ? 'Runs as a single statement outside an explicit transaction.'
                : 'Runs inside one transaction (rolls back on failure).'}
            </DialogDescription>
          </DialogHeader>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md border border-border bg-muted/30 p-2 font-mono text-[11px]">
            {pendingDdl?.sql}
          </pre>
          {txnMutation.isError || stmtMutation.isError ? (
            <p className="text-xs text-destructive">
              {(txnMutation.error ?? stmtMutation.error) instanceof Error
                ? (txnMutation.error ?? stmtMutation.error)?.message
                : 'Execution failed'}
            </p>
          ) : null}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setPendingDdl(null)}>
              Cancel
            </Button>
            <Button type="button" disabled={dropPending} onClick={() => void runPending()}>
              {dropPending ? 'Running…' : 'Execute'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
