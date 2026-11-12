import { FunnelSimpleIcon, XIcon } from '@phosphor-icons/react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { DashboardVariable } from '@/data/types'
import { DATE_FROM_VAR, DATE_TO_VAR } from '@/features/dashboards/ai/auto-variables'

type VariablesBarProps = {
  variables: DashboardVariable[]
  values: Record<string, string>
  onChange: (name: string, value: string) => void
  /** Resets every variable to its default. */
  onClear?: () => void
}

const selectClassName =
  'h-7 min-w-28 rounded-md border border-input bg-background px-2 text-xs shadow-xs transition-colors focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring'

function labelOf(variable: DashboardVariable): string {
  return variable.label ?? variable.name
}

function VariableControl({
  variable,
  value,
  onChange,
}: {
  variable: DashboardVariable
  value: string
  onChange: (value: string) => void
}) {
  if (variable.type === 'select') {
    const options = variable.options ?? []
    const hasValue = value !== '' && !options.includes(value)
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} className={selectClassName}>
        <option value="">All</option>
        {hasValue ? <option value={value}>{value}</option> : null}
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    )
  }
  return (
    <Input
      type={variable.type === 'number' ? 'number' : variable.type === 'date' ? 'date' : 'text'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-7 w-32 text-xs"
    />
  )
}

/** Metabase-style filter chips for dashboard variables (`{{name}}` in widget SQL). */
export function VariablesBar({ variables, values, onChange, onClear }: VariablesBarProps) {
  if (variables.length === 0) return null

  const from = variables.find((v) => v.name === DATE_FROM_VAR && v.type === 'date')
  const to = variables.find((v) => v.name === DATE_TO_VAR && v.type === 'date')
  const range = from && to ? { from, to } : null
  const rest = variables.filter((v) => !range || (v.name !== DATE_FROM_VAR && v.name !== DATE_TO_VAR))
  const valueOf = (variable: DashboardVariable) => values[variable.name] ?? variable.defaultValue
  const isDirty = variables.some((variable) => valueOf(variable) !== variable.defaultValue)
  const activeCount = variables.filter((variable) => valueOf(variable) !== '' && valueOf(variable) !== variable.defaultValue).length

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2">
      <p className="flex items-center gap-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        <FunnelSimpleIcon className="size-3" />
        Filters
      </p>

      {range ? (
        <label className="flex items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">Period</span>
          <Input
            type="date"
            value={valueOf(range.from)}
            max={valueOf(range.to) || undefined}
            onChange={(e) => onChange(range.from.name, e.target.value)}
            className="h-7 w-32 text-xs"
            aria-label="From"
          />
          <span className="text-muted-foreground">→</span>
          <Input
            type="date"
            value={valueOf(range.to)}
            min={valueOf(range.from) || undefined}
            onChange={(e) => onChange(range.to.name, e.target.value)}
            className="h-7 w-32 text-xs"
            aria-label="To"
          />
        </label>
      ) : null}

      {rest.map((variable) => (
        <label key={variable.name} className="flex items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">{labelOf(variable)}</span>
          <VariableControl
            variable={variable}
            value={valueOf(variable)}
            onChange={(value) => onChange(variable.name, value)}
          />
        </label>
      ))}

      {onClear && isDirty ? (
        <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={onClear}>
          <XIcon className="size-3" />
          Clear filters{activeCount > 0 ? ` (${activeCount})` : ''}
        </Button>
      ) : null}
    </div>
  )
}
