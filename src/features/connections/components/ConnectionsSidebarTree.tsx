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
  MagnifyingGlassIcon,
  PlusIcon,
  SidebarSimpleIcon,
  SpinnerGapIcon,
  TrashIcon,
} from '@phosphor-icons/react'

import type { ConnectionSummary, TableInfo } from '@/data/types'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { TreeView, type TreeDataItem, type TreeRenderItemParams } from '@/components/ui/tree-view'
import type { TableQuickSqlAction } from '@/features/queries/table-quick-actions'
import { useTableSchemaQuery } from '@/features/schema/queries'
import { useConnectionHealth } from '@/features/connections/use-connection-health'

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

type SidebarContextMenuTarget = ConnectionContextMenuTarget | TableContextMenuTarget

type ConnectionContextMenuActionId =
  | 'toggleConnection'
  | 'refreshConnection'
  | 'renameConnection'
  | 'disconnectConnection'

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

type ContextMenuAction = {
  id: ConnectionContextMenuActionId | TableContextMenuActionId
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
    if (idx === -1) break

    if (idx > start) {
      parts.push(text.slice(start, idx))
    }

    const match = text.slice(idx, idx + needleLower.length)
    parts.push(
      <span
        key={`h-${keyIndex++}`}
        className="rounded-[2px] bg-sidebar-accent px-0.5 text-sidebar-accent-foreground"
      >
        {match}
      </span>,
    )

    start = idx + needleLower.length
  }

  if (start < text.length) {
    parts.push(text.slice(start))
  }

  return <>{parts}</>
}

function isConnectionContextMenuTarget(
  target: SidebarContextMenuTarget,
): target is ConnectionContextMenuTarget {
  return target.kind === 'connection'
}

