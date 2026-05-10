import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react'
import {
  ArrowsClockwiseIcon,
  CaretDownIcon,
  CaretRightIcon,
  DatabaseIcon,
  HardDriveIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  SidebarSimpleIcon,
  SpinnerGapIcon,
  TableIcon,
  TrashIcon,
} from '@phosphor-icons/react'

import type { ConnectionSummary, TableInfo } from '@/data/types'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { TreeView, type TreeDataItem } from '@/components/ui/tree-view'
import type { TableQuickSqlAction } from '@/features/queries/table-quick-actions'
import { useTableSchemaQuery } from '@/features/schema/queries'
import { useConnectionHealth } from '@/features/connections/use-connection-health'
import { useDatabasesQuery, useSwitchDatabaseMutation } from '@/features/connections/queries'
import { readExpandedIds, writeExpandedIds } from '@/lib/tree-expanded-persistence'

type ConnectionContextMenuTarget = {
  kind: 'connection'
  connection: ConnectionSummary
}

type TableContextMenuTarget = {
  kind: 'table'
  connectionId: string
  table: TableInfo
  onToggleExpanded?: () => void
  isExpanded?: boolean
}

type DatabaseContextMenuTarget = {
  kind: 'database'
  connectionId: string
  database: string
}

type SidebarContextMenuTarget = ConnectionContextMenuTarget | TableContextMenuTarget | DatabaseContextMenuTarget

type ConnectionContextMenuActionId =
  | 'toggleConnection'
  | 'refreshConnection'
  | 'renameConnection'
  | 'disconnectConnection'
  | 'copyConnectionString'

type TableContextMenuActionId =
  | 'selectTable'
  | 'toggleFields'
  | 'refreshTable'
  | 'renameTable'
  | 'deleteTable'
  | 'selectAll'
  | 'selectCount'
  | 'insertTemplate'
  | 'updateTemplate'
  | 'deleteTemplate'
  | 'addRow'
  | 'tableProperties'
  | 'copyTableName'
  | 'truncateTable'

type DatabaseContextMenuActionId =
  | 'refreshDatabases'
  | 'copyDatabaseName'

type ContextMenuAction = {
  id: ConnectionContextMenuActionId | TableContextMenuActionId | DatabaseContextMenuActionId
  label: string
  group: 'primary' | 'secondary' | 'danger'
  disabled?: boolean
}

type TableSearchNeedles = {
  fullNeedleLower: string
  schemaNeedleLower: string
  tableNeedleLower: string
}

function getTableSearchNeedles(search: string): TableSearchNeedles {
  const fullNeedleLower = search.trim().toLowerCase()

  const dotIndex = fullNeedleLower.indexOf('.')
  if (dotIndex === -1) {
    return {
      fullNeedleLower,
      schemaNeedleLower: fullNeedleLower,
      tableNeedleLower: fullNeedleLower,
    }
  }

  return {
    fullNeedleLower,
    schemaNeedleLower: fullNeedleLower.slice(0, dotIndex),
    tableNeedleLower: fullNeedleLower.slice(dotIndex + 1),
  }
}

function highlightText(text: string, needleLower: string): ReactNode {
  if (!needleLower) return text

  const lower = text.toLowerCase()
  const parts: ReactNode[] = []

  let start = 0
  let keyIndex = 0

  while (true) {
    const idx = lower.indexOf(needleLower, start)
    if (idx === -1) {
      parts.push(<span key={keyIndex++}>{text.slice(start)}</span>)
      break
    }
    if (idx > start) {
      parts.push(<span key={keyIndex++}>{text.slice(start, idx)}</span>)
    }
    parts.push(
      <mark key={keyIndex++} className="bg-yellow-200 text-foreground rounded-sm px-0.5">
        {text.slice(idx, idx + needleLower.length)}
      </mark>,
    )
    start = idx + needleLower.length
  }

  return <>{parts}</>
}

function isConnectionContextMenuTarget(
  target: SidebarContextMenuTarget,
): target is ConnectionContextMenuTarget {
  return target.kind === 'connection'
}

function isDatabaseContextMenuTarget(
  target: SidebarContextMenuTarget,
): target is DatabaseContextMenuTarget {
  return target.kind === 'database'
}

