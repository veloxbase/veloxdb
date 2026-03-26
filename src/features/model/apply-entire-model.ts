import { veloxDbRepository } from '@/data/repositories'
import type { TableInfo } from '@/data/types'
import type { TableKey } from '@/features/model/model-types'

export type ColumnOverride = {
  isNullable: boolean
  isUnique: boolean
}

export type TableIdentityDraft = {
  schema: string
  name: string
}

export function quotePgIdent(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`
}

/** Build ALTER statements to move from current catalog identity to draft (PostgreSQL). */
export function buildTableRenameStatements(
  current: Pick<TableInfo, 'schema' | 'name'>,
  draft: TableIdentityDraft,
): string[] {
  const tbl = `${quotePgIdent(current.schema)}.${quotePgIdent(current.name)}`

  if (draft.schema === current.schema && draft.name === current.name) {
    return []
  }

  if (draft.schema === current.schema && draft.name !== current.name) {
    return [`ALTER TABLE ${tbl} RENAME TO ${quotePgIdent(draft.name)}`]
  }

  if (draft.schema !== current.schema && draft.name === current.name) {
    return [`ALTER TABLE ${tbl} SET SCHEMA ${quotePgIdent(draft.schema)}`]
  }

  return [
    `ALTER TABLE ${tbl} RENAME TO ${quotePgIdent(draft.name)}`,
    `ALTER TABLE ${quotePgIdent(current.schema)}.${quotePgIdent(draft.name)} SET SCHEMA ${quotePgIdent(draft.schema)}`,
  ]
}

export type ApplyEntireModelParams = {
  connectionId: string
  onCanvas: TableKey[]
  tablesByKey: Map<TableKey, TableInfo>
  identityDraftByKey: Record<TableKey, TableIdentityDraft>
  columnOverridesByKey: Record<TableKey, Record<string, ColumnOverride>>
}

export type ApplyEntireModelResult = {
  renamed: Array<{ from: TableKey; to: TableKey }>
}

/**
 * Applies column constraint edits first (original table names), then runs rename/schema DDL in one transaction.
 */
export async function applyEntireModel({
  connectionId,
  onCanvas,
  tablesByKey,
  identityDraftByKey,
  columnOverridesByKey,
}: ApplyEntireModelParams): Promise<ApplyEntireModelResult> {
  const renamed: Array<{ from: TableKey; to: TableKey }> = []

  for (const key of onCanvas) {
    const table = tablesByKey.get(key)
    if (!table) continue

    const overrides = columnOverridesByKey[key]
    if (!overrides || Object.keys(overrides).length === 0) continue

    const props = await veloxDbRepository.getTableProperties(connectionId, table)
    let needsApply = false
    const columns = props.map((col) => {
      const o = overrides[col.columnName]
      const isNullable = o?.isNullable ?? col.isNullable
      const isUnique = o?.isUnique ?? col.isUnique
      if (isNullable !== col.isNullable || isUnique !== col.isUnique) {
        needsApply = true
      }
      return { columnName: col.columnName, isNullable, isUnique }
    })

    if (needsApply) {
      await veloxDbRepository.applyTableProperties({
        connectionId,
        tableSchema: table.schema,
        tableName: table.name,
        columns,
      })
    }
  }

  const renameStatements: string[] = []
  for (const key of onCanvas) {
    const table = tablesByKey.get(key)
    if (!table) continue
    const draft = identityDraftByKey[key] ?? { schema: table.schema, name: table.name }
    if (draft.schema === table.schema && draft.name === table.name) continue
    renameStatements.push(...buildTableRenameStatements(table, draft))
    renamed.push({ from: key, to: `${draft.schema}.${draft.name}` })
  }

  if (renameStatements.length > 0) {
    await veloxDbRepository.executeDdlTransaction({
      connectionId,
      statements: renameStatements,
    })
  }

  return { renamed }
}
