import { describe, expect, it } from 'vitest'
import { interpolateVariables } from './MarkdownRenderer'

describe('interpolateVariables', () => {
  it('interpolates single variable in markdown text', () => {
    const text = 'Sales for country: {{country}} in year {{year}}.'
    const vars = { country: 'Germany', year: '2026' }
    expect(interpolateVariables(text, vars)).toBe('Sales for country: Germany in year 2026.')
  })

  it('leaves unbound variables formatted as {{var}}', () => {
    const text = 'Hello {{missing}}!'
    expect(interpolateVariables(text, {})).toBe('Hello {{missing}}!')
  })

  it('handles spaces inside variable brackets', () => {
    const text = 'Total: {{ amount }}'
    expect(interpolateVariables(text, { amount: '$100k' })).toBe('Total: $100k')
  })
})
