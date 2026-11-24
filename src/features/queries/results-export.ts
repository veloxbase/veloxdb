import { save } from '@tauri-apps/plugin-dialog'
import { veloxDbRepository } from '@/data/repositories'
import type { ResultRow } from '@/features/queries/result-edits'

function toDisplay(value: string | null | undefined) {
  return value ?? ''
}

function csvEscape(value: string) {
  if (value.includes('"') || value.includes(',') || value.includes('\n')) {
    return `"${value.replaceAll('"', '""')}"`
  }
  return value
}

function buildCsvContent(columns: string[], rows: ResultRow[]) {
  const header = columns.map(csvEscape).join(',')
  const body = rows.map((row) =>
    columns.map((col) => csvEscape(toDisplay(row[col]))).join(','),
  )
  return [header, ...body].join('\n')
}

function buildJsonContent(columns: string[], rows: ResultRow[]) {
  return JSON.stringify(
    rows.map((row) => {
      const obj: Record<string, string | null> = {}
      for (const col of columns) {
        obj[col] = row[col] ?? null
      }
      return obj
    }),
    null,
    2,
  )
}

export function buildMarkdownTableContent(columns: string[], rows: ResultRow[]): string {
  if (columns.length === 0) return ''
  const escapeCell = (val: string | null | undefined) => {
    if (val === null || val === undefined) return 'NULL'
    return String(val).replaceAll('|', '\\|').replaceAll('\n', '<br>')
  }
  const header = `| ${columns.map((col) => col.replaceAll('|', '\\|')).join(' | ')} |`
  const separator = `| ${columns.map(() => '---').join(' | ')} |`
  const body = rows.map((row) =>
    `| ${columns.map((col) => escapeCell(row[col])).join(' | ')} |`
  )
  return [header, separator, ...body].join('\n')
}

export function buildSqlInsertContent(
  tableName: string,
  columns: string[],
  rows: ResultRow[],
): string {
  if (columns.length === 0 || rows.length === 0) return ''
  const cleanTable = tableName.trim() || 'query_results'
  const quotedColumns = columns
    .map((col) => (col.startsWith('"') ? col : `"${col.replaceAll('"', '""')}"`))
    .join(', ')

  const formatSqlValue = (val: string | null | undefined) => {
    if (val === null || val === undefined) return 'NULL'
    return `'${String(val).replaceAll("'", "''")}'`
  }

  const valuesRows = rows.map((row) => {
    const values = columns.map((col) => formatSqlValue(row[col])).join(', ')
    return `  (${values})`
  })

  return `INSERT INTO ${cleanTable} (${quotedColumns})\nVALUES\n${valuesRows.join(',\n')};`
}

export async function copyRows(columns: string[], rows: ResultRow[]) {
  const header = columns.join('\t')
  const body = rows.map((row) =>
    columns.map((col) => toDisplay(row[col])).join('\t'),
  )
  await navigator.clipboard.writeText([header, ...body].join('\n'))
}

export async function copyRowsAsMarkdown(columns: string[], rows: ResultRow[]) {
  const content = buildMarkdownTableContent(columns, rows)
  await navigator.clipboard.writeText(content)
}

export async function copyRowsAsSqlInsert(
  tableName: string,
  columns: string[],
  rows: ResultRow[],
) {
  const content = buildSqlInsertContent(tableName, columns, rows)
  await navigator.clipboard.writeText(content)
}

export async function downloadRowsAsCsv(
  filename: string,
  columns: string[],
  rows: ResultRow[],
) {
  const path = await save({
    defaultPath: filename,
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  })
  if (!path) return

  const content = buildCsvContent(columns, rows)
  await veloxDbRepository.saveTextFile(content, path)
}

export async function downloadRowsAsJson(
  filename: string,
  columns: string[],
  rows: ResultRow[],
) {
  const path = await save({
    defaultPath: filename,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  })
  if (!path) return

  const content = buildJsonContent(columns, rows)
  await veloxDbRepository.saveTextFile(content, path)
}
