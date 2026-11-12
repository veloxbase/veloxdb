import { describe, expect, it } from 'vitest'
import { cleanInlineSqlResponse } from './inline-refactor'

describe('cleanInlineSqlResponse', () => {
  it('strips markdown sql fences', () => {
    const raw = '```sql\nSELECT id, name FROM users WHERE active = true;\n```'
    expect(cleanInlineSqlResponse(raw)).toBe('SELECT id, name FROM users WHERE active = true;')
  })

  it('strips uppercase SQL markdown fences', () => {
    const raw = '```SQL\nSELECT 1;\n```'
    expect(cleanInlineSqlResponse(raw)).toBe('SELECT 1;')
  })

  it('handles raw SQL without fences', () => {
    const raw = 'SELECT * FROM orders ORDER BY created_at DESC LIMIT 10;'
    expect(cleanInlineSqlResponse(raw)).toBe('SELECT * FROM orders ORDER BY created_at DESC LIMIT 10;')
  })
})

describe('requestInlineRefactor', () => {
  it('calls custom baseUrl with appropriate endpoint and auth header', async () => {
    const originalFetch = globalThis.fetch
    let capturedUrl = ''
    let capturedHeaders: Record<string, string> = {}

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedHeaders = (init?.headers as Record<string, string>) || {}
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'SELECT * FROM items WHERE price > 100;' } }],
      }), { status: 200 })
    }

    try {
      const { requestInlineRefactor } = await import('./inline-refactor')
      const result = await requestInlineRefactor({
        selectedSql: 'SELECT * FROM items;',
        fullSql: 'SELECT * FROM items;',
        instruction: 'Filter for items with price greater than 100',
        dialect: 'PostgreSQL',
        model: 'deepseek/deepseek-chat',
        apiKey: 'test-key',
        baseUrl: 'https://custom-ai.internal/v1',
        authMode: 'byok',
      })

      expect(capturedUrl).toBe('https://custom-ai.internal/v1/chat/completions')
      expect(capturedHeaders['Authorization']).toBe('Bearer test-key')
      expect(result).toBe('SELECT * FROM items WHERE price > 100;')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('supports local Ollama endpoint without requiring an API key', async () => {
    const originalFetch = globalThis.fetch
    let capturedUrl = ''
    let capturedHeaders: Record<string, string> = {}

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedHeaders = (init?.headers as Record<string, string>) || {}
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'SELECT count(*) FROM logs;' } }],
      }), { status: 200 })
    }

    try {
      const { requestInlineRefactor } = await import('./inline-refactor')
      const result = await requestInlineRefactor({
        selectedSql: 'SELECT * FROM logs;',
        fullSql: 'SELECT * FROM logs;',
        instruction: 'Count all logs',
        dialect: 'ClickHouse',
        model: 'qwen2.5-coder:latest',
        apiKey: '',
        baseUrl: 'http://localhost:11434/v1',
        authMode: 'byok',
      })

      expect(capturedUrl).toBe('http://localhost:11434/v1/chat/completions')
      expect(capturedHeaders['Authorization']).toBe('Bearer ollama')
      expect(result).toBe('SELECT count(*) FROM logs;')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
