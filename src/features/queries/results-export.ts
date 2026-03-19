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

function downloadTextFile(filename: string, content: string, contentType: string) {
  const blob = new Blob([content], { type: contentType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')

  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export function downloadRowsAsCsv(filename: string, columns: string[], rows: ResultRow[]) {
  const header = columns.map(csvEscape).join(',')
  const body = rows
    .map((row) => columns.map((column) => csvEscape(toDisplay(row[column]))).join(','))
    .join('\n')
  const content = `${header}${body ? `\n${body}` : ''}`

  downloadTextFile(filename, content, 'text/csv;charset=utf-8')
}

export function downloadRowsAsJson(filename: string, columns: string[], rows: ResultRow[]) {
  const normalized = rows.map((row) =>
    columns.reduce<Record<string, string | null>>((accumulator, column) => {
      accumulator[column] = row[column] ?? null
      return accumulator
    }, {}),
  )
  downloadTextFile(filename, JSON.stringify(normalized, null, 2), 'application/json;charset=utf-8')
}

export async function copyRows(columns: string[], rows: ResultRow[]) {
  const lines = rows.map((row) => columns.map((column) => toDisplay(row[column])).join('\t')).join('\n')
  await navigator.clipboard.writeText(lines)
}
