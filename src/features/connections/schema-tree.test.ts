import { describe, expect, it, vi } from 'vitest'

import type { TableInfo } from '@/data/types'
import {
  buildSchemaTreeNodes,
  isCategoryNode,
  isSchemaNode,
  type CategoryNodeData,
  type SchemaNodeData,
} from '@/features/connections/schema-tree'
import type { TreeDataItem } from '@/components/ui/tree-view'

describe('schema-tree', () => {
  const sampleRelations: TableInfo[] = [
    { schema: 'chat', name: 'messages', previewQuery: 'SELECT * FROM chat.messages', kind: 'table' },
    { schema: 'business', name: 'ad_targeting_rules', previewQuery: 'SELECT * FROM business.ad_targeting_rules', kind: 'table' },
    { schema: 'chat', name: 'conversations', previewQuery: 'SELECT * FROM chat.conversations', kind: 'table' },
    { schema: 'chat', name: 'active_chat_users', previewQuery: 'SELECT * FROM chat.active_chat_users', kind: 'view' },
    { schema: 'public', name: 'users', previewQuery: 'SELECT * FROM public.users', kind: 'table' },
    { schema: 'public', name: 'user_activity_view', previewQuery: 'SELECT * FROM public.user_activity_view', kind: 'view' },
    { schema: 'public', name: 'daily_metrics_mv', previewQuery: 'SELECT * FROM public.daily_metrics_mv', kind: 'materialized_view' },
  ]

  it('groups relations under schemas and categories with zero-count suppression', () => {
    const onSelectTable = vi.fn()
    const onTableQuickAction = vi.fn()

    const nodes = buildSchemaTreeNodes('c1', sampleRelations, onSelectTable, onTableQuickAction)

    // Should have 3 schema nodes: business, chat, public
    expect(nodes).toHaveLength(3)

    // 1. business schema: has 1 table, 0 views, 0 materialized views
    const businessNode = nodes[0]
    expect(businessNode.id).toBe('schema:c1:business')
    expect(businessNode.name).toBe('business')
    expect(businessNode.data).toEqual({
      kind: 'schema',
      schema: 'business',
      tableCount: 1,
    })
    // Only "Tables" category should be rendered; Views and Materialized Views are hidden!
    expect(businessNode.children).toHaveLength(1)
    const businessTablesCategory = businessNode.children?.[0]
    expect(businessTablesCategory?.id).toBe('category:c1:business:tables')
    expect(businessTablesCategory?.name).toBe('Tables')
    expect(businessTablesCategory?.data).toEqual({
      kind: 'category',
      category: 'tables',
      schema: 'business',
      label: 'Tables',
      count: 1,
    })
    expect(businessTablesCategory?.children?.[0].name).toBe('ad_targeting_rules')

    // 2. chat schema: has 2 tables and 1 view (0 materialized views)
    const chatNode = nodes[1]
    expect(chatNode.id).toBe('schema:c1:chat')
    expect(chatNode.children).toHaveLength(2) // Tables and Views only

    const chatTablesCategory = chatNode.children?.[0]
    expect(chatTablesCategory?.id).toBe('category:c1:chat:tables')
    expect(chatTablesCategory?.name).toBe('Tables')
    expect(chatTablesCategory?.children?.map((c) => c.name)).toEqual(['conversations', 'messages'])

    const chatViewsCategory = chatNode.children?.[1]
    expect(chatViewsCategory?.id).toBe('category:c1:chat:views')
    expect(chatViewsCategory?.name).toBe('Views')
    expect(chatViewsCategory?.children?.map((c) => c.name)).toEqual(['active_chat_users'])

    // 3. public schema: has 1 table, 1 view, 1 materialized view
    const publicNode = nodes[2]
    expect(publicNode.id).toBe('schema:c1:public')
    expect(publicNode.children).toHaveLength(3)
    expect(publicNode.children?.map((c) => c.name)).toEqual(['Tables', 'Views', 'Materialized Views'])

    const mvCategory = publicNode.children?.[2]
    expect(mvCategory?.id).toBe('category:c1:public:materialized_views')
    expect(mvCategory?.name).toBe('Materialized Views')
    expect(mvCategory?.children?.[0].name).toBe('daily_metrics_mv')
  })

  it('completely hides empty categories when a schema only contains views', () => {
    const viewOnlyRelations: TableInfo[] = [
      { schema: 'analytics', name: 'churn_rate', previewQuery: 'SELECT * FROM churn_rate', kind: 'view' },
      { schema: 'analytics', name: 'retention', previewQuery: 'SELECT * FROM retention', kind: 'view' },
    ]

    const nodes = buildSchemaTreeNodes('c1', viewOnlyRelations, vi.fn(), vi.fn())

    expect(nodes).toHaveLength(1)
    const schemaNode = nodes[0]
    expect(schemaNode.name).toBe('analytics')
    // Tables category must NOT exist because count is 0
    expect(schemaNode.children).toHaveLength(1)
    expect(schemaNode.children?.[0].name).toBe('Views')
    expect(schemaNode.children?.[0].id).toBe('category:c1:analytics:views')
  })

  it('falls back to "public" when table.schema is empty or missing', () => {
    const tablesWithEmptySchema: TableInfo[] = [
      { schema: '', name: 'orphan_table', previewQuery: 'SELECT * FROM orphan_table' },
    ]

    const nodes = buildSchemaTreeNodes('c1', tablesWithEmptySchema, vi.fn(), vi.fn())

    expect(nodes).toHaveLength(1)
    expect(nodes[0].id).toBe('schema:c1:public')
    expect(nodes[0].children).toHaveLength(1)
    expect(nodes[0].children?.[0].name).toBe('Tables')
    expect(nodes[0].children?.[0].children?.[0].name).toBe('orphan_table')
  })

  it('triggers onSelectTable and onTableQuickAction on double click of a relation item', () => {
    const onSelectTable = vi.fn()
    const onTableQuickAction = vi.fn()

    const nodes = buildSchemaTreeNodes('c1', sampleRelations, onSelectTable, onTableQuickAction)
    const businessTableItem = nodes[0].children?.[0].children?.[0]
    expect(businessTableItem).toBeDefined()

    businessTableItem?.onDoubleClick?.()

    expect(onSelectTable).toHaveBeenCalledWith(sampleRelations[1])
    expect(onTableQuickAction).toHaveBeenCalledWith('selectAll', 'c1', sampleRelations[1])
  })

  it('correctly identifies schema and category nodes with type guards', () => {
    const schemaItem: TreeDataItem = {
      id: 'schema:c1:public',
      name: 'public',
      data: {
        kind: 'schema',
        schema: 'public',
        tableCount: 2,
      } satisfies SchemaNodeData,
    }

    const categoryItem: TreeDataItem = {
      id: 'category:c1:public:tables',
      name: 'Tables',
      data: {
        kind: 'category',
        category: 'tables',
        schema: 'public',
        label: 'Tables',
        count: 2,
      } satisfies CategoryNodeData,
    }

    const tableItem: TreeDataItem = {
      id: 'table:c1:public.users',
      name: 'users',
      data: sampleRelations[4],
    }

    expect(isSchemaNode(schemaItem)).toBe(true)
    expect(isSchemaNode(categoryItem)).toBe(false)
    expect(isSchemaNode(tableItem)).toBe(false)

    expect(isCategoryNode(categoryItem)).toBe(true)
    expect(isCategoryNode(schemaItem)).toBe(false)
    expect(isCategoryNode(tableItem)).toBe(false)
  })

  it('works across different database engines (SQLite/DuckDB "main", MySQL db name, Redis "0")', () => {
    // SQLite / DuckDB tables with schema "main"
    const sqliteTables: TableInfo[] = [
      { schema: 'main', name: 'todos', previewQuery: 'SELECT * FROM todos', kind: 'table' },
      { schema: 'main', name: 'active_todos_view', previewQuery: 'SELECT * FROM active_todos_view', kind: 'view' },
    ]
    const sqliteNodes = buildSchemaTreeNodes('c_sqlite', sqliteTables, vi.fn(), vi.fn())
    expect(sqliteNodes).toHaveLength(1)
    expect(sqliteNodes[0].name).toBe('main')
    // Both Tables and Views exist
    expect(sqliteNodes[0].children?.map((c) => c.name)).toEqual(['Tables', 'Views'])
    expect(sqliteNodes[0].children?.[0].children?.[0].name).toBe('todos')
    expect(sqliteNodes[0].children?.[1].children?.[0].name).toBe('active_todos_view')

    // MySQL tables with database name as schema
    const mysqlTables: TableInfo[] = [
      { schema: 'ecommerce', name: 'products', previewQuery: 'SELECT * FROM `ecommerce`.`products`', kind: 'table' },
      { schema: 'ecommerce', name: 'orders', previewQuery: 'SELECT * FROM `ecommerce`.`orders`', kind: 'table' },
    ]
    const mysqlNodes = buildSchemaTreeNodes('c_mysql', mysqlTables, vi.fn(), vi.fn())
    expect(mysqlNodes).toHaveLength(1)
    expect(mysqlNodes[0].name).toBe('ecommerce')
    expect(mysqlNodes[0].children).toHaveLength(1)
    expect(mysqlNodes[0].children?.[0].name).toBe('Tables')
    expect(mysqlNodes[0].children?.[0].children?.map((c) => c.name)).toEqual(['orders', 'products'])

    // Redis keys with schema "0"
    const redisKeys: TableInfo[] = [
      { schema: '0', name: 'user:session:1', previewQuery: 'GET user:session:1', kind: 'table' },
      { schema: '0', name: 'user:session:2', previewQuery: 'GET user:session:2', kind: 'table' },
    ]
    const redisNodes = buildSchemaTreeNodes('c_redis', redisKeys, vi.fn(), vi.fn())
    expect(redisNodes).toHaveLength(1)
    expect(redisNodes[0].name).toBe('0')
    expect(redisNodes[0].children).toHaveLength(1)
    expect(redisNodes[0].children?.[0].name).toBe('Tables')
    expect(redisNodes[0].children?.[0].children).toHaveLength(2)
  })
})
