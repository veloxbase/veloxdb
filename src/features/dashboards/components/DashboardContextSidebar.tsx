import { open, save } from '@tauri-apps/plugin-dialog'
import {
  ChartBarIcon,
  ChartLineUpIcon,
  CopySimpleIcon,
  DownloadSimpleIcon,
  PencilSimpleIcon,
  PlayIcon,
  PlusIcon,
  SidebarSimpleIcon,
  SparkleIcon,
  TrashIcon,
  UploadSimpleIcon,
} from '@phosphor-icons/react'
import { type ReactNode, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { veloxDbRepository } from '@/data/repositories'
import type { ConnectionSummary, Dashboard, SavedQuery } from '@/data/types'
import { useConnectionsQuery } from '@/features/connections/queries'
import { DashboardConnectionPickerDialog } from '@/features/dashboards/components/DashboardConnectionPickerDialog'
import { RenameDashboardDialog } from '@/features/dashboards/components/RenameDashboardDialog'
import { createEmptyDashboard } from '@/features/dashboards/dashboard-factory'
import { parseDashboardJson, serializeDashboard } from '@/features/dashboards/dashboard-import-export'
import { canUseDashboards } from '@/features/dashboards/engine-guard'
import {
  useAllDashboardsQuery,
  useAllSavedQueriesQuery,
  useDeleteDashboardMutation,
  useDeleteSavedQueryMutation,
  useDuplicateDashboardMutation,
  useDuplicateSavedQueryMutation,
  useSaveDashboardMutation,
} from '@/features/dashboards/queries'
import { connectionLabel } from '@/features/dashboards/resolve-dashboard-connection'
import type { OpenSqlInEditorOptions } from '@/features/dashboards/components/DashboardWorkspace'
import { notifyError, notifySuccess } from '@/lib/error-notifier'
import { cn } from '@/lib/utils'

type DashboardContextSidebarProps = {
  connection: ConnectionSummary | null
  openDashboardId: string | null
  onOpenDashboard: (id: string) => void
  onOpenSqlInEditor: (options: OpenSqlInEditorOptions) => void
  onChartSavedQuery?: (sql: string, connectionId: string) => void
  onOpenConnection: () => void
  onToggleCollapsed: () => void
  onGenerateWithAi?: () => void
}

type PendingImport = {
  dashboard: Dashboard
}

function SidebarShell({
  subtitle, onToggleCollapsed, actions, children,
}: {
  subtitle: string
  onToggleCollapsed: () => void
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <aside className="flex h-full flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="flex items-center justify-between gap-2 border-b border-sidebar-border px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-[0.24em] text-sidebar-foreground/60">Dashboards</p>
          <p className="truncate pt-1 text-xs text-sidebar-foreground/80">{subtitle}</p>
        </div>
        <div className="flex items-center gap-1">
          {actions}
          <Button variant="ghost" size="icon-sm" onClick={onToggleCollapsed} aria-label="Close sidebar">
            <SidebarSimpleIcon />
          </Button>
        </div>
      </div>
      {children}
    </aside>
  )
}

function resolveCreateConnection(
  connection: ConnectionSummary | null,
  dashboardConnections: ConnectionSummary[],
): ConnectionSummary | null {
  if (connection && canUseDashboards(connection.engine)) return connection
  if (dashboardConnections.length === 1) return dashboardConnections[0] ?? null
  return null
}

export function DashboardContextSidebar({
  connection, openDashboardId, onOpenDashboard, onOpenSqlInEditor, onChartSavedQuery, onOpenConnection, onToggleCollapsed, onGenerateWithAi,
}: DashboardContextSidebarProps) {
  const [renamingDashboard, setRenamingDashboard] = useState<Dashboard | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerMode, setPickerMode] = useState<'create' | 'import' | null>(null)
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null)

  const connectionsQuery = useConnectionsQuery()
  const dashboardsQuery = useAllDashboardsQuery()
  const savedQueriesQuery = useAllSavedQueriesQuery()

  const connections = connectionsQuery.data ?? []
  const dashboardConnections = useMemo(
    () => connections.filter((c) => canUseDashboards(c.engine)),
    [connections],
  )

  const saveMutation = useSaveDashboardMutation({
    onError: (error) => notifyError(error, { title: 'Failed to save dashboard' }),
  })
  const deleteMutation = useDeleteDashboardMutation({
    onSuccess: () => notifySuccess('Dashboard deleted'),
    onError: (error) => notifyError(error, { title: 'Failed to delete dashboard' }),
  })
  const duplicateMutation = useDuplicateDashboardMutation({
    onSuccess: (dashboard) => onOpenDashboard(dashboard.id),
    onError: (error) => notifyError(error, { title: 'Failed to duplicate dashboard' }),
  })
  const deleteSavedQueryMutation = useDeleteSavedQueryMutation({
    onSuccess: () => notifySuccess('Saved query deleted'),
    onError: (error) => notifyError(error, { title: 'Failed to delete saved query' }),
  })
  const duplicateSavedQueryMutation = useDuplicateSavedQueryMutation({
    onError: (error) => notifyError(error, { title: 'Failed to duplicate saved query' }),
  })

  const dashboards = dashboardsQuery.data ?? []
  const savedQueries = savedQueriesQuery.data ?? []

  const subtitle = dashboardConnections.length === 0
    ? 'No SQL connections'
    : dashboardConnections.length === 1
      ? (dashboardConnections[0]?.name ?? 'All connections')
      : `All connections (${dashboardConnections.length})`

  const createDashboardForConnection = (target: ConnectionSummary) => {
    const dashboard = createEmptyDashboard(target.id, `Dashboard ${dashboards.length + 1}`)
    saveMutation.mutate(dashboard, {
      onSuccess: () => onOpenDashboard(dashboard.id),
    })
  }

  const handleCreate = () => {
    const target = resolveCreateConnection(connection, dashboardConnections)
    if (!target) {
      if (dashboardConnections.length === 0) {
        onOpenConnection()
        return
      }
      setPickerMode('create')
      setPickerOpen(true)
      return
    }
    createDashboardForConnection(target)
  }

  const handleDelete = (dashboard: Dashboard) => {
    if (!window.confirm(`Delete dashboard "${dashboard.name}"?`)) return
    deleteMutation.mutate({ id: dashboard.id, connectionId: dashboard.connectionId })
  }

  const handleDeleteSavedQuery = (savedQuery: SavedQuery) => {
    if (!window.confirm(`Delete saved query "${savedQuery.name}"?`)) return
    deleteSavedQueryMutation.mutate({ id: savedQuery.id, connectionId: savedQuery.connectionId })
  }

  const handleRenameConfirm = (dashboard: Dashboard, newName: string) => {
    saveMutation.mutate({ ...dashboard, name: newName })
    setRenamingDashboard(null)
  }

  const handleExport = async (dashboard: Dashboard) => {
    const path = await save({
      defaultPath: `${dashboard.name.replace(/[^a-z0-9-_]+/gi, '_')}.json`,
      filters: [{ name: 'Dashboard JSON', extensions: ['json'] }],
    })
    if (!path) return
    try {
      await veloxDbRepository.saveTextFile(serializeDashboard(dashboard), path)
      notifySuccess('Dashboard exported')
    } catch (error) {
      notifyError(error, { title: 'Failed to export dashboard' })
    }
  }

  const finishImport = (target: ConnectionSummary, imported: Dashboard) => {
    const idCollision = dashboards.some((d) => d.id === imported.id)
    const dashboard: Dashboard = {
      ...imported,
      id: idCollision ? crypto.randomUUID() : imported.id,
      connectionId: target.id,
    }
    saveMutation.mutate(dashboard, {
      onSuccess: () => {
        notifySuccess('Dashboard imported')
        onOpenDashboard(dashboard.id)
      },
    })
  }

  const handleImport = async () => {
    const path = await open({ multiple: false, filters: [{ name: 'Dashboard JSON', extensions: ['json'] }] })
    if (!path || Array.isArray(path)) return
    try {
      const raw = await veloxDbRepository.readTextFile(path)
      const imported = parseDashboardJson(raw)
      const target = resolveCreateConnection(connection, dashboardConnections)
      if (!target) {
        if (dashboardConnections.length === 0) {
          onOpenConnection()
          return
        }
        setPendingImport({ dashboard: imported })
        setPickerMode('import')
        setPickerOpen(true)
        return
      }
      finishImport(target, imported)
    } catch (error) {
      notifyError(error, { title: 'Failed to import dashboard' })
    }
  }

  const handlePickerSelect = (target: ConnectionSummary) => {
    setPickerOpen(false)
    if (pickerMode === 'create') {
      createDashboardForConnection(target)
    } else if (pickerMode === 'import' && pendingImport) {
      finishImport(target, pendingImport.dashboard)
      setPendingImport(null)
    }
    setPickerMode(null)
  }

  const handlePickerCancel = () => {
    setPickerOpen(false)
    setPickerMode(null)
    setPendingImport(null)
  }

  return (
    <SidebarShell
      subtitle={subtitle}
      onToggleCollapsed={onToggleCollapsed}
      actions={(
        <>
          {onGenerateWithAi ? (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onGenerateWithAi}
              title="Generate dashboard with Veloxy"
              aria-label="Generate dashboard with Veloxy"
              className="text-emerald-600 hover:text-emerald-500 dark:text-emerald-400"
            >
              <SparkleIcon weight="fill" className="size-3.5" />
            </Button>
          ) : null}
          <Button variant="ghost" size="icon-sm" onClick={() => void handleImport()} title="Import dashboard JSON" aria-label="Import dashboard JSON">
            <UploadSimpleIcon />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={handleCreate} disabled={saveMutation.isPending} title="New dashboard" aria-label="New dashboard">
            <PlusIcon />
          </Button>
        </>
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        <div className="border-b border-sidebar-border/40 py-1">
          {dashboardsQuery.isLoading ? (
            <p className="px-3 py-3 text-[11px] text-sidebar-foreground/60">Loading dashboards…</p>
          ) : dashboards.length === 0 ? (
            <div className="space-y-2 px-3 py-3">
              <p className="text-[11px] text-sidebar-foreground/60">
                No dashboards yet. Create one or generate with AI.
              </p>
              {onGenerateWithAi ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 w-full gap-1.5 border-emerald-500/30 text-xs text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400"
                  onClick={onGenerateWithAi}
                >
                  <SparkleIcon className="size-3" weight="fill" />
                  Generate with Veloxy
                </Button>
              ) : null}
            </div>
          ) : (
            dashboards.map((dashboard) => {
              const isActive = dashboard.id === openDashboardId
              const widgetCount = Object.keys(dashboard.widgets).length
              const connName = connectionLabel(connections, dashboard.connectionId)
              const connectionMissing = !connections.some((c) => c.id === dashboard.connectionId)
              return (
                <div
                  key={dashboard.id}
                  className={cn(
                    'group flex items-stretch text-left text-xs transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                    isActive && 'bg-emerald-500/10 text-emerald-600',
                  )}
                >
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2"
                    onClick={() => onOpenDashboard(dashboard.id)}
                  >
                    <ChartBarIcon className={cn('size-3.5 shrink-0', isActive ? 'text-emerald-500' : 'text-sidebar-foreground/60')} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{dashboard.name}</p>
                      <p className={cn(
                        'truncate text-[10px]',
                        connectionMissing ? 'text-amber-600 dark:text-amber-400' : 'text-sidebar-foreground/60',
                      )}
                      >
                        {connName} · {widgetCount} widget{widgetCount === 1 ? '' : 's'}
                      </p>
                    </div>
                  </button>
                  <div className="flex shrink-0 items-center gap-0.5 px-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      type="button"
                      className="rounded p-1 text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                      title="Rename"
                      onClick={(e) => { e.stopPropagation(); setRenamingDashboard(dashboard) }}
                    >
                      <PencilSimpleIcon className="size-3" />
                    </button>
                    <button
                      type="button"
                      className="rounded p-1 text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                      title="Duplicate"
                      onClick={(e) => { e.stopPropagation(); duplicateMutation.mutate(dashboard.id) }}
                    >
                      <CopySimpleIcon className="size-3" />
                    </button>
                    <button
                      type="button"
                      className="rounded p-1 text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                      title="Export JSON"
                      onClick={(e) => { e.stopPropagation(); void handleExport(dashboard) }}
                    >
                      <DownloadSimpleIcon className="size-3" />
                    </button>
                    <button
                      type="button"
                      className="rounded p-1 text-sidebar-foreground/60 hover:bg-destructive/10 hover:text-destructive"
                      title="Delete"
                      onClick={(e) => { e.stopPropagation(); handleDelete(dashboard) }}
                    >
                      <TrashIcon className="size-3" />
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>

        <details className="py-1">
          <summary className="cursor-pointer list-none px-3 pt-2 pb-1 text-[11px] uppercase tracking-[0.18em] text-sidebar-foreground/50">
            Saved queries
          </summary>
          {savedQueriesQuery.isLoading ? (
            <p className="px-3 py-3 text-[11px] text-sidebar-foreground/60">Loading…</p>
          ) : savedQueriesQuery.isError ? (
            <p className="px-3 py-3 text-[11px] text-destructive">
              Failed to load saved queries.
            </p>
          ) : savedQueries.length === 0 ? (
            <p className="px-3 py-3 text-[11px] text-sidebar-foreground/60">
              None yet. Save one from the SQL editor toolbar.
            </p>
          ) : (
            savedQueries.map((savedQuery) => {
              const connName = connectionLabel(connections, savedQuery.connectionId)
              const connectionMissing = !connections.some((c) => c.id === savedQuery.connectionId)
              return (
                <div
                  key={savedQuery.id}
                  className="group flex items-stretch text-left text-xs transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 px-3 py-2 text-left"
                    title={savedQuery.sql}
                    onClick={() => onOpenSqlInEditor({ sql: savedQuery.sql, connectionId: savedQuery.connectionId })}
                  >
                    <p className="truncate font-medium">{savedQuery.name}</p>
                    <p className={cn(
                      'truncate text-[10px]',
                      connectionMissing ? 'text-amber-600 dark:text-amber-400' : 'text-sidebar-foreground/60',
                    )}
                    >
                      {connName}
                    </p>
                  </button>
                  <div className="flex shrink-0 items-center gap-0.5 px-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      type="button"
                      className="rounded p-1 text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                      title="Open in editor"
                      onClick={(e) => {
                        e.stopPropagation()
                        onOpenSqlInEditor({ sql: savedQuery.sql, connectionId: savedQuery.connectionId })
                      }}
                    >
                      <PlayIcon className="size-3" />
                    </button>
                    {onChartSavedQuery ? (
                      <button
                        type="button"
                        className="rounded p-1 text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                        title="Chart this query"
                        onClick={(e) => {
                          e.stopPropagation()
                          onChartSavedQuery(savedQuery.sql, savedQuery.connectionId)
                        }}
                      >
                        <ChartLineUpIcon className="size-3" />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="rounded p-1 text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                      title="Duplicate"
                      onClick={(e) => { e.stopPropagation(); duplicateSavedQueryMutation.mutate(savedQuery.id) }}
                    >
                      <CopySimpleIcon className="size-3" />
                    </button>
                    <button
                      type="button"
                      className="rounded p-1 text-sidebar-foreground/60 hover:bg-destructive/10 hover:text-destructive"
                      title="Delete"
                      onClick={(e) => { e.stopPropagation(); handleDeleteSavedQuery(savedQuery) }}
                    >
                      <TrashIcon className="size-3" />
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </details>
      </div>

      <RenameDashboardDialog
        key={renamingDashboard?.id ?? 'none'}
        dashboard={renamingDashboard}
        onConfirm={handleRenameConfirm}
        onCancel={() => setRenamingDashboard(null)}
      />

      <DashboardConnectionPickerDialog
        open={pickerOpen}
        title={pickerMode === 'import' ? 'Import dashboard' : 'New dashboard'}
        description="Choose which connection this dashboard belongs to."
        connections={dashboardConnections}
        onSelect={handlePickerSelect}
        onCancel={handlePickerCancel}
      />
    </SidebarShell>
  )
}