type ConnectionsSidebarTreeProps = {
  activeConnection: ConnectionSummary | null
  connections: ConnectionSummary[]
  tables: TableInfo[]
  selectedTable: TableInfo | null
  search: string
  tablesErrorMessage?: string
  isConnectionsLoading?: boolean
  isTablesLoading?: boolean
  isActivatingConnection?: boolean
  onSearchChange: (value: string) => void
  onOpenConnection: () => void
  onSelectConnection: (connection: ConnectionSummary) => void
  onSelectTable: (table: TableInfo) => void
  onTableQuickAction: (
    action: TableQuickSqlAction,
    connectionId: string,
    table: TableInfo,
  ) => void | Promise<void>
  onRefreshConnection: (connection: ConnectionSummary) => void | Promise<void>
  onRefreshTable: (connectionId: string, table: TableInfo) => void | Promise<void>
  onRenameConnection?: (connection: ConnectionSummary) => void | Promise<void>
  onDisconnectConnection?: (connection: ConnectionSummary) => void | Promise<void>
  onRenameTable?: (connectionId: string, table: TableInfo) => void | Promise<void>
  onDeleteTable?: (connectionId: string, table: TableInfo) => void | Promise<void>
  onTruncateTable?: (connectionId: string, table: TableInfo) => void | Promise<void>
  onCopyTableName?: (connectionId: string, table: TableInfo) => void
  onRefreshDatabases?: (connectionId: string) => void | Promise<void>
  onCopyDatabaseName?: (connectionId: string, database: string) => void
  onCopyConnectionString?: (connection: ConnectionSummary) => void
  onToggleCollapsed: () => void
}

type TableTreeItemProps = {
  connectionId: string
  table: TableInfo
  level: number
  isExpanded: boolean
  isSelected: boolean
  highlightSchemaNeedleLower: string
  highlightTableNeedleLower: string
  onSelectTable: (table: TableInfo) => void
  onToggleExpanded: () => void
  onOpenContextMenu: (
    event: ReactMouseEvent<HTMLButtonElement>,
    target: TableContextMenuTarget,
  ) => void
}

const EMPTY_CONNECTIONS: ConnectionSummary[] = []
const EMPTY_TABLES: TableInfo[] = []

