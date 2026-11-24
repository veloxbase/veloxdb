import { describe, expect, it } from 'vitest'

import { queryKeys } from '@/data/query-keys'
import { hashVariables } from '@/features/dashboards/substitute-sql-variables'
import { hashString } from '@/lib/hash-string'

describe('shared-cache cellData query key resolution', () => {
  it('generates identical query keys for multiple widgets sharing the same sourceCellId', () => {
    const dashboardId = 'dash-123'
    const sourceCellId = 'sql-cell-1'
    const sql = 'SELECT * FROM users'
    const variableValues = { country: 'US' }

    const sqlHash = hashString(sql)
    const varsHash = hashVariables(variableValues)

    // Widget 1 (Chart) query key
    const widget1Key = queryKeys.cellData(dashboardId, sourceCellId, sqlHash, varsHash)

    // Widget 2 (KPI) query key
    const widget2Key = queryKeys.cellData(dashboardId, sourceCellId, sqlHash, varsHash)

    // SQL cell direct query key
    const directCellKey = queryKeys.cellData(dashboardId, sourceCellId, sqlHash, varsHash)

    expect(widget1Key).toEqual(widget2Key)
    expect(widget1Key).toEqual(directCellKey)
    expect(widget1Key).toEqual(['cellData', 'dash-123', 'sql-cell-1', sqlHash, varsHash])
  })

  it('generates distinct query keys for different variables or SQL', () => {
    const dashboardId = 'dash-123'
    const sourceCellId = 'sql-cell-1'
    const sql = 'SELECT * FROM users'

    const keyUS = queryKeys.cellData(dashboardId, sourceCellId, hashString(sql), hashVariables({ country: 'US' }))
    const keyEU = queryKeys.cellData(dashboardId, sourceCellId, hashString(sql), hashVariables({ country: 'EU' }))

    expect(keyUS).not.toEqual(keyEU)
  })
})
