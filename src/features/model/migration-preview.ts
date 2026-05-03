import type { TableInfo } from '@/data/types'
import {
  type TableIdentityDraft,
  type ColumnOverride,
  type ColumnIdentityOverride,
  type PendingModelColumn,
  type PendingModelForeignKey,
  type PendingModelRule,
  type PendingModelTrigger,
  type PendingModelRlsPolicy,
  type PendingCreateTable,
  buildAddColumnStatement,
  buildAddForeignKeyStatement,
  buildCreateTableStatement,
  buildTableRenameStatements,
  quotePgIdent,
} from '@/features/model/apply-entire-model'
import type { TableKey } from '@/features/model/model-types'

export type MigrationChange = {
  kind:
    | 'add_column'
    | 'add_foreign_key'
    | 'rename_table'
    | 'column_identity_change'
    | 'column_override'
    | 'create_table'
    | 'rule'
    | 'trigger'
    | 'rls_policy'
  tableKey: TableKey
  description: string
  sql: string | string[]
}

export type MigrationSummary = {
  changes: MigrationChange[]
  totalStatements: number
}

export function buildMigrationSummary(params: {
  onCanvas: TableKey[]
  tablesByKey: Map<TableKey, TableInfo>
  identityDraftByKey: Record<TableKey, TableIdentityDraft>
  columnOverridesByKey: Record<TableKey, Record<string, ColumnOverride>>
  columnIdentityOverridesByKey: Record<TableKey, Record<string, ColumnIdentityOverride>>
  pendingAddColumnsByKey: Record<TableKey, PendingModelColumn[]>
  pendingForeignKeys: PendingModelForeignKey[]
  pendingRules: PendingModelRule[]
  pendingTriggers: PendingModelTrigger[]
  pendingRlsPolicies: PendingModelRlsPolicy[]
  pendingCreateTables: PendingCreateTable[]
}): MigrationSummary {
  const changes: MigrationChange[] = []
  const { onCanvas, tablesByKey, identityDraftByKey, columnOverridesByKey, columnIdentityOverridesByKey, pendingAddColumnsByKey, pendingForeignKeys, pendingRules, pendingTriggers, pendingRlsPolicies, pendingCreateTables } = params

  for (const key of onCanvas) {
    const table = tablesByKey.get(key)
    if (!table) continue

    const cio = columnIdentityOverridesByKey[key]
    if (cio && Object.keys(cio).length > 0) {
      for (const [baseCol, override] of Object.entries(cio)) {
        const stmts: string[] = []
        const tblRef = `${quotePgIdent(table.schema)}.${quotePgIdent(table.name)}`
        if (override.nextDataType.trim() && override.nextDataType.trim() !== '') {
          stmts.push(`ALTER TABLE ${tblRef} ALTER COLUMN ${quotePgIdent(baseCol)} TYPE ${override.nextDataType.trim()}`)
        }
        if (override.nextColumnName.trim() && override.nextColumnName.trim() !== baseCol) {
          stmts.push(`ALTER TABLE ${tblRef} RENAME COLUMN ${quotePgIdent(baseCol)} TO ${quotePgIdent(override.nextColumnName.trim())}`)
        }
        if (stmts.length > 0) {
          changes.push({
            kind: 'column_identity_change',
            tableKey: key,
            description: `Modify column "${baseCol}" on ${table.schema}.${table.name}`,
            sql: stmts,
          })
        }
      }
    }
  }

  for (const key of onCanvas) {
    const table = tablesByKey.get(key)
    if (!table) continue
    const adds = pendingAddColumnsByKey[key]
    if (!adds?.length) continue
    for (const col of adds) {
      if (!col.columnName.trim() || !col.dataType.trim()) continue
      const sql = buildAddColumnStatement(table, col)
      changes.push({
        kind: 'add_column',
        tableKey: key,
        description: `Add column "${col.columnName}" (${col.dataType}) to ${table.schema}.${table.name}`,
        sql,
      })
    }
  }

  for (const fk of pendingForeignKeys) {
    if (fk.fromKey === fk.toKey) continue
    const fromT = tablesByKey.get(fk.fromKey)
    const toT = tablesByKey.get(fk.toKey)
    if (!fromT || !toT) continue
    if (!fk.fromColumn.trim() || !fk.toColumn.trim()) continue
    const sql = buildAddForeignKeyStatement(fromT, fk.fromColumn.trim(), toT, fk.toColumn.trim(), fk.constraintName)
    changes.push({
      kind: 'add_foreign_key',
      tableKey: fk.fromKey,
      description: `FK: ${fromT.schema}.${fromT.name}.${fk.fromColumn} → ${toT.schema}.${toT.name}.${fk.toColumn}`,
      sql,
    })
  }

  for (const key of onCanvas) {
    const table = tablesByKey.get(key)
    if (!table) continue
    const overrides = columnOverridesByKey[key]
    if (!overrides || Object.keys(overrides).length === 0) continue
    for (const [colName, override] of Object.entries(overrides)) {
      changes.push({
        kind: 'column_override',
        tableKey: key,
        description: `Set ${colName}: NULL=${override.isNullable}, UNIQUE=${override.isUnique} on ${table.schema}.${table.name}`,
        sql: `-- ALTER TABLE ${quotePgIdent(table.schema)}.${quotePgIdent(table.name)} ALTER "${colName}" ${override.isNullable ? 'DROP NOT NULL' : 'SET NOT NULL'}`,
      })
    }
  }

  for (const key of onCanvas) {
    const table = tablesByKey.get(key)
    if (!table) continue
    const draft = identityDraftByKey[key]
    if (!draft || (draft.schema === table.schema && draft.name === table.name)) continue
    const stmts = buildTableRenameStatements(table, draft)
    changes.push({
      kind: 'rename_table',
      tableKey: key,
      description: `Rename table ${table.schema}.${table.name} → ${draft.schema}.${draft.name}`,
      sql: stmts,
    })
  }

  for (const rule of pendingRules) {
    changes.push({ kind: 'rule', tableKey: rule.tableKey, description: `Rule: ${rule.title ?? rule.operation}`, sql: rule.sql })
  }

  for (const trigger of pendingTriggers) {
    changes.push({ kind: 'trigger', tableKey: trigger.tableKey, description: `Trigger: ${trigger.title ?? trigger.operation}`, sql: trigger.sql })
  }

  for (const policy of pendingRlsPolicies) {
    changes.push({ kind: 'rls_policy', tableKey: policy.tableKey, description: `RLS Policy: ${policy.title ?? policy.operation}`, sql: policy.sql })
  }

  for (const ct of pendingCreateTables) {
    if (!ct.name.trim()) continue
    const tk: TableKey = `${ct.schema.trim() || 'public'}.${ct.name.trim()}`
    const sql = buildCreateTableStatement(ct)
    changes.push({
      kind: 'create_table',
      tableKey: tk,
      description: `Create table ${ct.schema.trim() || 'public'}.${ct.name.trim()}`,
      sql,
    })
  }

  const totalStatements = changes.reduce((sum, c) => {
    const cnt = Array.isArray(c.sql) ? c.sql.length : (c.sql.trim() ? 1 : 0)
    return sum + cnt
  }, 0)

  return { changes, totalStatements }
}

