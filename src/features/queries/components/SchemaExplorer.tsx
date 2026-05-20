import {
  CaretDownIcon,
  CaretRightIcon,
  CubeIcon,
  FunctionIcon,
  MagnifyingGlassIcon,
  SidebarSimpleIcon,
  TableIcon,
} from '@phosphor-icons/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useQueryEditorMetadata } from '@/features/queries/queries'
import { quoteIdent } from '@/lib/sql-ident'
import { cn } from '@/lib/utils'

type SchemaExplorerProps = {
  connectionId: string | null
  onInsertText: (text: string) => void
}

type TreeNode = {
  id: string
  label: string
  detail?: string
  children?: TreeNode[]
  onInsert?: () => void
}

export function SchemaExplorer({ connectionId, onInsertText }: SchemaExplorerProps) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState(false)
  const [tab, setTab] = useState<'tables' | 'functions'>('tables')
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set())
  const searchInputRef = useRef<HTMLInputElement>(null)

  const { data: metadata, isLoading, isError, refetch } = useQueryEditorMetadata(connectionId)

  const searchLower = search.trim().toLowerCase()

  const treeNodes = useMemo<TreeNode[]>(() => {
    if (!metadata) return []
    if (tab === 'tables') {
      const schemas = new Map<string, TreeNode[]>()
      for (const table of metadata.tables) {
        if (searchLower && !`${table.schema}.${table.name}`.toLowerCase().includes(searchLower)) continue
        const schemaNodes = schemas.get(table.schema) ?? []
        schemaNodes.push({
          id: `table:${table.schema}.${table.name}`,
          label: table.name,
          children: table.columns.map((col) => ({
            id: `col:${table.schema}.${table.name}.${col.name}`,
            label: col.name,
            detail: col.dataType,
            onInsert: () => onInsertText(quoteIdent(col.name)),
          })),
          onInsert: () => onInsertText(`${quoteIdent(table.schema)}.${quoteIdent(table.name)}`),
        })
        schemas.set(table.schema, schemaNodes)
      }
      return [...schemas.entries()].map(([schema, tables]) => ({
        id: `schema:${schema}`,
        label: schema,
        children: tables,
      }))
    }
    return metadata.functions
      .filter((f) => !searchLower || f.name.toLowerCase().includes(searchLower))
      .map((f) => ({
        id: `fn:${f.schema}.${f.name}`,
        label: `${f.name}(${f.argTypes.join(', ')})`,
        detail: f.returnType,
        onInsert: () => onInsertText(`${quoteIdent(f.schema)}.${quoteIdent(f.name)}(...)`),
      }))
  }, [metadata, tab, searchLower, onInsertText])

  const toggleNode = useCallback((nodeId: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev)
      if (next.has(nodeId)) next.delete(nodeId)
      else next.add(nodeId)
      return next
    })
  }, [])

  useEffect(() => {
    if (metadata && expandedNodes.size === 0) {
      const defaultExpanded = new Set<string>()
      for (const table of metadata.tables.slice(0, 30)) {
        defaultExpanded.add(`schema:${table.schema}`)
      }
      setExpandedNodes(defaultExpanded)
    }
  }, [metadata])

  if (collapsed) {
    return (
      <div className="flex shrink-0 flex-col items-center gap-2 border-r border-border py-2">
        <Button variant="ghost" size="icon-sm" onClick={() => setCollapsed(false)} title={t("editor.expand")}>
          <SidebarSimpleIcon className="size-4 rotate-180" />
        </Button>
      </div>
    )
  }

  return (
    <div className="flex w-[220px] shrink-0 flex-col border-r border-border bg-muted/20">
      <div className="flex items-center justify-between gap-1 border-b border-border px-2 py-1.5">
        <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          {t("editor.schema")}
        </span>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => refetch()}
            title={t("editor.refreshSchema")}
            className="size-6"
          >
            <CubeIcon className="size-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setCollapsed(true)}
            title={t("editor.collapse")}
            className="size-6"
          >
            <SidebarSimpleIcon className="size-3" />
          </Button>
        </div>
      </div>

      <div className="flex gap-0 border-b border-border px-1 py-1">
        <Button
          variant={tab === 'tables' ? 'secondary' : 'ghost'}
          size="sm"
          className="h-6 flex-1 text-[10px]"
          onClick={() => setTab('tables')}
        >
          <TableIcon className="mr-1 size-3" />
          {t("editor.tables")}
        </Button>
        <Button
          variant={tab === 'functions' ? 'secondary' : 'ghost'}
          size="sm"
          className="h-6 flex-1 text-[10px]"
          onClick={() => setTab('functions')}
        >
          <FunctionIcon className="mr-1 size-3" />
          {t("editor.functions")}
        </Button>
      </div>

      <div className="px-1.5 py-1.5">
        <div className="relative">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/50" />
          <Input
            ref={searchInputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Filter ${tab}...`}
            className="h-7 border-border bg-background/70 pl-7 text-[11px]"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto py-1">
        {isLoading ? (
          <div className="px-3 py-4 text-center text-[11px] text-muted-foreground">Loading schema...</div>
        ) : isError ? (
          <div className="px-3 py-2 text-[11px] text-destructive">
            Failed to load schema.{' '}
            <button type="button" className="underline" onClick={() => refetch()}>
              Retry
            </button>
          </div>
        ) : treeNodes.length === 0 ? (
          <div className="px-3 py-4 text-center text-[11px] text-muted-foreground">
            {search ? 'No matches.' : 'No objects found.'}
          </div>
        ) : (
          <TreeNodes nodes={treeNodes} expandedNodes={expandedNodes} onToggle={toggleNode} level={0} />
        )}
      </div>

      {metadata?.truncatedTables && tab === 'tables' ? (
        <div className="border-t border-border px-2 py-1.5 text-[10px] text-muted-foreground">
          Showing first {metadata.tables.length} tables (truncated)
        </div>
      ) : null}
    </div>
  )
}

function TreeNodes({
  nodes,
  expandedNodes,
  onToggle,
  level,
}: {
  nodes: TreeNode[]
  expandedNodes: Set<string>
  onToggle: (id: string) => void
  level: number
}) {
  return (
    <>
      {nodes.map((node) => {
        const hasChildren = node.children && node.children.length > 0
        const isExpanded = hasChildren && expandedNodes.has(node.id)

        return (
          <div key={node.id}>
            <button
              type="button"
              className={cn(
                'flex w-full items-center gap-1 rounded-sm px-2 py-1 text-left text-[11px] transition hover:bg-accent/50',
                level > 0 && 'pl-5',
              )}
              style={{ paddingLeft: `${8 + level * 14}px` }}
              onClick={() => (hasChildren ? onToggle(node.id) : node.onInsert?.())}
              onDoubleClick={() => node.onInsert?.()}
              title={node.onInsert ? 'Click to expand, double-click to insert' : undefined}
            >
              {hasChildren ? (
                isExpanded ? (
                  <CaretDownIcon className="size-3 shrink-0 text-muted-foreground" />
                ) : (
                  <CaretRightIcon className="size-3 shrink-0 text-muted-foreground" />
                )
              ) : null}
              <span className="truncate font-medium">{node.label}</span>
              {node.detail ? (
                <span className="ml-auto shrink-0 truncate pl-1 text-[10px] text-muted-foreground/70">
                  {node.detail}
                </span>
              ) : null}
            </button>
            {isExpanded && node.children ? (
              <TreeNodes
                nodes={node.children}
                expandedNodes={expandedNodes}
                onToggle={onToggle}
                level={level + 1}
              />
            ) : null}
          </div>
        )
      })}
    </>
  )
}
