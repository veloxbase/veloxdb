import { describe, expect, it } from 'vitest'
import { buildGenerationSystemPrompt, parseGeneratedDashboardJson } from './generate-dashboard'

describe('parseGeneratedDashboardJson', () => {
  it('parses valid json object', () => {
    const raw = JSON.stringify({
      name: 'Sales Overview',
      description: 'Tracks ARR and MRR',
      widgets: [
        {
          title: 'Total Revenue',
          kind: 'kpi',
          sql: 'SELECT SUM(amount) AS total FROM orders',
        },
        {
          title: 'Monthly Trend',
          kind: 'chart',
          chartType: 'line',
          sql: 'SELECT date, sum(amount) as rev FROM orders GROUP BY 1',
        },
      ],
    })

    const parsed = parseGeneratedDashboardJson(raw)
    expect(parsed.name).toBe('Sales Overview')
    expect(parsed.description).toBe('Tracks ARR and MRR')
    expect(parsed.widgets).toHaveLength(2)
    expect(parsed.widgets[0]?.title).toBe('Total Revenue')
    expect(parsed.widgets[0]?.kind).toBe('kpi')
    expect(parsed.widgets[1]?.chartType).toBe('line')
  })

  it('keeps encodings from the model', () => {
    const raw = JSON.stringify({
      name: 'Mix',
      widgets: [
        {
          title: 'Revenue by plan',
          kind: 'chart',
          chartType: 'bar',
          encodings: { x: 'month', y: ['revenue'], series: 'plan' },
          sql: 'SELECT month, plan, sum(amount) AS revenue FROM orders GROUP BY 1, 2',
        },
      ],
    })
    const parsed = parseGeneratedDashboardJson(raw)
    expect(parsed.widgets[0]?.encodings).toEqual({
      x: 'month',
      y: ['revenue'],
      series: 'plan',
      size: undefined,
    })
  })

  it('strips markdown code fences', () => {
    const raw = `\`\`\`json
{
  "name": "Customer Retention",
  "description": "Retention metrics",
  "widgets": [
    {
      "title": "Churn Rate",
      "kind": "kpi",
      "sql": "SELECT 0.05 AS churn;"
    }
  ]
}
\`\`\``

    const parsed = parseGeneratedDashboardJson(raw)
    expect(parsed.name).toBe('Customer Retention')
    expect(parsed.widgets).toHaveLength(1)
    expect(parsed.widgets[0]?.sql).toBe('SELECT 0.05 AS churn')
  })

  it('handles embedded json in surrounding text', () => {
    const raw = `Here is your requested dashboard specification:
{
  "name": "User Activity",
  "widgets": [
    {
      "title": "Daily Active Users",
      "kind": "chart",
      "chartType": "bar",
      "sql": "SELECT day, count(*) as dau FROM logins GROUP BY 1"
    }
  ]
}
Hope this helps!`

    const parsed = parseGeneratedDashboardJson(raw)
    expect(parsed.name).toBe('User Activity')
    expect(parsed.widgets).toHaveLength(1)
  })

  it('throws error when no valid widgets exist', () => {
    const raw = JSON.stringify({ name: 'Empty', widgets: [] })
    expect(() => parseGeneratedDashboardJson(raw)).toThrow('No valid queries were generated for the dashboard.')
  })
})

describe('buildGenerationSystemPrompt', () => {
  it('asks for period-series KPIs and filter placeholders when a time column exists', () => {
    const prompt = buildGenerationSystemPrompt({
      dialect: 'PostgreSQL',
      formatting: 'Use DATE_TRUNC.',
      hasTimeColumn: true,
      variableInstructions: "Use {{date_from}} and {{date_to}}.",
    })
    expect(prompt).toContain('period series')
    expect(prompt).toContain('{{date_from}}')
    expect(prompt).toContain('sparkline')
  })

  it('skips the period-series KPI rule when no time column is available', () => {
    const prompt = buildGenerationSystemPrompt({
      dialect: 'PostgreSQL',
      formatting: 'Use DATE_TRUNC.',
      hasTimeColumn: false,
      variableInstructions: '',
    })
    expect(prompt).not.toContain('period series')
  })
})
