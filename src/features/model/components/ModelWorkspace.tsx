import { useQueries, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { queryKeys } from '@/data/query-keys'
import { veloxDbRepository } from '@/data/repositories'
import type { ColumnInfo, TableInfo } from '@/data/types'
import {
  applyEntireModel,
  type ColumnOverride,
  type TableIdentityDraft,
} from '@/features/model/apply-entire-model'
import { DdlReviewDialog } from '@/features/model/components/DdlReviewDialog'
import { DiagramCanvas } from '@/features/model/components/DiagramCanvas'
import { ModelCatalog } from '@/features/model/components/ModelCatalog'
import { ModelInspector } from '@/features/model/components/ModelInspector'
import {
  ensurePositions,
  loadDiagramLayout,
  saveDiagramLayout,
} from '@/features/model/model-layout-storage'
import { tableKey, type TableKey, type ViewportState } from '@/features/model/model-types'
import { useForeignKeysQuery } from '@/features/model/queries'

type ModelWorkspaceProps = {
  connectionId: string
  defaultDatabaseName: string
  isDark: boolean
  tables: TableInfo[]
  tablesErrorMessage?: string
  isTablesLoading: boolean
  selectedTable: TableInfo | null
}

export function ModelWorkspace({
  connectionId,
  defaultDatabaseName,
  isDark,
  tables,
  tablesErrorMessage,
  isTablesLoading,
  selectedTable,
}: ModelWorkspaceProps) {
  const queryClient = useQueryClient()
  const foreignKeysQuery = useForeignKeysQuery(connectionId)

  const [hadStoredLayout] = useState(() => loadDiagramLayout(connectionId) !== null)
  const [onCanvas, setOnCanvas] = useState<TableKey[]>(
    () => loadDiagramLayout(connectionId)?.onCanvas ?? [],
  )
  const [positions, setPositions] = useState<Record<TableKey, { x: number; y: number }>>(
    () => loadDiagramLayout(connectionId)?.positions ?? {},
  )
  const [viewport, setViewport] = useState<ViewportState>(
    () => loadDiagramLayout(connectionId)?.viewport ?? { scale: 1, x: 0, y: 0 },
  )
  const [modelTitle, setModelTitle] = useState(
    () => loadDiagramLayout(connectionId)?.modelTitle?.trim() || defaultDatabaseName,
  )
  const [selectedKey, setSelectedKey] = useState<TableKey | null>(null)
  const [columnRequestKeys, setColumnRequestKeys] = useState<TableKey[]>([])
  const [modelTab, setModelTab] = useState<'diagram' | 'catalog'>('diagram')
  const [ddlOpen, setDdlOpen] = useState(false)
  const [identityDraftByKey, setIdentityDraftByKey] = useState<Record<TableKey, TableIdentityDraft>>({})
  const [columnOverridesByKey, setColumnOverridesByKey] = useState<
    Record<TableKey, Record<string, ColumnOverride>>
  >({})
  const [applyPending, setApplyPending] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)

  const fkSeedDoneRef = useRef(false)

  const tablesByKey = useMemo(() => {
    const m = new Map<TableKey, TableInfo>()
    for (const t of tables) {
      m.set(tableKey(t), t)
    }
    return m
  }, [tables])

  useEffect(() => {
    if (hadStoredLayout) return
    if (fkSeedDoneRef.current) return
    const fkData = foreignKeysQuery.data
    if (!fkData?.length || !tables.length) return

    const keys = new Set<TableKey>()
    for (const e of fkData) {
      keys.add(`${e.fromSchema}.${e.fromTable}`)
      keys.add(`${e.toSchema}.${e.toTable}`)
    }
    const valid = [...keys].filter((k) => tables.some((t) => tableKey(t) === k))
    if (valid.length === 0) return

    fkSeedDoneRef.current = true
    queueMicrotask(() => {
      setOnCanvas(valid)
      setPositions((p) => ensurePositions(valid, p))
    })
  }, [hadStoredLayout, foreignKeysQuery.data, tables])

  useEffect(() => {
    if (!selectedTable) return
    const k = tableKey(selectedTable)
    queueMicrotask(() => {
      setSelectedKey(k)
      setColumnRequestKeys((prev) => (prev.includes(k) ? prev : [...prev, k]))
      setOnCanvas((prev) => (prev.includes(k) ? prev : [...prev, k]))
      setPositions((p) => ensurePositions([k], p))
    })
  }, [selectedTable])

  useEffect(() => {
    if (!selectedKey) return
    const t = tablesByKey.get(selectedKey)
    if (!t) return
    setIdentityDraftByKey((prev) =>
      prev[selectedKey] != null ? prev : { ...prev, [selectedKey]: { schema: t.schema, name: t.name } },
    )
  }, [selectedKey, tablesByKey])

  const sortedRequestKeys = useMemo(() => [...columnRequestKeys].sort(), [columnRequestKeys])

  const columnQueries = useQueries({
    queries: sortedRequestKeys.map((key) => {
      const table = tablesByKey.get(key)
      return {
        queryKey: queryKeys.schema(connectionId, table ?? null),
        queryFn: () => {
          if (!table) throw new Error('Table not found for schema request.')
          return veloxDbRepository.getSchema(connectionId, table)
        },
        enabled: Boolean(connectionId && table),
        staleTime: 5 * 60 * 1000,
      }
    }),
  })

  const columnsByKey = useMemo(() => {
    const out: Record<TableKey, ColumnInfo[] | null> = {}
    sortedRequestKeys.forEach((key, i) => {
      const q = columnQueries[i]
      if (!q) {
        out[key] = null
        return
      }
      if (q.isPending && !q.data) out[key] = null
      else if (q.data) out[key] = q.data
      else out[key] = null
    })
    return out
  }, [columnQueries, sortedRequestKeys])

  useEffect(() => {
    const t = window.setTimeout(() => {
      saveDiagramLayout(connectionId, {
        onCanvas,
        positions,
        viewport,
        modelTitle: modelTitle.trim() || defaultDatabaseName,
      })
    }, 400)
    return () => window.clearTimeout(t)
  }, [connectionId, defaultDatabaseName, modelTitle, onCanvas, positions, viewport])

  const onCanvasSet = useMemo(() => new Set(onCanvas), [onCanvas])

  const tablesOnCanvas = useMemo(() => {
    const list: TableInfo[] = []
    for (const k of onCanvas) {
      const t = tablesByKey.get(k)
      if (t) list.push(t)
    }
    return list
  }, [onCanvas, tablesByKey])

  const tableDisplays = useMemo(() => {
    return tablesOnCanvas.map((t) => {
      const k = tableKey(t)
      const id = identityDraftByKey[k]
      return {
        key: k,
        schema: id?.schema ?? t.schema,
        name: id?.name ?? t.name,
      }
    })
  }, [tablesOnCanvas, identityDraftByKey])

  const inspectorTable = useMemo(() => {
    if (!selectedKey) return null
    return tablesByKey.get(selectedKey) ?? null
  }, [selectedKey, tablesByKey])

  const identityDraftForInspector = useMemo((): TableIdentityDraft | null => {
    if (!selectedKey || !inspectorTable) return null
    return identityDraftByKey[selectedKey] ?? {
      schema: inspectorTable.schema,
      name: inspectorTable.name,
    }
  }, [selectedKey, inspectorTable, identityDraftByKey])

  const isModelDirty = useMemo(() => {
    for (const k of onCanvas) {
      const t = tablesByKey.get(k)
      if (!t) continue
      const id = identityDraftByKey[k]
      if (id && (id.schema !== t.schema || id.name !== t.name)) return true
      const co = columnOverridesByKey[k]
      if (co && Object.keys(co).length > 0) return true
    }
    return false
  }, [onCanvas, tablesByKey, identityDraftByKey, columnOverridesByKey])

  const requestColumns = useCallback((key: TableKey) => {
    setColumnRequestKeys((prev) => (prev.includes(key) ? prev : [...prev, key]))
  }, [])

  const handleSelectKey = useCallback(
    (key: TableKey | null) => {
      setSelectedKey(key)
      if (key) requestColumns(key)
    },
    [requestColumns],
  )

  const handleAddToCanvas = useCallback(
    (table: TableInfo) => {
      const k = tableKey(table)
      setOnCanvas((prev) => (prev.includes(k) ? prev : [...prev, k]))
      setPositions((p) => ensurePositions([k], p))
      setSelectedKey(k)
      setIdentityDraftByKey((prev) =>
        prev[k] != null ? prev : { ...prev, [k]: { schema: table.schema, name: table.name } },
      )
      requestColumns(k)
      setModelTab('diagram')
    },
    [requestColumns],
  )

  const handleRemoveFromCanvas = useCallback((table: TableInfo) => {
    const k = tableKey(table)
    setOnCanvas((prev) => prev.filter((x) => x !== k))
    setSelectedKey((cur) => (cur === k ? null : cur))
    setIdentityDraftByKey((prev) => {
      const next = { ...prev }
      delete next[k]
      return next
    })
    setColumnOverridesByKey((prev) => {
      const next = { ...prev }
      delete next[k]
      return next
    })
  }, [])

  const handleMoveTable = useCallback((key: TableKey, x: number, y: number) => {
    setPositions((prev) => ({ ...prev, [key]: { x, y } }))
  }, [])

  const handleApplyEntireModel = useCallback(async () => {
    setApplyError(null)
    setApplyPending(true)
    try {
      const result = await applyEntireModel({
        connectionId,
        onCanvas,
        tablesByKey,
        identityDraftByKey,
        columnOverridesByKey,
      })

      let nextOnCanvas = [...onCanvas]
      const nextPos = { ...positions }
      for (const { from, to } of result.renamed) {
        nextOnCanvas = nextOnCanvas.map((x) => (x === from ? to : x))
        if (nextPos[from]) {
          nextPos[to] = nextPos[from]
          delete nextPos[from]
        }
      }

      setOnCanvas(nextOnCanvas)
      setPositions(nextPos)
      setIdentityDraftByKey({})
      setColumnOverridesByKey({})
      setSelectedKey((cur) => {
        if (!cur) return cur
        const hit = result.renamed.find((r) => r.from === cur)
        return hit?.to ?? cur
      })

      void queryClient.invalidateQueries({ queryKey: queryKeys.tables(connectionId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.foreignKeys(connectionId) })
      void queryClient.invalidateQueries({ queryKey: ['schema'] })
      void queryClient.invalidateQueries({ queryKey: ['tableProperties'] })
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : 'Failed to apply model')
    } finally {
      setApplyPending(false)
    }
  }, [
    columnOverridesByKey,
    connectionId,
    identityDraftByKey,
    onCanvas,
    positions,
    queryClient,
    tablesByKey,
  ])

  if (isTablesLoading && !tables.length) {
    return (
      <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
        Loading tables…
      </div>
    )
  }

  if (tablesErrorMessage) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 text-center text-xs text-destructive">
        {tablesErrorMessage}
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="flex shrink-0 flex-col gap-2 border-b border-border px-3 py-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <label className="text-[10px] font-medium text-muted-foreground" htmlFor="model-workspace-title">
            Model / database label
          </label>
          <Input
            id="model-workspace-title"
            className="h-8 max-w-sm text-xs"
            value={modelTitle}
            onChange={(e) => setModelTitle(e.target.value)}
            placeholder={defaultDatabaseName}
            spellCheck={false}
          />
          <div className="text-[11px] text-muted-foreground">
            {foreignKeysQuery.isLoading ? 'Loading relationships…' : null}
            {foreignKeysQuery.isError ? (
              <span className="text-destructive">
                {foreignKeysQuery.error instanceof Error
                  ? foreignKeysQuery.error.message
                  : 'Failed to load foreign keys'}
              </span>
            ) : null}
            {applyError ? <span className="mt-1 block text-destructive">{applyError}</span> : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            className="h-8 text-xs"
            disabled={applyPending || !isModelDirty}
            onClick={() => void handleApplyEntireModel()}
          >
            {applyPending ? 'Applying…' : 'Apply entire model'}
          </Button>
          <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => setDdlOpen(true)}>
            Run DDL script…
          </Button>
        </div>
      </div>

      <Tabs
        value={modelTab}
        onValueChange={(v) => setModelTab(v as 'diagram' | 'catalog')}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <div className="shrink-0 border-b border-border px-3 pt-2">
          <TabsList variant="line" className="h-8">
            <TabsTrigger value="diagram" className="text-xs">
              Diagram
            </TabsTrigger>
            <TabsTrigger value="catalog" className="text-xs">
              Catalog
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="diagram" className="m-0 flex min-h-0 flex-1 data-[state=inactive]:hidden">
          <div className="flex min-h-0 min-w-0 flex-1">
            <DiagramCanvas
              isDark={isDark}
              viewport={viewport}
              onViewportChange={setViewport}
              tableDisplays={tableDisplays}
              positions={positions}
              columnsByKey={columnsByKey}
              foreignKeys={foreignKeysQuery.data ?? []}
              selectedKey={selectedKey}
              onSelectKey={handleSelectKey}
              onMoveTable={handleMoveTable}
              onRequestColumns={requestColumns}
            />
            <ModelInspector
              connectionId={connectionId}
              table={inspectorTable}
              tableKeyStr={selectedKey}
              identityDraft={identityDraftForInspector}
              onIdentityDraftChange={(next) => {
                if (!selectedKey) return
                setIdentityDraftByKey((p) => ({ ...p, [selectedKey]: next }))
              }}
              columnOverrides={selectedKey ? columnOverridesByKey[selectedKey] ?? {} : {}}
              onColumnOverridesChange={(next) => {
                if (!selectedKey) return
                setColumnOverridesByKey((p) => ({ ...p, [selectedKey]: next }))
              }}
            />
          </div>
        </TabsContent>

        <TabsContent value="catalog" className="m-0 flex min-h-0 flex-1 data-[state=inactive]:hidden">
          <ModelCatalog
            tables={tables}
            onCanvasSet={onCanvasSet}
            selectedKey={selectedKey}
            onSelectKey={handleSelectKey}
            onAddToCanvas={handleAddToCanvas}
            onRemoveFromCanvas={handleRemoveFromCanvas}
            onRequestColumns={requestColumns}
          />
        </TabsContent>
      </Tabs>

      <DdlReviewDialog open={ddlOpen} onOpenChange={setDdlOpen} connectionId={connectionId} />
    </div>
  )
}
