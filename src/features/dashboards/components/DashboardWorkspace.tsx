import { useMemo } from 'react'

import type { BuilderChartType } from '@/features/dashboards/chart-builder-state'
import { useConnectionsQuery } from '@/features/connections/queries'
import { DashboardCanvas } from '@/features/dashboards/components/DashboardCanvas'
import { DashboardGate } from '@/features/dashboards/components/DashboardGate'
import type { WidgetAskContext } from '@/features/dashboards/components/widget-tile-actions'
import {
  DashboardEmptyState,
  DashboardEngineUnsupportedState,
  DashboardNoConnectionState,
} from '@/features/dashboards/components/DashboardEmptyState'
import { canUseDashboards, dashboardGuardMessage } from '@/features/dashboards/engine-guard'
import { useDashboardQuery } from '@/features/dashboards/queries'
import { resolveConnectionById } from '@/features/dashboards/resolve-dashboard-connection'
import { useEntitlements } from '@/features/entitlements/useEntitlements'

export type OpenSqlInEditorOptions = {
  sql: string
  connectionId: string
}

type DashboardWorkspaceProps = {
  openDashboardId: string | null
  isDark: boolean
  onCloseDashboard: () => void
  onOpenChartBuilder: (options: { sql?: string; defaultChartType?: BuilderChartType; preferredDashboardId?: string | null }) => void
  onOpenSqlInEditor: (options: OpenSqlInEditorOptions) => void
  onOpenConnection?: () => void
  onGenerateWithAi?: () => void
  onAskVeloxyAboutWidget?: (context: WidgetAskContext) => void
}

/** Main-content renderer for Dashboard mode. Dashboard selection lives in `DashboardContextSidebar`. */
export function DashboardWorkspace({
  openDashboardId,
  isDark,
  onCloseDashboard,
  onOpenChartBuilder,
  onOpenSqlInEditor,
  onOpenConnection,
  onGenerateWithAi,
  onAskVeloxyAboutWidget,
}: DashboardWorkspaceProps) {
  const entitlements = useEntitlements()
  const connectionsQuery = useConnectionsQuery()
  const dashboardQuery = useDashboardQuery(openDashboardId)

  if (!entitlements.bi) {
    return <DashboardGate />
  }

  const connections = connectionsQuery.data ?? []

  const dashboardConnection = useMemo(() => {
    const connectionId = dashboardQuery.data?.connectionId
    if (!connectionId) return null
    return resolveConnectionById(connections, connectionId)
  }, [connections, dashboardQuery.data?.connectionId])

  const knownConnectionIds = useMemo(
    () => new Set(connections.map((c) => c.id)),
    [connections],
  )

  if (connections.length === 0 && onOpenConnection) {
    return <DashboardNoConnectionState onOpenConnection={onOpenConnection} />
  }

  if (!openDashboardId) {
    return (
      <DashboardEmptyState
        title="Select a dashboard"
        description="Choose a dashboard from the sidebar, create an empty one, or generate a complete dashboard with Veloxy."
        actionLabel={onGenerateWithAi ? "Generate with Veloxy" : undefined}
        onAction={onGenerateWithAi}
      />
    )
  }

  if (dashboardQuery.isLoading) {
    return <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">Loading dashboard…</div>
  }

  if (dashboardQuery.isError || dashboardQuery.data === null || dashboardQuery.data === undefined) {
    return (
      <DashboardEmptyState
        title="Dashboard not found"
        description="It may have been deleted. Pick another dashboard from the sidebar."
        actionLabel="Close"
        onAction={onCloseDashboard}
      />
    )
  }

  const dashboard = dashboardQuery.data

  if (dashboardConnection && !canUseDashboards(dashboardConnection.engine)) {
    return (
      <DashboardEngineUnsupportedState
        message={dashboardGuardMessage(dashboardConnection.engine) ?? ''}
      />
    )
  }

  const connectionExists = dashboard.connectionId
    ? knownConnectionIds.has(dashboard.connectionId)
    : false

  return (
    <DashboardCanvas
      key={openDashboardId}
      dashboardId={openDashboardId}
      connection={dashboardConnection ?? {
        id: dashboard.connectionId,
        name: 'Connection missing',
        engine: 'postgres',
        host: '',
        port: 5432,
        database: '',
        user: '',
        connectedAt: '',
        sslMode: 'disable',
        tablePropertyEditingSupported: false,
      }}
      connectionExists={connectionExists}
      isDark={isDark}
      onClose={onCloseDashboard}
      onOpenChartBuilder={(options) => onOpenChartBuilder({
        ...options,
        preferredDashboardId: openDashboardId,
      })}
      onOpenSqlInEditor={(sql) => onOpenSqlInEditor({
        sql,
        connectionId: dashboard.connectionId,
      })}
      onAskVeloxyAboutWidget={onAskVeloxyAboutWidget}
    />
  )
}
