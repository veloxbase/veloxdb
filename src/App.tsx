import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  MoonIcon,
  PlayIcon,
  SidebarSimpleIcon,
  SunIcon,
} from '@phosphor-icons/react'

import { ErrorBoundary } from '@/components/ErrorBoundary'
import { useConnectionsQuery } from '@/features/connections/queries'
import { useConnectMutation, useActivateConnectionMutation } from '@/features/connections/queries'
import { ConnectionsSidebarTree } from '@/features/connections/components/ConnectionsSidebarTree'
import { ConnectionDialog } from '@/features/connections/components/ConnectionDialog'
import { CommandPalette } from '@/features/commands/components/CommandPalette'
import { ResultsGrid } from '@/features/queries/components/ResultsGrid'
import { SqlEditor } from '@/features/queries/components/SqlEditor'
import { useTablesQuery } from '@/features/tables/queries'
import { TablePropertiesDialog } from '@/features/schema/components/TablePropertiesDialog'
import { useTableSchemaQuery, useTablePropertiesQuery } from '@/features/schema/queries'
import {
  useExplainPlanMutation,
  useRunQueryMutation,
  useSaveResultEditsMutation,
} from '@/features/queries/queries'
import { ModelWorkspace } from '@/features/model/components/ModelWorkspace'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { ConnectionSummary, QueryResult, TableInfo } from '@/data/types'
import type { ResultEditPatch } from '@/features/queries/result-edits'

const DEFAULT_QUERY = `select table_schema, table_name
from information_schema.tables
where table_schema not in ('pg_catalog', 'information_schema')
order by table_schema, table_name
limit 100;`

const SIDEBAR_WIDTH_KEY = 'veloxdb.sidebarWidth'
const SIDEBAR_COLLAPSED_KEY = 'veloxdb.sidebarCollapsed'
const RESULTS_HEIGHT_KEY = 'veloxdb.resultsHeight'
const DEFAULT_SIDEBAR_WIDTH = 280
const MIN_SIDEBAR_WIDTH = 220
const MAX_SIDEBAR_WIDTH = 520
const DEFAULT_RESULTS_HEIGHT = 260
const MIN_RESULTS_HEIGHT = 160
const MIN_QUERY_HEIGHT = 180

function clampSidebarWidth(value: number) {
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, value))
}

function readSidebarWidth() {
  const value = Number(window.localStorage.getItem(SIDEBAR_WIDTH_KEY))
  return Number.isFinite(value) ? clampSidebarWidth(value) : DEFAULT_SIDEBAR_WIDTH
}

function readSidebarCollapsed() {
  return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true'
}

function readResultsHeight() {
  const value = Number(window.localStorage.getItem(RESULTS_HEIGHT_KEY))
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_RESULTS_HEIGHT
}

