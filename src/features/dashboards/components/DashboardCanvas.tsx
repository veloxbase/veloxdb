import { ChartBarIcon, XIcon } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { ConnectionSummary, Dashboard, Widget } from '@/data/types'
import type { BuilderChartType } from '@/features/dashboards/chart-builder-state'
import { DashboardConnectionWarning } from '@/features/dashboards/components/DashboardConnectionWarning'
import { DashboardEmptyState } from '@/features/dashboards/components/DashboardEmptyState'
import { DashboardGrid } from '@/features/dashboards/components/DashboardGrid'
import { LogicView } from '@/features/dashboards/components/logic/LogicView'
import { DashboardSettingsDialog } from '@/features/dashboards/components/DashboardSettingsDialog'
import { ShareReportDialog } from '@/features/dashboards/components/ShareReportDialog'
import { DashboardToolbar } from '@/features/dashboards/components/DashboardToolbar'
import { VariablesBar } from '@/features/dashboards/components/VariablesBar'
import { NoteEditorDialog } from '@/features/dashboards/components/notes/NoteEditorDialog'
import { WidgetEditorDialog } from '@/features/dashboards/components/WidgetEditorDialog'
import type { WidgetAskContext, WidgetInteractions } from '@/features/dashboards/components/widget-tile-actions'
import {
  addCell,
  deleteCell,
  duplicateVisualCell,
  updateCell,
} from '@/features/dashboards/notebook/cell-mutations'
import { toggleWidgetLock } from '@/features/dashboards/dashboard-layout'
import { migrateDashboard } from '@/features/dashboards/dashboard-migrate'
import { useDashboardAutosave } from '@/features/dashboards/hooks/useDashboardAutosave'
import { useDashboardRefresh } from '@/features/dashboards/hooks/useDashboardRefresh'
import { useDashboardQuery } from '@/features/dashboards/queries'
import {
  addDashboardPage,
  assignWidgetToPage,
  dashboardPages,
  filterDashboardToPage,
} from '@/features/dashboards/dashboard-pages'

function resolveWidgetIsDark(dashboard: Dashboard, appIsDark: boolean): boolean {
  if (dashboard.theme === 'dark') return true
  if (dashboard.theme === 'light') return false
  return appIsDark
}

function buildVariableDefaults(dashboard: Dashboard): Record<string, string> {
  return Object.fromEntries(dashboard.variables.map((v) => [v.name, v.defaultValue]))
}

type DashboardCanvasProps = {
  dashboardId: string
  connection: ConnectionSummary
  connectionExists: boolean
  isDark: boolean
  onClose: () => void
  onOpenChartBuilder: (options: { sql?: string; defaultChartType?: BuilderChartType }) => void
  onOpenSqlInEditor: (sql: string) => void
  onAskVeloxyAboutWidget?: (context: WidgetAskContext) => void
}