export function buildMigrationSql(summary: MigrationSummary): string {
  const lines: string[] = [
    '-- VeloxDB Migration',
    `-- Generated: ${new Date().toISOString()}`,
    `-- Total statements: ${summary.totalStatements}`,
    '',
  ]

  const kindLabels: Record<string, string> = {
    create_table: 'Create Tables',
    add_column: 'Add Columns',
    add_foreign_key: 'Foreign Keys',
    rename_table: 'Table Renames',
    column_identity_change: 'Column Identity Changes',
    column_override: 'Column Overrides',
    rule: 'Rules',
    trigger: 'Triggers',
    rls_policy: 'RLS Policies',
  }

  const byKind = new Map<string, string[]>()
  for (const change of summary.changes) {
    const sqls = Array.isArray(change.sql) ? change.sql : [change.sql].filter((s) => s.trim())
    if (sqls.length === 0) continue
    const existing = byKind.get(change.kind) ?? []
    existing.push(...sqls)
    byKind.set(change.kind, existing)
  }

  for (const [kind, label] of Object.entries(kindLabels)) {
    const sqls = byKind.get(kind)
    if (!sqls?.length) continue
    lines.push(`-- ${label}`)
    lines.push(...sqls)
    lines.push('')
  }

  return lines.join('\n') + '\n'
}
