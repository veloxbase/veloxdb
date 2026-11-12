import { ChartBarIcon, PlugIcon, WarningCircleIcon } from '@phosphor-icons/react'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'

type DashboardEmptyStateProps = {
  icon?: ReactNode
  title: string
  description: string
  actionLabel?: string
  onAction?: () => void
  secondaryActionLabel?: string
  onSecondaryAction?: () => void
}

export function DashboardEmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
}: DashboardEmptyStateProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="text-muted-foreground/40">{icon ?? <ChartBarIcon className="size-8" />}</div>
      <p className="text-sm text-foreground">{title}</p>
      <p className="max-w-sm text-xs text-muted-foreground">{description}</p>
      {actionLabel && onAction ? (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
          <Button size="sm" onClick={onAction}>
            {actionLabel}
          </Button>
          {secondaryActionLabel && onSecondaryAction ? (
            <Button size="sm" variant="outline" onClick={onSecondaryAction}>
              {secondaryActionLabel}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export function DashboardNoConnectionState({ onOpenConnection }: { onOpenConnection: () => void }) {
  return (
    <DashboardEmptyState
      icon={<PlugIcon className="size-8" />}
      title="Choose a connection to view dashboards"
      description="Dashboards are scoped to a connection. Connect to a SQL database to create or open one."
      actionLabel="Open connection"
      onAction={onOpenConnection}
    />
  )
}

export function DashboardEngineUnsupportedState({ message }: { message: string }) {
  return (
    <DashboardEmptyState
      icon={<WarningCircleIcon className="size-8" />}
      title="Dashboards aren't available for this connection"
      description={message}
    />
  )
}