const TableTreeItem = memo(function TableTreeItem({
  connectionId,
  table,
  level,
  isExpanded,
  isSelected,
  highlightSchemaNeedleLower,
  highlightTableNeedleLower,
  onSelectTable,
  onToggleExpanded,
  onOpenContextMenu,
}: TableTreeItemProps) {
  const schemaQuery = useTableSchemaQuery({ connectionId, table, enabled: isExpanded })

  const errorMessage = schemaQuery.error instanceof Error ? schemaQuery.error.message : 'Failed to load fields'

  return (
    <div>
      <div
        className={cn(
          'group flex w-full items-stretch text-left text-xs transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
          isSelected && 'bg-emerald-500/10 text-emerald-600',
        )}
      >
        <button
          type="button"
          className="flex min-w-0 flex-1 items-start gap-2 px-3 py-1.5"
          style={{ paddingLeft: `${20 + level * 16}px` }}
          onClick={() => onSelectTable(table)}
          onContextMenu={(event) => {
            onOpenContextMenu(event, {
              kind: 'table',
              connectionId,
              table,
              onToggleExpanded,
              isExpanded,
            })
          }}
          onDoubleClick={(event) => {
            onOpenContextMenu(event, {
              kind: 'table',
              connectionId,
              table,
              onToggleExpanded,
              isExpanded,
            })
          }}
        >
          <TableIcon className={cn(
            'size-3.5 shrink-0',
            isSelected ? 'text-emerald-500' : 'text-sidebar-foreground/60',
          )} />
          <div className="min-w-0 truncate">
            <span className="font-medium">
              {highlightText(table.name, highlightTableNeedleLower)}
            </span>
            <span className="text-[11px] text-sidebar-foreground/60">
              ({highlightText(table.schema, highlightSchemaNeedleLower)})
            </span>
          </div>
        </button>
      </div>

      {isExpanded ? (
        <div className="ml-5 border-l border-sidebar-border/60 py-1.5 pl-2 pr-0.5">
          {schemaQuery.isLoading ? (
            <div className="flex items-center gap-2 py-1 text-[11px] text-sidebar-foreground/60">
              <SpinnerGapIcon className="size-3 animate-spin" />
              Loading fields...
            </div>
          ) : null}

          {schemaQuery.isError ? (
            <div className="py-1 text-[11px] text-destructive">{errorMessage}</div>
          ) : null}

          {schemaQuery.data?.length ? (
            <div className="max-h-[170px] space-y-1 overflow-auto pr-1">
              {schemaQuery.data.map((column) => (
                <div
                  key={`${column.tableSchema}.${column.tableName}.${column.columnName}`}
                  className="grid grid-cols-[10px_minmax(0,1fr)] items-start gap-2 rounded-sm px-1 py-1 text-[11px]"
                >
                  <span className="mt-[5px] size-1.5 rounded-full bg-sidebar-foreground/45" />
                  <div className="min-w-0">
                    <div className="truncate text-sidebar-foreground">{column.columnName}</div>
                    <div className="truncate text-sidebar-foreground/60">
                      {column.dataType}
                      {column.isNullable ? ' nullable' : ' not null'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
})

export function ConnectionsSidebarTree({
  activeConnection,
  connections = EMPTY_CONNECTIONS,
  tables = EMPTY_TABLES,
  selectedTable,
  search,
  tablesErrorMessage,
  isConnectionsLoading = false,
  isTablesLoading = false,
  isActivatingConnection = false,
  onSearchChange,
  onOpenConnection,
  onSelectConnection,
  onSelectTable,
  onTableQuickAction,
  onRefreshConnection,
  onRefreshTable,
  onDisconnectConnection,
  onRenameTable,
  onDeleteTable,
  onTruncateTable,
  onCopyTableName,
  onRefreshDatabases,
  onCopyDatabaseName,
  onCopyConnectionString,
  onToggleCollapsed,
}: ConnectionsSidebarTreeProps) {
  const [isTablesPanelExpanded, setIsTablesPanelExpanded] = useState(true)
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    target: SidebarContextMenuTarget
  } | null>(null)
  const contextMenuRef = useRef<HTMLDivElement | null>(null)
  const pendingSelectTimeoutRef = useRef<number | null>(null)
  const activeConnectionId = activeConnection?.id ?? null
  const databasesQuery = useDatabasesQuery(activeConnectionId)
  const switchDatabaseMutation = useSwitchDatabaseMutation()
  const activeTableKey =
    activeConnectionId && selectedTable
      ? `${activeConnectionId}:${selectedTable.schema}.${selectedTable.name}`
      : null

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  const persistScope = activeConnectionId ?? 'default'

  useEffect(() => {
    const ids = readExpandedIds(persistScope)
    if (ids.length) {
      setExpandedIds(new Set(ids))
    } else if (activeConnectionId && activeConnection) {
      const defaultExpanded = [`db-${activeConnection.id}-${activeConnection.database}`]
      setExpandedIds(new Set(defaultExpanded))
      writeExpandedIds(persistScope, defaultExpanded)
    }
  }, [persistScope, activeConnectionId, activeConnection])

  const handleExpandedChange = useCallback(
    (ids: string[]) => {
      setExpandedIds(new Set(ids))
      writeExpandedIds(persistScope, ids)
    },
    [persistScope],
  )

  const { fullNeedleLower, schemaNeedleLower, tableNeedleLower } = useMemo(
    () => getTableSearchNeedles(search),
    [search],
  )
  const isSearching = Boolean(fullNeedleLower)

  const tablesWithSearchKeyLower = useMemo(
    () =>
      tables.map((table) => ({
        table,
        searchKeyLower: `${table.schema}.${table.name}`.toLowerCase(),
      })),
    [tables],
  )

  const filteredTablesWithKeys = useMemo(() => {
    if (!fullNeedleLower) return tablesWithSearchKeyLower
    return tablesWithSearchKeyLower.filter((entry) => entry.searchKeyLower.includes(fullNeedleLower))
  }, [fullNeedleLower, tablesWithSearchKeyLower])

  const openSidebarContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLElement>, target: SidebarContextMenuTarget) => {
      event.preventDefault()
      event.stopPropagation()

      const padding = 8
      const assumedMenuWidth = 280
      const assumedMenuHeight = 420
      const maxX = Math.max(padding, window.innerWidth - assumedMenuWidth - padding)
      const maxY = Math.max(padding, window.innerHeight - assumedMenuHeight - padding)

      setContextMenu({
        x: Math.min(Math.max(padding, event.clientX), maxX),
        y: Math.min(Math.max(padding, event.clientY), maxY),
        target,
      })
    },
    [],
  )

  useEffect(() => {
    if (!contextMenu) return

    const onPointerDown = (event: PointerEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(event.target as Node)) {
        setContextMenu(null)
      }
    }

    window.addEventListener('pointerdown', onPointerDown, true)
    return () => window.removeEventListener('pointerdown', onPointerDown, true)
  }, [contextMenu])

  const scheduleSelectConnection = useCallback(
    (connection: ConnectionSummary) => {
      cancelPendingSelect()
      pendingSelectTimeoutRef.current = window.setTimeout(() => {
        onSelectConnection(connection)
        setIsTablesPanelExpanded(true)
      }, 160)
    },
    [onSelectConnection],
  )

  const cancelPendingSelect = useCallback(() => {
    if (pendingSelectTimeoutRef.current != null) {
      window.clearTimeout(pendingSelectTimeoutRef.current)
      pendingSelectTimeoutRef.current = null
    }
  }, [])

  const visibleConnections = useMemo(() => {
    if (connections.length <= 5) return connections
    return connections
  }, [connections])

  const connectionContextMenuActions = useMemo<ContextMenuAction[]>(
    () => [
      { id: 'copyConnectionString', label: 'Copy connection string', group: 'primary' },
      { id: 'refreshConnection', label: 'Refresh', group: 'secondary' },
      { id: 'disconnectConnection', label: 'Delete', group: 'danger' },
    ],
    [],
  )

  const tableContextMenuActions = useMemo<ContextMenuAction[]>(
    () => [
      { id: 'selectTable', label: 'Select table', group: 'primary' },
      { id: 'toggleFields', label: 'Toggle fields', group: 'primary' },
      { id: 'copyTableName', label: 'Copy name', group: 'primary' },
      { id: 'refreshTable', label: 'Refresh', group: 'secondary' },
      { id: 'renameTable', label: 'Rename', group: 'secondary' },
      { id: 'selectAll', label: 'SELECT * (LIMIT)', group: 'secondary' },
      { id: 'selectCount', label: 'SELECT COUNT(*)', group: 'secondary' },
      { id: 'insertTemplate', label: 'INSERT template', group: 'secondary' },
      { id: 'updateTemplate', label: 'UPDATE template', group: 'secondary' },
      { id: 'deleteTemplate', label: 'DELETE template', group: 'secondary' },
      { id: 'addRow', label: 'Add row', group: 'secondary' },
      { id: 'tableProperties', label: 'Properties', group: 'secondary' },
      { id: 'truncateTable', label: 'Truncate', group: 'danger' },
      { id: 'deleteTable', label: 'Delete table', group: 'danger' },
    ],
    [],
  )

  const databaseContextMenuActions = useMemo<ContextMenuAction[]>(
    () => [
      { id: 'refreshDatabases', label: 'Refresh databases', group: 'primary' },
      { id: 'copyDatabaseName', label: 'Copy name', group: 'primary' },
    ],
    [],
  )

  const handleContextMenuAction = useCallback(
    (action: string) => {
      if (!contextMenu) return

      if (isConnectionContextMenuTarget(contextMenu.target)) {
        const { connection } = contextMenu.target

        switch (action) {
          case 'copyConnectionString':
            void navigator.clipboard.writeText(
              `postgresql://${connection.user}@${connection.host}:${connection.port}/${connection.database}`,
            )
            break
          case 'refreshConnection':
            void onRefreshConnection(connection)
            break
          case 'disconnectConnection':
            if (onDisconnectConnection) {
              void onDisconnectConnection(connection)
            }
            break
          default:
            break
        }
      } else if (isDatabaseContextMenuTarget(contextMenu.target)) {
        const { connectionId, database } = contextMenu.target

        switch (action) {
          case 'refreshDatabases':
            if (onRefreshDatabases) {
              void onRefreshDatabases(connectionId)
            }
            break
          case 'copyDatabaseName':
            if (onCopyDatabaseName) {
              onCopyDatabaseName(connectionId, database)
            }
            break
          default:
            break
        }
      } else {
        const { connectionId, table, onToggleExpanded } = contextMenu.target

        switch (action) {
          case 'selectTable':
            onSelectTable(table)
            break
          case 'toggleFields':
            onToggleExpanded?.()
            break
          case 'copyTableName':
            if (onCopyTableName) {
              onCopyTableName(connectionId, table)
            }
            break
          case 'refreshTable':
            void onRefreshTable(connectionId, table)
            break
          case 'renameTable':
            if (onRenameTable) {
              void onRenameTable(connectionId, table)
            }
            break
          case 'truncateTable':
            if (onTruncateTable) {
              void onTruncateTable(connectionId, table)
            }
            break
          case 'deleteTable':
            if (onDeleteTable) {
              void onDeleteTable(connectionId, table)
            }
            break
          case 'selectAll':
          case 'selectCount':
          case 'insertTemplate':
          case 'updateTemplate':
          case 'deleteTemplate':
          case 'addRow':
          case 'tableProperties':
            void onTableQuickAction(action, connectionId, table)
            break
          default:
            break
        }
      }

      setContextMenu(null)
    },
    [
      activeConnectionId,
      contextMenu,
      isSearching,
      onRefreshConnection,
      onDisconnectConnection,
      onCopyConnectionString,
      onRefreshDatabases,
      onCopyDatabaseName,
      onSelectTable,
      onRefreshTable,
      onRenameTable,
      onTruncateTable,
      onCopyTableName,
      onDeleteTable,
      onTableQuickAction,
    ],
  )

  const renderTablesPanelForConnection = (connection: ConnectionSummary) => {
    if (!isTablesPanelExpanded) return null

    const isActiveConnection = activeConnectionId === connection.id
    const dbList = isActiveConnection ? (databasesQuery.data ?? []) : []

    const buildTableTreeNode = (tables: TableInfo[]): TreeDataItem[] =>
      tables.map((t) => ({
        id: `table:${connection.id}:${t.schema}.${t.name}`,
        name: t.name,
        data: t,
        onDoubleClick: () => {
          onSelectTable(t)
          onTableQuickAction('selectAll', connection.id, t)
        },
      }))

    return (
      <div className="border-t border-sidebar-border/40">
        {databasesQuery.isLoading && !databasesQuery.data ? (
          <div className="flex items-center gap-2 px-3 py-3 text-[11px] text-sidebar-foreground/60">
            <SpinnerGapIcon className="size-3.5 animate-spin" />
            Loading databases…
          </div>
        ) : dbList.length > 0 ? (
          <div>
            {dbList.map((db) => (
              <div key={`db-${connection.id}-${db.name}`}>
                <button
                  type="button"
                  className={cn(
                    'flex w-full items-center gap-2 pl-6 pr-3 py-1.5 text-left text-xs transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                    db.name === connection.database && 'bg-emerald-500/10 text-emerald-600',
                  )}
                  onClick={() => {
                    if (db.name !== connection.database) {
                      switchDatabaseMutation.mutate({
                        connectionId: connection.id,
                        database: db.name,
                      })
                    }
                  }}
                  onContextMenu={(event) => {
                    openSidebarContextMenu(event, {
                      kind: 'database',
                      connectionId: connection.id,
                      database: db.name,
                    })
                  }}
                  disabled={switchDatabaseMutation.isPending}
                >
                  <span className="text-sidebar-foreground/50">
                    {db.name === connection.database ? (
                      <CaretDownIcon className="size-3" />
                    ) : (
                      <CaretRightIcon className="size-3" />
                    )}
                  </span>
                  <DatabaseIcon className={cn(
                    'size-3.5 shrink-0',
                    db.name === connection.database ? 'text-emerald-500' : 'text-sidebar-foreground/50',
                  )} />
                  <span className="min-w-0 flex-1 truncate font-medium">{db.name}</span>
                  <span className="shrink-0 rounded border border-sidebar-border/60 px-1 text-[9px] text-sidebar-foreground/40">
                    PG
                  </span>
                  {db.name === connection.database ? (
                    <span className="shrink-0 rounded bg-emerald-500/15 px-1 text-[9px] font-medium text-emerald-600">
                      active
                    </span>
                  ) : null}
                  {switchDatabaseMutation.isPending && db.name !== connection.database ? (
                    <SpinnerGapIcon className="size-3 animate-spin" />
                  ) : null}
                </button>

                {db.name === connection.database ? (
                  <div className="ml-5 border-l border-sidebar-border/60 py-1">
                    <div className="relative mb-1 px-2">
                      <MagnifyingGlassIcon className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-sidebar-foreground/50" />
                      <Input
                        value={search}
                        onChange={(event) => onSearchChange(event.target.value)}
                        placeholder="Filter tables…"
                        className="border-sidebar-border bg-background/70 h-7 pl-7 text-[11px]"
                      />
                    </div>

                    {tablesErrorMessage ? (
                      <div className="px-2 py-2 text-[11px] text-destructive">{tablesErrorMessage}</div>
                    ) : isTablesLoading ? (
                      <div className="flex items-center gap-2 px-2 py-2 text-[11px] text-sidebar-foreground/60">
                        <SpinnerGapIcon className="size-3.5 animate-spin" />
                        Loading tables…
                      </div>
                    ) : filteredTablesWithKeys.length === 0 ? (
                      <div className="px-2 py-2 text-[11px] text-sidebar-foreground/60">
                        {isSearching ? 'No tables match the filter.' : 'No tables found.'}
                      </div>
                    ) : (
                      <TreeView
                        data={buildTableTreeNode(filteredTablesWithKeys.map((e) => e.table))}
                        expandedIds={[...expandedIds]}
                        onExpandedChange={handleExpandedChange}
                        initialSelectedItemId={activeTableKey ?? undefined}
                        renderItem={(params) => {
                          const table = params.item.data as TableInfo | undefined
                          if (!table) return undefined
                          const tableKey = `${connection.id}:${table.schema}.${table.name}`
                          return (
                            <TableTreeItem
                              connectionId={connection.id}
                              table={table}
                              level={params.level}
                              isExpanded={params.isExpanded}
                              isSelected={activeTableKey === tableKey}
                              highlightSchemaNeedleLower={schemaNeedleLower}
                              highlightTableNeedleLower={tableNeedleLower}
                              onSelectTable={() => {
                                params.select()
                                onSelectTable(table)
                              }}
                              onToggleExpanded={params.toggle}
                              onOpenContextMenu={(event, target) => openSidebarContextMenu(event, target)}
                            />
                          )
                        }}
                      />
                    )}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : databasesQuery.isError ? (
          <div className="px-3 py-3 text-[11px] text-destructive">
            {databasesQuery.error instanceof Error ? databasesQuery.error.message : 'Failed to load databases'}
          </div>
        ) : (
          <div className="px-3 py-2 text-[11px] text-sidebar-foreground/60">
            No databases found.
          </div>
        )}
      </div>
    )
  }

  return (
    <aside className="flex h-full flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="flex items-center justify-between gap-2 border-b border-sidebar-border px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-[0.24em] text-sidebar-foreground/60">
            Connections
          </p>
          <p className="truncate pt-1 text-xs text-sidebar-foreground/80">
            {connections.length} connection{connections.length !== 1 ? 's' : ''}
            {activeConnection ? ` · ${activeConnection.database}` : ''}
          </p>
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onOpenConnection}
            aria-label="Create connection"
          >
            <PlusIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onToggleCollapsed}
            aria-label="Collapse sidebar"
          >
            <SidebarSimpleIcon />
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        {isConnectionsLoading ? (
          <div className="flex gap-2 px-3 py-4 text-xs text-sidebar-foreground/60">
            <SpinnerGapIcon className="size-4 animate-spin" />
            Loading connections…
          </div>
        ) : null}

        {!isConnectionsLoading && connections.length === 0 ? (
          <div className="p-4">
            <div className="rounded-md border border-dashed border-sidebar-border px-3 py-5 text-center">
              <p className="text-xs font-medium text-sidebar-foreground">No connections yet</p>
              <p className="text-[11px] text-sidebar-foreground/60 mt-1">
                Create a new connection
              </p>
              <p className="text-[11px] text-sidebar-foreground/60">
                Add a connection to start browsing tables and fields.
              </p>
            </div>
          </div>
        ) : null}

        {!isConnectionsLoading && visibleConnections.length > 0 ? (
          <div className="divide-y divide-sidebar-border/60">
            {visibleConnections.map((connection) => {
              const isActive = activeConnectionId === connection.id

              return (
                <div key={connection.id}>
                  <div
                    className={cn(
                      'group flex w-full items-stretch text-left text-xs transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                      isActive && 'bg-emerald-500/10 text-emerald-600',
                    )}
                  >
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-start gap-2 px-3 py-2.5"
                      onClick={(event) => {
                        if (event.detail > 1) {
                          cancelPendingSelect()
                          return
                        }

                        if (isActivatingConnection) return

                        if (isActive) {
                          cancelPendingSelect()
                          if (isSearching) {
                            setIsTablesPanelExpanded(true)
                          } else {
                            setIsTablesPanelExpanded((prev) => !prev)
                          }
                        } else {
                          scheduleSelectConnection(connection)
                        }
                      }}
                      disabled={isActivatingConnection}
                      onContextMenu={(event) => {
                        cancelPendingSelect()
                        openSidebarContextMenu(event, {
                          kind: 'connection',
                          connection,
                        })
                      }}
                      onDoubleClick={(event) => {
                        cancelPendingSelect()
                        openSidebarContextMenu(event, {
                          kind: 'connection',
                          connection,
                        })
                      }}
                    >
                      <span className="pt-0.5 text-sidebar-foreground/70">
                        {isActive && isTablesPanelExpanded ? <CaretDownIcon /> : <CaretRightIcon />}
                      </span>
                      <HardDriveIcon className={cn(
                        'mt-0.5 size-3.5 shrink-0',
                        isActive ? 'text-emerald-500' : 'text-sidebar-foreground/70',
                      )} />
                      <ConnectionHealthDot connectionId={connection.id} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate font-medium">{connection.name}</p>
                          {isActive ? (
                            <span className="shrink-0 rounded bg-emerald-500/15 px-1 py-0.5 text-[10px] font-medium uppercase tracking-[0.18em] text-emerald-600">
                              Active
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </button>

                    <div className="flex shrink-0 items-center gap-0.5 px-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        type="button"
                        className="rounded p-1 text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                        title="Refresh connection"
                        onClick={(e) => {
                          e.stopPropagation()
                          onRefreshConnection(connection)
                        }}
                      >
                        <ArrowsClockwiseIcon className="size-3" />
                      </button>
                      {onDisconnectConnection ? (
                        <button
                          type="button"
                          className="rounded p-1 text-sidebar-foreground/60 hover:bg-destructive/10 hover:text-destructive"
                          title="Delete connection"
                          onClick={(e) => {
                            e.stopPropagation()
                            onDisconnectConnection(connection)
                          }}
                        >
                          <TrashIcon className="size-3" />
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {isActive ? renderTablesPanelForConnection(connection) : null}
                </div>
              )
            })}
          </div>
        ) : null}
      </div>

      {contextMenu ? (
        <div
          ref={contextMenuRef}
          className="fixed z-50 min-w-[220px] overflow-hidden rounded-md border border-border bg-background p-1 shadow-md"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <div className="mb-1 border-b border-border px-2 py-1.5">
            <p className="truncate text-[11px] font-medium text-foreground">
              {isConnectionContextMenuTarget(contextMenu.target)
                ? contextMenu.target.connection.name
                : isDatabaseContextMenuTarget(contextMenu.target)
                  ? contextMenu.target.database
                  : `${contextMenu.target.table.schema}.${contextMenu.target.table.name}`}
            </p>
          </div>

          {(isConnectionContextMenuTarget(contextMenu.target)
            ? connectionContextMenuActions
            : isDatabaseContextMenuTarget(contextMenu.target)
              ? databaseContextMenuActions
              : tableContextMenuActions
          ).map((action) => (
            <button
              key={action.id}
              type="button"
              className={cn(
                'flex w-full items-center rounded-sm px-2 py-1.5 text-left text-xs transition hover:bg-accent hover:text-accent-foreground',
                action.group === 'danger' && 'text-destructive hover:bg-destructive/10',
              )}
              disabled={action.disabled}
              onClick={() => handleContextMenuAction(action.id)}
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </aside>
  )
}

function ConnectionHealthDot({ connectionId }: { connectionId: string }) {
  const health = useConnectionHealth(connectionId)
  const color = health.isPending
    ? 'bg-yellow-500'
    : health.isError
      ? 'bg-red-500'
      : 'bg-emerald-500'
  return (
    <span
      className={`mt-1.5 size-1.5 shrink-0 rounded-full ${color}`}
      title={
        health.isPending
          ? 'Checking connection...'
          : health.isError
            ? 'Connection failed'
            : 'Connected'
      }
    />
  )
}
