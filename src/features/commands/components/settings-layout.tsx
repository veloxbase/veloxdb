import type { ReactNode } from 'react'

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
}: {
  value: boolean
  onChange: (value: boolean) => void
  label?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      aria-label={label}
      onClick={() => onChange(!value)}
      className={cn(
        'relative mt-1 inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
        value ? 'bg-primary' : 'bg-muted-foreground/25',
      )}
    >
      <span
        className={cn(
          'pointer-events-none inline-block size-3.5 rounded-full bg-background shadow-sm transition-transform duration-150',
          value ? 'translate-x-[18px]' : 'translate-x-[2px]',
        )}
      />
    </button>
  )
}
