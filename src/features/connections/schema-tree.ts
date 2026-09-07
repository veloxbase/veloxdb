import type { TableInfo } from '@/data/types'
import type { TreeDataItem } from '@/components/ui/tree-view'
import type { TableQuickSqlAction } from '@/features/queries/table-quick-actions'

export type SchemaCategory =
  | 'tables'
  | 'views'
  | 'materialized_views'
  | 'procedures'
  | 'functions'
  | 'sequences'

export type SchemaNodeData = {
  kind: 'schema'
  schema: string
  tableCount: number
}

export type CategoryNodeData = {
  kind: 'category'
  category: SchemaCategory
  schema: string
  label: string
  count: number
}

export function isSchemaNode(
  item: TreeDataItem,
): item is TreeDataItem & { data: SchemaNodeData } {
  return (
    item.id.startsWith('schema:') &&
    Boolean(item.data && typeof item.data === 'object' && (item.data as SchemaNodeData).kind === 'schema')
  )
}

export function isCategoryNode(
  item: TreeDataItem,
): item is TreeDataItem & { data: CategoryNodeData } {
  return (
    item.id.startsWith('category:') &&
    Boolean(item.data && typeof item.data === 'object' && (item.data as CategoryNodeData).kind === 'category')
  )
}

const CATEGORY_CONFIG: {
  key: SchemaCategory
  label: string
  matches: (table: TableInfo) => boolean
}[] = [
  {
    key: 'tables',
    label: 'Tables',
    matches: (t) => !t.kind || t.kind === 'table',
  },
  {
    key: 'views',
    label: 'Views',
    matches: (t) => t.kind === 'view',
  },
  {
    key: 'materialized_views',
    label: 'Materialized Views',
    matches: (t) => t.kind === 'materialized_view',
  },
]

export function buildSchemaTreeNodes(
  connectionId: string,
  tables: TableInfo[],
  onSelectTable: (table: TableInfo) => void,
  onTableQuickAction: (action: TableQuickSqlAction, connectionId: string, table: TableInfo) => void,
): TreeDataItem[] {
  const schemaMap = new Map<string, TableInfo[]>()
  for (const table of tables) {
    const schema = table.schema || 'public'
    let list = schemaMap.get(schema)
    if (!list) {
      list = []
      schemaMap.set(schema, list)
    }
    list.push(table)
  }

  const sortedSchemas = Array.from(schemaMap.keys()).sort((a, b) => a.localeCompare(b))

  return sortedSchemas.map((schema) => {
    const allSchemaItems = schemaMap.get(schema) ?? []
    const schemaId = `schema:${connectionId}:${schema}`

    // Partition relations into categories (Tables, Views, Materialized Views)
    // Only include categories that have count > 0 (zero-count suppression)
    const categoryNodes: TreeDataItem[] = []

    for (const config of CATEGORY_CONFIG) {
      const categoryItems = allSchemaItems
        .filter(config.matches)
        .sort((a, b) => a.name.localeCompare(b.name))

      if (categoryItems.length === 0) {
        // Zero items: suppress this category completely
        continue
      }

      const categoryId = `category:${connectionId}:${schema}:${config.key}`
      const children: TreeDataItem[] = categoryItems.map((t) => ({
        id: `table:${connectionId}:${t.schema}.${t.name}`,
        name: t.name,
        data: t,
        onDoubleClick: () => {
          onSelectTable(t)
          onTableQuickAction('selectAll', connectionId, t)
        },
      }))

      categoryNodes.push({
        id: categoryId,
        name: config.label,
        data: {
          kind: 'category',
          category: config.key,
          schema,
          label: config.label,
          count: categoryItems.length,
        } satisfies CategoryNodeData,
        children,
      })
    }

    return {
      id: schemaId,
      name: schema,
      data: {
        kind: 'schema',
        schema,
        tableCount: allSchemaItems.length,
      } satisfies SchemaNodeData,
      children: categoryNodes,
    }
  })
}
