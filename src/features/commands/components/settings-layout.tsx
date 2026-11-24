import type { ReactNode } from 'react'

import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

/** One settings tab: a heading, a sentence about what it controls, then groups. */
export function SettingsPage({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <div className="mx-auto w-full max-w-[600px] px-7 pt-6 pb-8">
      <header className="mb-5">
        <h2 className="text-[15px] font-semibold tracking-tight text-foreground">{title}</h2>
        {description ? (
          <p className="mt-1 max-w-[52ch] text-xs leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
      </header>
      <div className="space-y-5">{children}</div>
    </div>
  )
}

/** Related rows in one bordered block, optionally titled. */
export function SettingsGroup({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section>
      {title ? <h3 className="mb-2 px-1 text-xs font-medium text-muted-foreground">{title}</h3> : null}
      <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card/30">
        {children}
      </div>
    </section>
  )
}

/** A label and its explanation on the left, the control on the right. */
export function SettingsRow({
  label,
  description,
  children,
  className,
}: {
  label: string
  description?: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-start justify-between gap-6 px-4 py-3.5', className)}>
      <div className="min-w-0 pt-1.5">
        <p className="text-xs font-medium text-foreground">{label}</p>
        {description ? (
          <p className="mt-1 max-w-[34ch] text-[11px] leading-snug text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 justify-end">{children}</div>
    </div>
  )
}

export const settingsSelectClass =
  'h-8 w-[168px] rounded-md border border-input bg-background px-2.5 text-xs shadow-xs transition-colors focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring'

export function SettingsToggle({
  value,
  onChange,
  label,
  disabled,
}: {
  value: boolean
  onChange: (value: boolean) => void
  label?: string
  disabled?: boolean
}) {
  // h-8 matches the other row controls, so the switch lines up with the label.
  return (
    <div className="flex h-8 items-center">
      <Switch
        checked={value}
        onCheckedChange={onChange}
        aria-label={label}
        disabled={disabled}
      />
    </div>
  )
}
