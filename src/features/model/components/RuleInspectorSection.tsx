import { useState } from 'react'
import { TrashIcon } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { PendingModelRule } from '@/features/model/apply-entire-model'
import type { TableKey } from '@/features/model/model-types'

type RuleInspectorSectionProps = {
  tableKey: TableKey
  pendingRules: PendingModelRule[]
  onChange: (next: PendingModelRule[]) => void
}

export function RuleInspectorSection({ tableKey, pendingRules, onChange }: RuleInspectorSectionProps) {
  const { t } = useTranslation()
  const [sql, setSql] = useState('')
  const [operation, setOperation] = useState<'create' | 'drop'>('create')
  const [label, setLabel] = useState('')

  return (
    <div className="space-y-2">
      <p className="text-[10px] text-muted-foreground">
        {t("model.ruleDesc")}
      </p>
      <Input
        className="h-8 text-xs"
        placeholder={t("model.labelOptional")}
        value={label}
        onChange={(e) => setLabel(e.target.value)}
      />
      <select
        className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
        value={operation}
        onChange={(e) => setOperation(e.target.value as 'create' | 'drop')}
      >
        <option value="create">{t("model.createRule")}</option>
        <option value="drop">{t("model.dropRule")}</option>
      </select>
      <Textarea
        className="min-h-24 font-mono text-[11px]"
        placeholder="CREATE RULE ... OR DROP RULE ..."
        value={sql}
        onChange={(e) => setSql(e.target.value)}
      />
      <Button
        type="button"
        size="sm"
        className="h-8 w-full text-xs"
        disabled={!sql.trim()}
        onClick={() => {
          onChange([
            ...pendingRules,
            { id: crypto.randomUUID(), tableKey, operation, title: label.trim() || undefined, sql: sql.trim() },
          ])
          setSql('')
          setLabel('')
        }}
      >
        {t("model.queueRule")}
      </Button>
      {pendingRules.map((row) => (
        <div key={row.id} className="flex items-start gap-2 rounded border border-border/70 bg-muted/20 px-2 py-1.5">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {row.title?.trim() || row.operation}
            </p>
            <pre className="max-h-20 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px]">
              {row.sql}
            </pre>
          </div>
          <button
            type="button"
            className="shrink-0 text-muted-foreground transition hover:text-destructive"
            onClick={() => onChange(pendingRules.filter((item) => item.id !== row.id))}
          >
            <TrashIcon className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}