function isTableContextMenuTarget(
  target: SidebarContextMenuTarget,
): target is TableContextMenuTarget {
  return target.kind === 'table'
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
  const pendingSelectTimeoutRef = useRef<number | null>(null)

  const cancelPendingSelect = useCallback(() => {
    if (pendingSelectTimeoutRef.current != null) {
      window.clearTimeout(pendingSelectTimeoutRef.current)
      pendingSelectTimeoutRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => cancelPendingSelect()
  }, [cancelPendingSelect])

  const schemaQuery = useTableSchemaQuery({
    connectionId,
    table,
    enabled: isExpanded,
  })

  const errorMessage =
    schemaQuery.error instanceof Error ? schemaQuery.error.message : 'Failed to load fields'

  return (
    <div className="py-0.5">
      <div className="flex min-w-0 items-center">
        <button
          type="button"
          className="flex h-8 w-7 shrink-0 items-center justify-center text-sidebar-foreground/70 transition hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground"
          onClick={onToggleExpanded}
          aria-label={isExpanded ? 'Collapse table fields' : 'Expand table fields'}
        >
          {isExpanded ? <CaretDownIcon /> : <CaretRightIcon />}
        </button>

        <button
          type="button"
          className={cn(
            'flex h-8 min-w-0 flex-1 items-center gap-2 rounded-sm px-2 text-left text-xs transition hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground',
            isSelected && 'bg-sidebar-accent text-sidebar-accent-foreground',
          )}
          style={{ paddingLeft: `${4 + level * 10}px` }}
          onClick={(event) => {
            // Delay selection slightly to avoid running previews on double-click.
            if (event.detail > 1) {
              cancelPendingSelect()
              return
            }

            cancelPendingSelect()
            pendingSelectTimeoutRef.current = window.setTimeout(() => {
              onSelectTable(table)
              pendingSelectTimeoutRef.current = null
            }, 250)
          }}
          onContextMenu={(event) => {
            cancelPendingSelect()
            onOpenContextMenu(event, {
              kind: 'table',
              connectionId,
              table,
              onToggleExpanded,
              isExpanded,
            })
          }}
          onDoubleClick={(event) => {
            cancelPendingSelect()
            onOpenContextMenu(event, {
              kind: 'table',
              connectionId,
              table,
              onToggleExpanded,
              isExpanded,
            })
          }}
        >
          <DatabaseIcon className="size-3.5 shrink-0 text-sidebar-foreground/60" />
          <div className="min-w-0">
            <p className="truncate font-medium">
              {highlightText(table.name, highlightTableNeedleLower)}
            </p>
            <p className="truncate text-[11px] text-sidebar-foreground/60">
              {highlightText(table.schema, highlightSchemaNeedleLower)}
            </p>
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

          {schemaQuery.data && schemaQuery.data.length === 0 ? (
            <div className="py-1 text-[11px] text-sidebar-foreground/60">
              No fields were returned for this table.
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
  onRenameConnection,
  onDisconnectConnection,
  onRenameTable,
  onDeleteTable,
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
  const activeTableKey =
    activeConnectionId && selectedTable
      ? `${activeConnectionId}:${selectedTable.schema}.${selectedTable.name}`
      : null

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

  const tableTreeData = useMemo<TreeDataItem[]>(
    () =>
      filteredTablesWithKeys.map((entry) => ({
        id: `table:${entry.table.schema}.${entry.table.name}`,
        name: `${entry.table.schema}.${entry.table.name}`,
        data: entry.table,
      })),
    [filteredTablesWithKeys],
  )

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
      const menuEl = contextMenuRef.current
      if (!menuEl) return
      const node = event.target
      if (node instanceof Node && menuEl.contains(node)) return
      setContextMenu(null)
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setContextMenu(null)
      }
    }

    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [contextMenu])

  const visibleConnections = useMemo(() => {
    if (!activeConnection) {
      return connections
    }

    return connections.some((connection) => connection.id === activeConnection.id)
      ? connections
      : [activeConnection, ...connections]
  }, [activeConnection, connections])

  const cancelPendingSelect = useCallback(() => {
    if (pendingSelectTimeoutRef.current != null) {
      window.clearTimeout(pendingSelectTimeoutRef.current)
      pendingSelectTimeoutRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => cancelPendingSelect()
  }, [cancelPendingSelect])

  const scheduleSelectConnection = useCallback(
    (connection: ConnectionSummary) => {
      cancelPendingSelect()
      pendingSelectTimeoutRef.current = window.setTimeout(() => {
        setIsTablesPanelExpanded(true)
        onSelectConnection(connection)
        pendingSelectTimeoutRef.current = null
      }, 250)
    },
    [cancelPendingSelect, onSelectConnection],
  )

  const connectionContextMenuTarget =
    contextMenu && isConnectionContextMenuTarget(contextMenu.target) ? contextMenu.target : null

  const tableContextMenuTarget =
    contextMenu && isTableContextMenuTarget(contextMenu.target) ? contextMenu.target : null

  const connectionContextMenuActions = useMemo<ContextMenuAction[]>(() => {
    if (!connectionContextMenuTarget) return []

    const isActive = activeConnectionId === connectionContextMenuTarget.connection.id
    const toggleLabel = isActive
      ? isTablesPanelExpanded
        ? isSearching
          ? 'Tables expanded (search)'
          : 'Collapse tables'
        : 'Expand tables'
      : 'Activate connection'

    return [
      {
        id: 'toggleConnection',
        label: toggleLabel,
        group: 'primary',
        disabled: isActivatingConnection,
      },
      {
        id: 'refreshConnection',
        label: 'Refresh',
        group: 'primary',
      },
      {
        id: 'renameConnection',
        label: 'Rename',
        group: 'secondary',
        disabled: !onRenameConnection,
      },
      {
        id: 'disconnectConnection',
        label: 'Delete',
        group: 'danger',
        disabled: !onDisconnectConnection,
      },
    ]
  }, [
    activeConnectionId,
    connectionContextMenuTarget,
    isActivatingConnection,
    isSearching,
    isTablesPanelExpanded,
    onDisconnectConnection,
    onRenameConnection,
  ])

  const tableContextMenuActions = useMemo<ContextMenuAction[]>(() => {
    if (!tableContextMenuTarget) return []

    return [
      { id: 'selectTable', label: 'Select table (run preview)', group: 'primary' },
      {
        id: 'toggleFields',
        label: tableContextMenuTarget.isExpanded ? 'Hide fields' : 'Show fields',
        group: 'primary',
      },
      { id: 'refreshTable', label: 'Refresh', group: 'primary' },
      {
        id: 'renameTable',
        label: 'Rename',
        group: 'secondary',
        disabled: !onRenameTable,
      },
      {
        id: 'deleteTable',
        label: 'Delete',
        group: 'danger',
        disabled: !onDeleteTable,
      },
      { id: 'selectAll', label: 'SELECT * (LIMIT)', group: 'secondary' },
      { id: 'selectCount', label: 'SELECT COUNT(*)', group: 'secondary' },
      { id: 'insertTemplate', label: 'INSERT template', group: 'secondary' },
      { id: 'updateTemplate', label: 'UPDATE template', group: 'secondary' },
      { id: 'deleteTemplate', label: 'DELETE template', group: 'secondary' },
      { id: 'addRow', label: 'Add row…', group: 'secondary' },
      { id: 'tableProperties', label: 'Table properties', group: 'secondary' },
    ]
  }, [onDeleteTable, onRenameTable, tableContextMenuTarget])

  const handleContextMenuAction = useCallback(
    (action: ContextMenuAction['id']) => {
      if (!contextMenu) return

      if (contextMenu.target.kind === 'connection') {
        const { connection } = contextMenu.target
        const isActive = activeConnectionId === connection.id

        switch (action) {
          case 'toggleConnection':
            if (isActive) {
              if (isSearching) {
                setIsTablesPanelExpanded(true)
              } else {
                setIsTablesPanelExpanded((prev) => !prev)
              }
            } else {
              setIsTablesPanelExpanded(true)
              onSelectConnection(connection)
            }
            break
          case 'refreshConnection':
            void onRefreshConnection(connection)
            break
          case 'renameConnection':
            if (onRenameConnection) {
              void onRenameConnection(connection)
            }
            break
          case 'disconnectConnection':
            if (onDisconnectConnection) {
              void onDisconnectConnection(connection)
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
          case 'refreshTable':
            void onRefreshTable(connectionId, table)
            break
          case 'renameTable':
            if (onRenameTable) {
              void onRenameTable(connectionId, table)
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
      onDeleteTable,
      onDisconnectConnection,
      onRefreshConnection,
      onRefreshTable,
      onRenameConnection,
      onRenameTable,
      onSelectConnection,
      onSelectTable,
      onTableQuickAction,
    ],
  )

  const renderTablesPanelForConnection = (connection: ConnectionSummary) => {
    if (!isTablesPanelExpanded) return null

    return (
      <div className="py-2 px-1">
        <div className="py-1">
          <div className="relative">
            <MagnifyingGlassIcon className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-sidebar-foreground/50" />
            <Input
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Search tables"
              className="border-sidebar-border bg-background/70 pl-8"
            />
          </div>
        </div>

        {tablesErrorMessage ? (
          <div className="px-2 py-3 text-xs text-destructive">{tablesErrorMessage}</div>
        ) : (
          <>
            {!isTablesLoading && filteredTablesWithKeys.length === 0 ? (
              <div className="px-2 py-3 text-xs text-sidebar-foreground/60">
                {isSearching
                  ? 'No tables match the current filter.'
                  : 'No tables were found for this connection.'}
              </div>
            ) : null}

            {isTablesLoading ? (
              <div className="flex items-center gap-2 px-2 py-3 text-xs text-sidebar-foreground/60">
                <SpinnerGapIcon className="size-4 animate-spin" />
                Loading tables...
              </div>
            ) : null}

            {!isTablesLoading && filteredTablesWithKeys.length > 0 ? (
              <TreeView
                data={tableTreeData}
                  renderItem={(params: TreeRenderItemParams) => {
                    const table = params.item.data as TableInfo | undefined
                    if (!table) return null

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
            ) : null}
          </>
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
            Browse databases, tables, and fields.
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

      <div className="min-h-0 flex-1 overflow-auto">
        {contextMenu ? (
          <div
            ref={contextMenuRef}
            className="fixed z-50 min-w-[260px] max-w-[min(90vw,320px)] rounded-md border border-sidebar-border bg-popover p-1 text-xs shadow-lg"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            role="menu"
            aria-label="Sidebar context menu"
          >
            {connectionContextMenuTarget
              ? connectionContextMenuActions.map((action, index) => (
                  <div key={action.id}>
                    {index > 0 && action.group !== connectionContextMenuActions[index - 1]?.group ? (
                      <div className="my-1 h-px bg-sidebar-border/60" />
                    ) : null}
                    <button
                      type="button"
                      className={cn(
                        'flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-sidebar-accent hover:text-sidebar-accent-foreground disabled:opacity-60',
                        action.group === 'danger'
                          ? 'text-destructive hover:bg-destructive/10 hover:text-destructive'
                          : 'text-sidebar-foreground/90',
                      )}
                      onClick={() => handleContextMenuAction(action.id)}
                      disabled={action.disabled}
                    >
                      <span>{action.label}</span>
                    </button>
                  </div>
                ))
              : null}

            {tableContextMenuTarget
              ? tableContextMenuActions.map((action, index) => (
                  <div key={action.id}>
                    {index > 0 && action.group !== tableContextMenuActions[index - 1]?.group ? (
                      <div className="my-1 h-px bg-sidebar-border/60" />
                    ) : null}
                    <button
                      type="button"
                      className={cn(
                        'flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-sidebar-accent hover:text-sidebar-accent-foreground disabled:opacity-60',
                        action.group === 'danger'
                          ? 'text-destructive hover:bg-destructive/10 hover:text-destructive'
                          : 'text-sidebar-foreground/90',
                      )}
                      onClick={() => handleContextMenuAction(action.id)}
                      disabled={action.disabled}
                    >
                      <span>{action.label}</span>
                    </button>
                  </div>
                ))
              : null}
          </div>
        ) : null}

        {isConnectionsLoading ? (
          <div className="flex items-center gap-2 px-3 py-4 text-xs text-sidebar-foreground/60">
            <SpinnerGapIcon className="size-4 animate-spin" />
            Loading saved connections...
          </div>
        ) : null}

        {!isConnectionsLoading && visibleConnections.length === 0 ? (
          <div className="space-y-2 px-3 py-4 text-xs text-sidebar-foreground/60">
            <p>No saved connections yet.</p>
            <p>Add a connection to start browsing tables and fields.</p>
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
                      isActive && 'bg-sidebar-accent text-sidebar-accent-foreground',
                    )}
                  >
                    <button
                    type="button"
                    className="flex min-w-0 flex-1 items-start gap-2 px-3 py-2.5"
                    onClick={(event) => {
                      // Delay activation slightly to avoid reacting to double-click.
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
                      {isActive ? <CaretDownIcon /> : <CaretRightIcon />}
                    </span>
                    <DatabaseIcon className="mt-0.5 size-3.5 shrink-0 text-sidebar-foreground/70" />
                    <ConnectionHealthDot connectionId={connection.id} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate font-medium">{connection.name}</p>
                        {isActive ? (
                          <span className="shrink-0 border border-sidebar-border/80 bg-sidebar-primary px-1 py-0.5 text-[10px] uppercase tracking-[0.18em] text-sidebar-primary-foreground">
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
                      onClick={(e) => { e.stopPropagation(); onRefreshConnection(connection) }}
                    >
                      <ArrowsClockwiseIcon className="size-3" />
                    </button>
                    {onDisconnectConnection ? (
                      <button
                        type="button"
                        className="rounded p-1 text-sidebar-foreground/60 hover:bg-destructive/10 hover:text-destructive"
                        title="Delete connection"
                        onClick={(e) => { e.stopPropagation(); onDisconnectConnection(connection) }}
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

      <div className="shrink-0 border-t border-sidebar-border px-3 py-2.5">
        <div className="flex items-center justify-between gap-2 text-[11px] text-sidebar-foreground/60">
          <span>
            {connections.length} connection{connections.length !== 1 ? 's' : ''}
          </span>
          {activeConnection ? (
            <span className="truncate text-sidebar-foreground/80">
              {activeConnection.database}
            </span>
          ) : null}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="mt-1.5 h-7 w-full justify-start gap-2 text-xs"
          onClick={onOpenConnection}
        >
          <PlusIcon className="size-3.5" />
          New connection
        </Button>
      </div>
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

