/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  AI_PROVIDERS,
  aiChatFetch,
  aiRequestHeaders,
  getAiProvider,
  inferAiProvider,
  normalizeChatChunk,
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

describe('chat stream normalization', () => {
  // Shapes DeepSeek / OpenAI actually stream: usage is null until the end.
  const deepseekChunk = {
    id: 'a1', object: 'chat.completion.chunk', created: 1731400000, model: 'deepseek-chat',
    system_fingerprint: null,
    choices: [{ index: 0, delta: { role: 'assistant', content: 'Hi', tool_calls: null }, logprobs: null, finish_reason: null }],
    usage: null,
  }
  const finalChunk = {
    id: 'a1', object: 'chat.completion.chunk', created: 1731400000, model: 'deepseek-chat',
    choices: [{ index: 0, delta: { content: '' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
  }

  it('produces chunks the chat client schema accepts', async () => {
    const { ChatStreamChunk$inboundSchema } = await import('@openrouter/sdk/models')
    expect(ChatStreamChunk$inboundSchema.safeParse(deepseekChunk).success).toBe(false)
    for (const chunk of [deepseekChunk, finalChunk]) {
      const result = ChatStreamChunk$inboundSchema.safeParse(normalizeChatChunk(chunk))
      expect(result.success, JSON.stringify(result.error?.issues)).toBe(true)
    }
  })

  it('keeps finish_reason null and fills fields some providers omit', () => {
    const out = normalizeChatChunk({ choices: [{ delta: { content: 'x' } }] }) as Record<string, any>
    expect(out.id).toBeTruthy()
    expect(typeof out.created).toBe('number')
    expect(out.choices[0]).toMatchObject({ index: 0, finish_reason: null })
  })

  it('rewrites an SSE stream split across arbitrary chunk boundaries', async () => {
    const sse = `data: ${JSON.stringify(deepseekChunk)}\n\ndata: ${JSON.stringify(finalChunk)}\n\ndata: [DONE]\n\n`
    const bytes = new TextEncoder().encode(sse)
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 37) controller.enqueue(bytes.slice(i, i + 37))
        controller.close()
      },
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } })))
    const response = await aiChatFetch('https://api.deepseek.com/v1/chat/completions', { method: 'POST' })
    const text = await response.text()
    vi.unstubAllGlobals()
    const events = text.split('\n').filter((line) => line.startsWith('data: ')).map((line) => line.slice(6))
    expect(events).toHaveLength(3)
    expect(events[2]).toBe('[DONE]')
    expect(JSON.parse(events[0])).not.toHaveProperty('usage')
    expect(JSON.parse(events[1]).usage.total_tokens).toBe(12)
  })
})

describe('tool-call stream chunks', () => {
  const base = { id: 'a', object: 'chat.completion.chunk', created: 1, model: 'deepseek-chat', system_fingerprint: null, usage: null }

  it('normalizes the DeepSeek tool-call sequence into valid chunks', async () => {
    const { ChatStreamChunk$inboundSchema } = await import('@openrouter/sdk/models')
    const first = { ...base, choices: [{ index: 0, delta: { role: 'assistant', content: null, tool_calls: [{ index: 0, id: 'call_0', type: 'function', function: { name: 'search_schema', arguments: '' } }] }, logprobs: null, finish_reason: null }] }
    const next = { ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"q"' } }] }, logprobs: null, finish_reason: null }] }
    const end = { ...base, choices: [{ index: 0, delta: { content: '' }, logprobs: null, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 1, completion_tokens_details: { reasoning_tokens: 0 } } }
    for (const chunk of [first, next, end]) {
      const result = ChatStreamChunk$inboundSchema.safeParse(normalizeChatChunk(chunk))
      expect(result.success, JSON.stringify(result.error?.issues)).toBe(true)
    }
  })
})
