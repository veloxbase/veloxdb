import type { QueryResult } from '@/data/types'

export type TypedCellValue = string | number | boolean | Date | null

export type TypedQueryResult = {
  columns: string[]
  rows: Array<Record<string, TypedCellValue>>
  rowCount: number
  truncated: boolean
}

const NUMERIC_PATTERN = /^-?\d+(\.\d+)?$/
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/

function coerceCell(value: string | null): TypedCellValue {
  if (value === null) return null
  if (NUMERIC_PATTERN.test(value)) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  if (ISO_DATE_PATTERN.test(value)) {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }
  return value
}

/**
 * Coerces the all-`string | null` cells VeloxDB's query engine returns into
 * typed JS values (number, Date, boolean stays string since SQL engines
 * already render booleans as `"true"`/`"false"`/`"1"`/`"0"` inconsistently
 * across drivers — chart/table consumers treat those as categorical text).
 */
export function coerceQueryResult(result: QueryResult): TypedQueryResult {
  const rows = result.rows.map((row) => {
    const typedRow: Record<string, TypedCellValue> = {}
    for (const column of result.columns) {
      typedRow[column] = coerceCell(row[column] ?? null)
    }
    return typedRow
  })

  return {
    columns: result.columns,
    rows,
    rowCount: result.rowCount,
    truncated: result.truncated,
  }
}