export function DashboardCanvas({
  dashboardId,
  connection,
  connectionExists,
  isDark,
  onClose,
  onOpenChartBuilder,
  onOpenSqlInEditor,
  onAskVeloxyAboutWidget,
}: DashboardCanvasProps) {
  const dashboardQuery = useDashboardQuery(dashboardId)
  const [draft, setDraft] = useState<Dashboard | null>(null)
  const [activeView, setActiveView] = useState<'logic' | 'app'>(() => {
    try {
      const saved = localStorage.getItem(`veloxdb.dashboard.view.${dashboardId}`)
      return saved === 'logic' ? 'logic' : 'app'
    } catch {
      return 'app'
    }
  })
  const [editMode, setEditMode] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [editingWidgetId, setEditingWidgetId] = useState<string | null>(null)
  const [variableValues, setVariableValues] = useState<Record<string, string>>({})
  const [activePageId, setActivePageId] = useState<string | null>(null)
  const initializedRef = useRef(false)

  const handleChangeView = (nextView: 'logic' | 'app') => {
    setActiveView(nextView)
    try {
      localStorage.setItem(`veloxdb.dashboard.view.${dashboardId}`, nextView)
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    initializedRef.current = false
    setDraft(null)
  }, [dashboardId])

  useEffect(() => {
    if (!dashboardQuery.data) return
    let migrated: Dashboard
    try {
      migrated = migrateDashboard(dashboardQuery.data)
    } catch {
      migrated = dashboardQuery.data
    }

    if (!initializedRef.current) {
      initializedRef.current = true
      setDraft(migrated)
      setVariableValues(buildVariableDefaults(migrated))
      return
    }
    setDraft((prev) => {
      if (!prev) return migrated
      if (migrated.updatedAt > prev.updatedAt) return migrated
      return prev
    })
  }, [dashboardQuery.data])

  useDashboardAutosave(draft)
  useDashboardRefresh(dashboardId, draft?.refreshIntervalSec ?? null)

  const widgetIsDark = draft ? resolveWidgetIsDark(draft, isDark) : isDark
  const editingWidget = editingWidgetId && draft ? draft.widgets[editingWidgetId] ?? null : null
  const pages = draft ? dashboardPages(draft) : []
  const pagedDraft = draft && activeView === 'app' ? filterDashboardToPage(draft, activePageId) : draft

  const handleDraftChange = (next: Dashboard) => setDraft(next)

  const handleAddNote = () => {
    const cellId = crypto.randomUUID()
    const noteCell = {
      id: cellId,
      type: 'markdown' as const,
      title: 'Note',
      content: 'Add a description or annotation here.',
      showInApp: true,
    }
    setDraft((prev) => {
      if (!prev) return prev
      const withNote = addCell(prev, noteCell)
      return assignWidgetToPage(withNote, activePageId ?? dashboardPages(withNote)[0].id, cellId)
    })
  }

  const handleDeleteWidget = (widgetId: string) => {
    const widget = draft?.widgets[widgetId]
    if (!widget) return
    if (!window.confirm(`Delete widget "${widget.title}"?`)) return
    setDraft((prev) => (prev ? deleteCell(prev, widgetId, { forceCascade: true }) : prev))
  }

  const handleDuplicateWidget = (widgetId: string) => {
    setDraft((prev) => (prev ? duplicateVisualCell(prev, widgetId) : prev))
  }

  const handleSaveWidget = (widget: Widget) => {
    setDraft((prev) => {
      if (!prev) return prev
      const cell = (prev.cells ?? []).find((c) => c.id === widget.id)
      if (cell && cell.type === 'visual') {
        let updated = updateCell(prev, widget.id, {
          title: widget.title,
          viz: widget.viz,
        })
        if (widget.query?.sql && cell.sourceCellId) {
          updated = updateCell(updated, cell.sourceCellId, {
            sql: widget.query.sql,
          })
        }
        return updated
      }
      if (cell && cell.type === 'markdown') {
        const content = typeof widget.viz?.options?.content === 'string'
          ? widget.viz.options.content
          : cell.content
        return updateCell(prev, widget.id, {
          title: widget.title,
          content,
          ...widget.viz?.options,
        })
      }
      return {
        ...prev,
        widgets: { ...prev.widgets, [widget.id]: widget },
        updatedAt: Date.now(),
      }
    })
  }

  /** Click-to-filter: set the variable to the clicked value, or restore its default when clicked again. */
  const handleFilter = (variableName: string, value: string) => {
    const variable = draft?.variables.find((v) => v.name === variableName)
    if (!variable) return
    setVariableValues((prev) => {
      const current = prev[variableName] ?? variable.defaultValue
      return { ...prev, [variableName]: current === value ? variable.defaultValue : value }
    })
  }

  const interactions: WidgetInteractions | undefined = draft
    ? {
        variables: draft.variables,
        onFilter: draft.variables.length > 0 ? handleFilter : undefined,
        onAskVeloxy: onAskVeloxyAboutWidget,
      }
    : undefined

  const handleSaveSettings = (patch: Pick<Dashboard, 'refreshIntervalSec' | 'theme' | 'variables'>) => {
    setDraft((prev) => {
      if (!prev) return prev
      const next = { ...prev, ...patch, updatedAt: Date.now() }
      setVariableValues(buildVariableDefaults(next))
      return next
    })
  }

  if (dashboardQuery.isLoading) {
    return <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">Loading dashboard…</div>
  }

  if (dashboardQuery.isError || (dashboardQuery.isSuccess && dashboardQuery.data === null) || !draft) {
    return (
      <DashboardEmptyState
        title="Dashboard not found"
        description="It may have been deleted. Pick another dashboard from the sidebar."
        actionLabel="Close"
        onAction={onClose}
      />
    )
  }

  const widgetCount = Object.keys(draft.widgets).length

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Button variant="ghost" size="icon-sm" onClick={onClose} title="Close dashboard">
            <XIcon />
          </Button>
          <div className="min-w-0 flex-1">
            <Input
              value={draft.name}
              onChange={(e) => setDraft((prev) => (prev ? { ...prev, name: e.target.value, updatedAt: Date.now() } : prev))}
              className="h-7 max-w-64 border-transparent bg-transparent px-0 text-sm font-medium shadow-none focus-visible:border-ring focus-visible:px-2"
            />
            <p className="truncate text-[10px] text-muted-foreground">{connection.name}</p>
          </div>
          {!connectionExists ? <DashboardConnectionWarning /> : null}
        </div>
        <div className="flex items-center gap-2">
          <DashboardToolbar
            activeView={activeView}
            onChangeView={handleChangeView}
            editMode={editMode}
            onToggleEditMode={() => setEditMode((prev) => !prev)}
            onAddChart={() => onOpenChartBuilder({ sql: '' })}
            onAddTable={() => onOpenChartBuilder({ sql: '', defaultChartType: 'table' })}
            onAddNote={handleAddNote}
            onAddPage={() => setDraft((prev) => (prev ? addDashboardPage(prev) : prev))}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenShare={() => setShareOpen(true)}
          />
        </div>
      </div>

      {activeView === 'app' && pages.length > 0 ? (
        <div className="flex shrink-0 items-center gap-1 border-b border-border px-4 py-1.5">
          {pages.map((page) => (
            <button
              key={page.id}
              type="button"
              className={`rounded-md px-2 py-1 text-xs ${
                (activePageId ?? pages[0]?.id) === page.id
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setActivePageId(page.id)}
            >
              {page.name}
            </button>
          ))}
        </div>
      ) : null}

      <VariablesBar
        variables={draft.variables}
        values={variableValues}
        onChange={(name, value) => setVariableValues((prev) => ({ ...prev, [name]: value }))}
        onClear={() => setVariableValues(buildVariableDefaults(draft))}
      />

      {activeView === 'logic' ? (
        <LogicView
          dashboardId={dashboardId}
          connectionId={draft.connectionId}
          draft={draft}
          isDark={widgetIsDark}
          variableValues={variableValues}
          onDraftChange={handleDraftChange}
          onOpenWidgetEditor={setEditingWidgetId}
        />
      ) : widgetCount === 0 ? (
        <DashboardEmptyState
          icon={<ChartBarIcon className="size-8" />}
          title="This dashboard is empty"
          description="Add a chart, or edit queries to build the dashboard."
          actionLabel="Add chart"
          onAction={() => onOpenChartBuilder({ sql: '' })}
          secondaryActionLabel="Edit queries"
          onSecondaryAction={() => handleChangeView('logic')}
        />
      ) : (
        <DashboardGrid
          dashboardId={dashboardId}
          draft={pagedDraft ?? draft}
          isDark={widgetIsDark}
          editMode={editMode}
          variableValues={variableValues}
          interactions={interactions}
          onDraftChange={handleDraftChange}
          onEditWidget={setEditingWidgetId}
          onDuplicateWidget={handleDuplicateWidget}
          onDeleteWidget={handleDeleteWidget}
          onToggleLock={(id) => setDraft((prev) => (prev ? toggleWidgetLock(prev, id) : prev))}
        />
      )}

      <DashboardSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        dashboard={draft}
        onSave={handleSaveSettings}
      />

      <ShareReportDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        dashboard={draft}
        variableValues={variableValues}
      />

      {editingWidget?.kind === 'text' ? (
        <NoteEditorDialog
          key={editingWidget.id}
          open={editingWidgetId !== null}
          onOpenChange={(open) => { if (!open) setEditingWidgetId(null) }}
          widget={editingWidget}
          variableValues={variableValues}
          onSave={handleSaveWidget}
        />
      ) : (
        <WidgetEditorDialog
          key={editingWidget?.id ?? 'none'}
          open={editingWidgetId !== null && editingWidget !== null}
          onOpenChange={(open) => { if (!open) setEditingWidgetId(null) }}
          widget={editingWidget}
          isDark={widgetIsDark}
          onSave={handleSaveWidget}
          onOpenSqlInEditor={onOpenSqlInEditor}
        />
      )}
    </div>
  )
}
