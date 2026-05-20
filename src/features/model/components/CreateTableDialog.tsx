import { PlusIcon, TrashIcon } from '@phosphor-icons/react'
import { useCallback, useState } from 'react'
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
import { Input } from '@/components/ui/input'
import type { PendingCreateTable, PendingModelColumn } from '@/features/model/apply-entire-model'

const COMMON_TYPES = [
  'text', 'varchar', 'varchar(255)', 'integer', 'bigint', 'smallint',
  'boolean', 'date', 'timestamp', 'timestamptz', 'decimal', 'numeric',
  'real', 'double precision', 'jsonb', 'json', 'uuid',
  'serial', 'bigserial', 'bytea', 'interval', 'text[]',
]

function freshColumn(): PendingModelColumn {
  return {
    id: crypto.randomUUID(),
    columnName: '',
    dataType: 'text',
    nullable: true,
    defaultSql: '',
  }
}

type CreateTableDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCommit: (ct: PendingCreateTable) => void
  defaultSchema?: string
}

export function CreateTableDialog({
  open,
  onOpenChange,
  onCommit,
  defaultSchema = 'public',
}: CreateTableDialogProps) {
  const { t } = useTranslation()
  const [schema, setSchema] = useState(defaultSchema)
  const [name, setName] = useState('')
  const [columns, setColumns] = useState<PendingModelColumn[]>([freshColumn()])

  const updateColumn = useCallback(
    (id: string, patch: Partial<PendingModelColumn>) => {
      setColumns((prev) =>
        prev.map((c) => (c.id === id ? { ...c, ...patch } : c)),
      )
    },
    [],
  )

  const removeColumn = useCallback((id: string) => {
    setColumns((prev) => {
      if (prev.length <= 1) return prev
      return prev.filter((c) => c.id !== id)
    })
  }, [])

  const addColumn = useCallback(() => {
    setColumns((prev) => [...prev, freshColumn()])
  }, [])

  const handleCommit = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    const validColumns = columns.filter(
      (c) => c.columnName.trim() && c.dataType.trim(),
    )
    onCommit({
      id: crypto.randomUUID(),
      schema: schema.trim() || 'public',
      name: trimmed,
      columns: validColumns,
    })
    setSchema(defaultSchema)
    setName('')
    setColumns([freshColumn()])
    onOpenChange(false)
  }

  const valid =
    name.trim().length > 0 &&
    columns.some((c) => c.columnName.trim() && c.dataType.trim())

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl border border-border">
        <DialogHeader>
          <DialogTitle>{t("model.createTable")}</DialogTitle>
          <DialogDescription>
            {t("model.createTableDesc")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-[80px_1fr] items-center gap-2">
          <span className="text-xs font-medium">{t("model.schema")}</span>
          <Input
            className="h-8 text-xs"
            value={schema}
            onChange={(e) => setSchema(e.target.value)}
            placeholder="public"
            spellCheck={false}
          />
          <span className="text-xs font-medium">{t("model.tableName")}</span>
          <Input
            className="h-8 text-xs"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my_table"
            spellCheck={false}
            autoFocus
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">{t("model.columns")}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={addColumn}
            >
              <PlusIcon className="mr-1 size-3" />
              {t("model.addColumn")}
            </Button>
          </div>

          <div className="flex max-h-[280px] flex-col gap-1 overflow-y-auto rounded-md border border-border p-1">
            {columns.map((col) => (
              <div
                key={col.id}
                className="grid grid-cols-[1fr_120px_60px_24px] items-center gap-1 rounded px-1 py-0.5"
              >
                <Input
                  className="h-7 text-xs"
                  value={col.columnName}
                  onChange={(e) => updateColumn(col.id, { columnName: e.target.value })}
                  placeholder="column_name"
                  spellCheck={false}
                />
                <div className="relative">
                  <Input
                    className="h-7 text-xs"
                    list={`types-${col.id}`}
                    value={col.dataType}
                    onChange={(e) => updateColumn(col.id, { dataType: e.target.value })}
                    placeholder="text"
                    spellCheck={false}
                  />
                  <datalist id={`types-${col.id}`}>
                    {COMMON_TYPES.map((t) => (
                      <option key={t} value={t} />
                    ))}
                  </datalist>
                </div>
                <label className="flex cursor-pointer items-center gap-1 text-[11px] text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={col.nullable}
                    onChange={(e) =>
                      updateColumn(col.id, { nullable: e.target.checked })
                    }
                    className="size-3"
                  />
                  NULL
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  disabled={columns.length <= 1}
                  onClick={() => removeColumn(col.id)}
                  title={t("model.removeColumn")}
                >
                  <TrashIcon className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="button" disabled={!valid} onClick={handleCommit}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