function App() {
  const [connection, setConnection] = useState<ConnectionSummary | null>(null)
  const [query, setQuery] = useState(DEFAULT_QUERY)
  const [lastQuery, setLastQuery] = useState('')
  const [tableSearch, setTableSearch] = useState('')
  const [selectedTable, setSelectedTable] = useState<TableInfo | null>(null)
  const [isDark, setIsDark] = useState(() =>
    window.matchMedia('(prefers-color-scheme: dark)').matches,
  )
  const [connectionDialogOpen, setConnectionDialogOpen] = useState(false)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(readSidebarCollapsed)
  const [sidebarWidth, setSidebarWidth] = useState(readSidebarWidth)
  const [resultsHeight, setResultsHeight] = useState(readResultsHeight)
  const [tablePropertiesDialogOpen, setTablePropertiesDialogOpen] = useState(false)
  const [tablePropertiesTarget, setTablePropertiesTarget] = useState<{
    connectionId: string
    table: TableInfo
  } | null>(null)
  const [mainWorkspace, setMainWorkspace] = useState<'query' | 'model'>('query')
  const [resultsTab, setResultsTab] = useState<'results' | 'plan'>('results')
  const [planResult, setPlanResult] = useState<QueryResult | null>(null)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark)
  }, [isDark])

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(isSidebarCollapsed))
  }, [isSidebarCollapsed])

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth))
  }, [sidebarWidth])

  useEffect(() => {
    window.localStorage.setItem(RESULTS_HEIGHT_KEY, String(resultsHeight))
  }, [resultsHeight])

  const connectionsQuery = useConnectionsQuery()

  const runQueryMutation = useRunQueryMutation({
    onSuccess: (_result, variables) => {
      setLastQuery(variables.sql)
      setResultsTab('results')
      setPlanResult(null)
    },
  })

  const explainPlanMutation = useExplainPlanMutation({
    onSuccess: (result) => {
      setPlanResult(result)
      setResultsTab('plan')
    },
  })

  const connectMutation = useConnectMutation({
    onSuccess: (nextConnection) => {
      setConnection(nextConnection)
      setSelectedTable(null)
      setTableSearch('')
      setIsSidebarCollapsed(false)
      setConnectionDialogOpen(false)
      runQueryMutation.reset()
      explainPlanMutation.reset()
      setPlanResult(null)
      setResultsTab('results')
      setTablePropertiesDialogOpen(false)
      setTablePropertiesTarget(null)
    },
  })

  const activateConnectionMutation = useActivateConnectionMutation({
    onSuccess: (nextConnection) => {
      setConnection(nextConnection)
      setSelectedTable(null)
      setTableSearch('')
      runQueryMutation.reset()
      explainPlanMutation.reset()
      setPlanResult(null)
      setResultsTab('results')
      setTablePropertiesDialogOpen(false)
      setTablePropertiesTarget(null)
    },
  })

  const tablesQuery = useTablesQuery(connection?.id)

  const schemaQuery = useTableSchemaQuery({
    connectionId: connection?.id,
    table: selectedTable,
    enabled: Boolean(connection?.id && selectedTable),
  })
  const tablePropertiesQuery = useTablePropertiesQuery({
    connectionId: connection?.id,
    table: selectedTable,
    enabled: Boolean(connection?.id && selectedTable),
  })
  const saveResultEditsMutation = useSaveResultEditsMutation()

  const connectionsErrorMessage =
    connectionsQuery.error instanceof Error
      ? connectionsQuery.error.message
      : 'Failed to load saved connections'

  const tablesErrorMessage =
    tablesQuery.error instanceof Error
      ? tablesQuery.error.message
      : 'Failed to load tables'

  const schemaErrorMessage =
    schemaQuery.error instanceof Error
      ? schemaQuery.error.message
      : 'Failed to load table schema'
  const tablePropertiesErrorMessage =
    tablePropertiesQuery.error instanceof Error
      ? tablePropertiesQuery.error.message
      : 'Failed to load table properties'

  const tablesForUi = tablesQuery.data ?? []

  const handleRunQuery = (nextQuery?: string) => {
    if (!connection?.id) {
      setConnectionDialogOpen(true)
      return
    }

    const sql = (nextQuery ?? query).trim()
    if (!sql) {
      return
    }

    runQueryMutation.mutate({
      connectionId: connection.id,
      sql,
    })
  }

  const handleExplainPlan = () => {
    if (!connection?.id) {
      setConnectionDialogOpen(true)
      return
    }
    const sql = query.trim()
    if (!sql) return
    explainPlanMutation.mutate({ connectionId: connection.id, sql })
  }

  const handleSelectTable = (table: TableInfo) => {
    setSelectedTable(table)
    setQuery(table.previewQuery)
    handleRunQuery(table.previewQuery)
  }

  const handleOpenTableProperties = (connectionId: string, table: TableInfo) => {
    setTablePropertiesTarget({ connectionId, table })
    setTablePropertiesDialogOpen(true)
  }

  const handleSelectConnection = (nextConnection: ConnectionSummary) => {
    if (connection?.id === nextConnection.id) {
      return
    }

    activateConnectionMutation.mutate(nextConnection.id)
  }

  const handleSidebarResizeStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    const startX = event.clientX
    const startWidth = sidebarWidth

    const handlePointerMove = (moveEvent: PointerEvent) => {
      setSidebarWidth(clampSidebarWidth(startWidth + moveEvent.clientX - startX))
    }

    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
  }

  const resultsLayoutRef = useRef<HTMLDivElement | null>(null)

  const clampResultsHeight = (value: number) => {
    const containerHeight = resultsLayoutRef.current?.getBoundingClientRect().height
    const maxResultsHeight = containerHeight
      ? Math.max(MIN_RESULTS_HEIGHT, containerHeight - MIN_QUERY_HEIGHT - 8)
      : Math.max(MIN_RESULTS_HEIGHT, window.innerHeight - MIN_QUERY_HEIGHT - 8)

    return Math.min(maxResultsHeight, Math.max(MIN_RESULTS_HEIGHT, value))
  }

  const handleResultsResizeStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    const startY = event.clientY
    const startHeight = resultsHeight

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const deltaY = moveEvent.clientY - startY
      // Splitter sits above the results panel: moving the handle up (negative deltaY) grows the bottom section.
      setResultsHeight(clampResultsHeight(startHeight - deltaY))
    }

    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const commandKey = event.metaKey || event.ctrlKey

      if (commandKey && event.key.toLowerCase() === 'p') {
        event.preventDefault()
        setCommandPaletteOpen(true)
      }

      if (commandKey && event.shiftKey && event.key.toLowerCase() === 'c') {
        event.preventDefault()
        setConnectionDialogOpen(true)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const layoutStyle = {
    '--sidebar-width': `${isSidebarCollapsed ? 0 : sidebarWidth}px`,
  } as CSSProperties

  const connectionError = connectMutation.error ?? activateConnectionMutation.error
  const connectionErrorMessage =
    connectionError instanceof Error ? connectionError.message : 'Failed to connect'
  const runQueryErrorMessage =
    runQueryMutation.error instanceof Error ? runQueryMutation.error.message : 'Failed to run query'
  const explainPlanErrorMessage =
    explainPlanMutation.error instanceof Error
      ? explainPlanMutation.error.message
      : 'Failed to run EXPLAIN'
  const saveResultEditsErrorMessage =
    saveResultEditsMutation.error instanceof Error
      ? saveResultEditsMutation.error.message
      : 'Failed to save edited rows'
  const primaryKeyColumns =
    tablePropertiesQuery.data?.filter((column) => column.isPrimaryKey).map((column) => column.columnName) ?? []
  const editableColumns =
    tablePropertiesQuery.data?.filter((column) => !column.isPrimaryKey).map((column) => column.columnName) ?? []
  const hasSelectedTable = Boolean(selectedTable)
  const hasQueryResult = Boolean(runQueryMutation.data?.columns.length)
  const hasPrimaryKey = primaryKeyColumns.length > 0
  const isResultSingleTableEditable =
    hasSelectedTable && hasQueryResult && hasPrimaryKey && !tablePropertiesQuery.isError
  const saveDisabledReason = !hasSelectedTable
    ? 'Select a table to enable row editing.'
    : !hasQueryResult
      ? 'Run a query to edit rows.'
      : tablePropertiesQuery.isLoading
        ? 'Loading table metadata...'
        : tablePropertiesQuery.isError
          ? tablePropertiesErrorMessage
          : !hasPrimaryKey
            ? 'Editing requires a primary key on the selected table.'
            : undefined

  const handleSaveResultEdits = async (patches: ResultEditPatch[]) => {
    if (!selectedTable || !connection?.id || patches.length === 0) {
      return
    }

    await saveResultEditsMutation.mutateAsync({
      connectionId: connection.id,
      table: selectedTable,
      patches,
    })

    handleRunQuery(lastQuery || query)
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground" style={layoutStyle}>
      {!isSidebarCollapsed ? (
        <>
          <div className="min-w-0 shrink-0" style={{ width: 'var(--sidebar-width)' }}>
            <ErrorBoundary
              fallback={
                <div className="px-3 py-4 text-xs text-destructive">Sidebar failed to render.</div>
              }
            >
              {connectionsQuery.isError ? (
                <div className="px-3 py-4 text-xs text-destructive">{connectionsErrorMessage}</div>
              ) : (
                <ConnectionsSidebarTree
                  activeConnection={connection}
                  connections={connectionsQuery.data ?? []}
                  tables={tablesForUi}
                  tablesErrorMessage={tablesQuery.isError ? tablesErrorMessage : undefined}
                  selectedTable={selectedTable}
                  search={tableSearch}
                  isConnectionsLoading={connectionsQuery.isLoading}
                  isTablesLoading={tablesQuery.isLoading}
                  isActivatingConnection={activateConnectionMutation.isPending}
                  onSearchChange={setTableSearch}
                  onOpenConnection={() => setConnectionDialogOpen(true)}
                  onSelectConnection={handleSelectConnection}
                  onSelectTable={handleSelectTable}
                  onOpenTableProperties={handleOpenTableProperties}
                  onToggleCollapsed={() => setIsSidebarCollapsed(true)}
                />
              )}
            </ErrorBoundary>
          </div>
          <div
            className="w-1 shrink-0 cursor-col-resize border-r border-border bg-muted/20 transition hover:bg-muted/60"
            onPointerDown={handleSidebarResizeStart}
            title="Resize sidebar"
          />
        </>
      ) : null}

      <main className="grid min-w-0 flex-1 grid-rows-[auto_minmax(0,1fr)]">
        <header className="min-w-0 shrink-0 overflow-x-auto border-b border-border">
          <div className="flex min-w-full w-max items-center justify-between gap-4 px-5 py-3">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              {isSidebarCollapsed ? (
                <Button
                  variant="outline"
                  size="icon-sm"
                  className="shrink-0"
                  onClick={() => setIsSidebarCollapsed(false)}
                  aria-label="Open sidebar"
                >
                  <SidebarSimpleIcon />
                </Button>
              ) : null}

              <Tabs
                value={mainWorkspace}
                onValueChange={(value) => setMainWorkspace(value as 'query' | 'model')}
                className="shrink-0"
              >
                <TabsList variant="line" className="h-8">
                  <TabsTrigger value="query" className="px-2.5 text-xs">
                    Query
                  </TabsTrigger>
                  <TabsTrigger value="model" className="px-2.5 text-xs">
                    Model
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
                  VeloxDB.dev
                </p>
                <p className="truncate text-sm text-foreground">
                  {connection
                    ? `Connected to ${connection.database} on ${connection.host}:${connection.port}`
                    : 'Choose a saved connection or create a new one to start querying'}
                </p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCommandPaletteOpen(true)}
              >
                <SidebarSimpleIcon />
                Palette
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsDark((current) => !current)}
              >
                {isDark ? <SunIcon /> : <MoonIcon />}
                {isDark ? 'Light' : 'Dark'}
              </Button>
              {mainWorkspace === 'query' ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleExplainPlan()}
                    disabled={explainPlanMutation.isPending}
                  >
                    Explain (analyze)
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => handleRunQuery()}
                    disabled={runQueryMutation.isPending}
                  >
                    <PlayIcon />
                    Run query
                  </Button>
                </>
              ) : null}
            </div>
          </div>
        </header>

        {mainWorkspace === 'query' ? (
          <div ref={resultsLayoutRef} className="flex min-h-0 min-w-0 flex-col">
            <section className="min-h-0 min-w-0 flex-1">
              <Tabs value="query-1" className="flex h-full min-w-0 flex-col gap-0">
                <div className="min-w-0 overflow-x-auto border-b border-border">
                  <div className="flex min-w-full w-max items-center justify-between gap-3 px-3 py-2">
                    <TabsList variant="line" className="shrink-0">
                      <TabsTrigger value="query-1">Query 1</TabsTrigger>
                    </TabsList>
                    <div className="shrink-0 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                      Cmd/Ctrl + Enter
                    </div>
                  </div>
                </div>

                <TabsContent value="query-1" className="min-h-0 flex-1">
                  <SqlEditor
                    value={query}
                    isDark={isDark}
                    onChange={setQuery}
                    onRun={() => handleRunQuery()}
                  />
                </TabsContent>
              </Tabs>
            </section>

            <div
              className="h-1 cursor-row-resize border-y border-border bg-muted/10 hover:bg-muted/30"
              onPointerDown={handleResultsResizeStart}
              title="Resize results"
            />

            <section
              className="min-h-0 min-w-0 h-full overflow-hidden"
              style={{ height: `${resultsHeight}px` }}
            >
              <Tabs
                value={resultsTab}
                onValueChange={(v) => setResultsTab(v as 'results' | 'plan')}
                className="flex h-full min-h-0 flex-col"
              >
                <div className="min-w-0 shrink-0 overflow-x-auto border-b border-border">
                  <div className="flex min-w-full w-max flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <TabsList variant="line" className="h-8">
                        <TabsTrigger value="results" className="text-xs">
                          Results
                        </TabsTrigger>
                        <TabsTrigger value="plan" className="text-xs">
                          Explain plan
                        </TabsTrigger>
                      </TabsList>
                      <p className="mt-1 truncate text-sm text-foreground">
                        {resultsTab === 'plan'
                          ? 'EXPLAIN (ANALYZE, BUFFERS) output'
                          : selectedTable
                            ? `${selectedTable.schema}.${selectedTable.name}`
                            : 'Current query output'}
                      </p>
                    </div>

                    <div className="shrink-0 text-right text-xs text-muted-foreground whitespace-nowrap">
                      {resultsTab === 'plan' ? (
                        <span>
                          {planResult
                            ? `${planResult.rowCount} plan lines in ${planResult.executionMs} ms`
                            : explainPlanMutation.isPending
                              ? 'Running EXPLAIN…'
                              : 'Run Explain (analyze) from the header'}
                        </span>
                      ) : schemaQuery.isLoading ? (
                        <span>Loading columns...</span>
                      ) : schemaQuery.isError ? (
                        <span className="text-destructive">{schemaErrorMessage}</span>
                      ) : schemaQuery.data?.length ? (
                        <span>{schemaQuery.data.length} columns in selected table</span>
                      ) : (
                        <span>
                          {runQueryMutation.data
                            ? `${runQueryMutation.data.rowCount} rows in ${runQueryMutation.data.executionMs} ms`
                            : 'No query executed yet'}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <TabsContent value="results" className="m-0 min-h-0 flex-1 data-[state=inactive]:hidden">
                  <ErrorBoundary
                    fallback={
                      <div className="flex h-full items-center justify-center p-4 text-xs text-destructive">
                        Results failed to render.
                      </div>
                    }
                  >
                    <ResultsGrid
                      result={runQueryMutation.data ?? null}
                      isPending={runQueryMutation.isPending}
                      isSaving={saveResultEditsMutation.isPending}
                      canEdit={isResultSingleTableEditable}
                      editableColumns={editableColumns}
                      primaryKeyColumns={primaryKeyColumns}
                      saveDisabledReason={saveDisabledReason}
                      onRefresh={() => handleRunQuery(lastQuery || query)}
                      onSaveEdits={handleSaveResultEdits}
                    />
                  </ErrorBoundary>
                </TabsContent>

                <TabsContent value="plan" className="m-0 min-h-0 flex-1 data-[state=inactive]:hidden">
                  <ErrorBoundary
                    fallback={
                      <div className="flex h-full items-center justify-center p-4 text-xs text-destructive">
                        Explain output failed to render.
                      </div>
                    }
                  >
                    <ResultsGrid
                      result={planResult}
                      isPending={explainPlanMutation.isPending}
                      isSaving={false}
                      canEdit={false}
                      editableColumns={[]}
                      primaryKeyColumns={[]}
                      saveDisabledReason="Editing is not available for EXPLAIN output."
                      onRefresh={() => handleExplainPlan()}
                      onSaveEdits={async () => {}}
                    />
                  </ErrorBoundary>
                </TabsContent>
              </Tabs>

              {(resultsTab === 'results' && runQueryMutation.data?.truncated) ||
              (resultsTab === 'plan' && planResult?.truncated) ? (
                <div className="border-t border-border bg-muted/20 px-5 py-2 text-xs text-muted-foreground">
                  Output was truncated to keep the UI responsive.
                </div>
              ) : null}

              {connectionError ? (
                <div className="border-t border-border bg-destructive/10 px-5 py-2 text-xs text-destructive">
                  {connectionErrorMessage}
                </div>
              ) : null}

              {runQueryMutation.error ? (
                <div className="border-t border-border bg-destructive/10 px-5 py-2 text-xs text-destructive">
                  {runQueryErrorMessage}
                </div>
              ) : null}

              {explainPlanMutation.error ? (
                <div className="border-t border-border bg-destructive/10 px-5 py-2 text-xs text-destructive">
                  {explainPlanErrorMessage}
                </div>
              ) : null}

              {saveResultEditsMutation.error ? (
                <div className="border-t border-border bg-destructive/10 px-5 py-2 text-xs text-destructive">
                  {saveResultEditsErrorMessage}
                </div>
              ) : null}
            </section>
          </div>
        ) : connection?.id ? (
          <ModelWorkspace
            key={connection.id}
            connectionId={connection.id}
            defaultDatabaseName={connection.database}
            isDark={isDark}
            tables={tablesForUi}
            tablesErrorMessage={tablesQuery.isError ? tablesErrorMessage : undefined}
            isTablesLoading={tablesQuery.isLoading}
            selectedTable={selectedTable}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
            Connect to a database to use the model workspace.
          </div>
        )}
      </main>

      <ConnectionDialog
        open={connectionDialogOpen}
        onOpenChange={setConnectionDialogOpen}
        onSubmit={async (values) => {
          await connectMutation.mutateAsync(values)
        }}
        isPending={connectMutation.isPending}
      />

      <TablePropertiesDialog
        open={tablePropertiesDialogOpen}
        onOpenChange={(nextOpen) => {
          setTablePropertiesDialogOpen(nextOpen)
          if (!nextOpen) setTablePropertiesTarget(null)
        }}
        connectionId={tablePropertiesTarget?.connectionId}
        table={tablePropertiesTarget?.table ?? null}
      />

      <CommandPalette
        open={commandPaletteOpen}
        onOpenChange={setCommandPaletteOpen}
        tables={tablesForUi}
        hasLastQuery={Boolean(lastQuery)}
        onOpenConnection={() => setConnectionDialogOpen(true)}
        onRunLastQuery={() => {
          if (lastQuery) {
            setQuery(lastQuery)
            handleRunQuery(lastQuery)
          }
        }}
        onSelectTable={handleSelectTable}
      />
    </div>
  )
}

export default App
