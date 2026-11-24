import { describe, expect, it } from 'vitest'

import type { Widget } from '@/data/types'
import { getTextWidgetContent, resolveWidgetRendererKind } from '@/features/dashboards/widget-routing'

function widget(overrides: Partial<Widget>): Widget {
  return {
    id: 'w1',
    kind: 'chart',
    title: 'Test',
    query: null,
    viz: null,
    locked: false,
    ...overrides,
  }
}

describe('resolveWidgetRendererKind', () => {
  it('routes text widgets to text even when viz has chartType kpi', () => {
    const note = widget({
      kind: 'text',
      viz: { chartType: 'kpi', encodings: {}, options: { content: 'hello' } },
    })
    expect(resolveWidgetRendererKind(note)).toBe('text')
  })

  it('routes KPI charts by kind chart + viz chartType kpi', () => {
    const kpi = widget({
      kind: 'chart',
      viz: { chartType: 'kpi', encodings: { y: [{ column: 'total' }] }, options: {} },
      query: { providerId: 'sql-query', connectionId: 'c1', sql: 'select 1' },
    })
    expect(resolveWidgetRendererKind(kpi)).toBe('kpi')
  })

  it('routes bar charts to chart', () => {
    const bar = widget({
      kind: 'chart',
      viz: { chartType: 'bar', encodings: {}, options: {} },
    })
    expect(resolveWidgetRendererKind(bar)).toBe('chart')
  })

  it('routes table widgets to table', () => {
    expect(resolveWidgetRendererKind(widget({ kind: 'table' }))).toBe('table')
  })
})

describe('getTextWidgetContent', () => {
  it('reads content from viz options', () => {
    const note = widget({
      kind: 'text',
      viz: { chartType: 'line', encodings: {}, options: { content: 'Note body' } },
    })
    expect(getTextWidgetContent(note)).toBe('Note body')
  })

  it('returns empty string when content is missing', () => {
    expect(getTextWidgetContent(widget({ kind: 'text', viz: null }))).toBe('')
  })
})
