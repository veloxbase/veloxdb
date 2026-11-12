import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  AI_PROVIDERS,
  aiRequestHeaders,
  getAiProvider,
  inferAiProvider,
  requestChatCompletion,
} from './ai-providers'

describe('AI provider catalog', () => {
  it('has unique ids and a base URL for every non-custom provider', () => {
    const ids = AI_PROVIDERS.map((provider) => provider.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const provider of AI_PROVIDERS) {
      if (provider.id !== 'custom') expect(provider.baseUrl).toMatch(/^https?:\/\//)
    }
  })

  it('defaults unknown ids to DeepSeek', () => {
    expect(getAiProvider('nope').id).toBe('deepseek')
  })

  it('infers providers from saved base URLs', () => {
    expect(inferAiProvider('https://api.deepseek.com/v1')).toBe('deepseek')
    expect(inferAiProvider('https://api.anthropic.com/v1')).toBe('anthropic')
    expect(inferAiProvider('')).toBe('openrouter')
    expect(inferAiProvider('http://127.0.0.1:1234/v1')).toBe('lmstudio')
  })
})

describe('aiRequestHeaders', () => {
  it('sends a bearer key, or a placeholder for local servers only', () => {
    expect(aiRequestHeaders('sk-1').Authorization).toBe('Bearer sk-1')
    expect(aiRequestHeaders('', 'http://localhost:11434/v1').Authorization).toBe('Bearer ollama')
    expect(aiRequestHeaders('', 'https://api.openai.com/v1').Authorization).toBeUndefined()
  })
})

describe('requestChatCompletion', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('posts to {baseUrl}/chat/completions and returns the message', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"ok":true}' } }],
    })))
    vi.stubGlobal('fetch', fetchMock)
    const content = await requestChatCompletion({
      baseUrl: 'https://api.deepseek.com/v1/',
      apiKey: 'sk-1',
      model: 'deepseek-chat',
      systemPrompt: 's',
      userPrompt: 'u',
      json: true,
    })
    expect(content).toBe('{"ok":true}')
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.deepseek.com/v1/chat/completions')
    expect(JSON.parse(String(init.body))).toMatchObject({ model: 'deepseek-chat', response_format: { type: 'json_object' } })
  })

  it('surfaces provider errors with the status code', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad key', { status: 401 })))
    await expect(requestChatCompletion({
      baseUrl: 'https://api.openai.com/v1', apiKey: 'x', model: 'm', systemPrompt: 's', userPrompt: 'u',
    })).rejects.toThrow('401')
  })
})
