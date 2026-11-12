import { isTauri } from '@tauri-apps/api/core'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'

/**
 * Bring-your-own-key AI providers. Every provider here speaks the OpenAI
 * chat-completions API (Anthropic and Gemini through their official
 * OpenAI-compatible endpoints), so the agent, inline refactor and dashboard
 * generation share one client.
 */
export type AiProviderId =
  | 'deepseek'
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'groq'
  | 'mistral'
  | 'xai'
  | 'openrouter'
  | 'ollama'
  | 'lmstudio'
  | 'custom'

export type AiModelOption = {
  id: string
  label: string
}

export type AiProvider = {
  id: AiProviderId
  label: string
  /** Default OpenAI-compatible base URL (without `/chat/completions`). */
  baseUrl: string
  requiresKey: boolean
  keyPlaceholder: string
  /** Where to create a key, shown as a hint in Settings. */
  keyUrl?: string
  /** Local server: no key, and the model list comes from the server. */
  local?: boolean
  /** Suggestions only; any model id the provider accepts can be typed. */
  models: AiModelOption[]
}

export const AI_PROVIDERS: AiProvider[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    requiresKey: true,
    keyPlaceholder: 'sk-...',
    keyUrl: 'platform.deepseek.com/api_keys',
    models: [
      { id: 'deepseek-chat', label: 'DeepSeek Chat' },
      { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner' },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    requiresKey: true,
    keyPlaceholder: 'sk-...',
    keyUrl: 'platform.openai.com/api-keys',
    models: [
      { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini' },
      { id: 'gpt-4.1', label: 'GPT-4.1' },
      { id: 'gpt-4o-mini', label: 'GPT-4o mini' },
      { id: 'o4-mini', label: 'o4-mini' },
    ],
  },
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    baseUrl: 'https://api.anthropic.com/v1',
    requiresKey: true,
    keyPlaceholder: 'sk-ant-...',
    keyUrl: 'console.anthropic.com/settings/keys',
    models: [
      { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
      { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
      { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
    ],
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    requiresKey: true,
    keyPlaceholder: 'AIza...',
    keyUrl: 'aistudio.google.com/apikey',
    models: [
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    ],
  },
  {
    id: 'groq',
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    requiresKey: true,
    keyPlaceholder: 'gsk_...',
    keyUrl: 'console.groq.com/keys',
    models: [
      { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B' },
    ],
  },
  {
    id: 'mistral',
    label: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    requiresKey: true,
    keyPlaceholder: 'API key',
    keyUrl: 'console.mistral.ai/api-keys',
    models: [
      { id: 'mistral-large-latest', label: 'Mistral Large' },
      { id: 'mistral-small-latest', label: 'Mistral Small' },
      { id: 'codestral-latest', label: 'Codestral' },
    ],
  },
  {
    id: 'xai',
    label: 'xAI (Grok)',
    baseUrl: 'https://api.x.ai/v1',
    requiresKey: true,
    keyPlaceholder: 'xai-...',
    keyUrl: 'console.x.ai',
    models: [
      { id: 'grok-3-mini', label: 'Grok 3 mini' },
      { id: 'grok-3', label: 'Grok 3' },
    ],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    requiresKey: true,
    keyPlaceholder: 'sk-or-v1-...',
    keyUrl: 'openrouter.ai/keys',
    models: [
      { id: 'deepseek/deepseek-chat', label: 'DeepSeek Chat' },
      { id: 'openai/gpt-4.1-mini', label: 'GPT-4.1 mini' },
      { id: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet 4' },
      { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    ],
  },
  {
    id: 'ollama',
    label: 'Ollama (local)',
    baseUrl: 'http://localhost:11434/v1',
    requiresKey: false,
    keyPlaceholder: 'Not needed',
    local: true,
    models: [
      { id: 'qwen2.5-coder:latest', label: 'Qwen 2.5 Coder' },
      { id: 'llama3.1:latest', label: 'Llama 3.1' },
    ],
  },
  {
    id: 'lmstudio',
    label: 'LM Studio (local)',
    baseUrl: 'http://localhost:1234/v1',
    requiresKey: false,
    keyPlaceholder: 'Not needed',
    local: true,
    models: [],
  },
  {
    id: 'custom',
    label: 'Custom (OpenAI-compatible)',
    baseUrl: '',
    requiresKey: false,
    keyPlaceholder: 'Optional',
    models: [],
  },
]

export const DEFAULT_AI_PROVIDER: AiProviderId = 'deepseek'

const PROVIDERS_BY_ID = new Map(AI_PROVIDERS.map((provider) => [provider.id, provider]))

export function isAiProviderId(value: unknown): value is AiProviderId {
  return typeof value === 'string' && PROVIDERS_BY_ID.has(value as AiProviderId)
}

export function getAiProvider(id: string | null | undefined): AiProvider {
  return PROVIDERS_BY_ID.get(id as AiProviderId) ?? PROVIDERS_BY_ID.get(DEFAULT_AI_PROVIDER)!
}

/** Best guess for settings saved before providers existed (base URL only). */
export function inferAiProvider(baseUrl: string | null | undefined): AiProviderId {
  const url = (baseUrl ?? '').trim().toLowerCase()
  if (!url || url.includes('openrouter.ai')) return 'openrouter'
  const match = AI_PROVIDERS.find(
    (provider) => provider.baseUrl && url.startsWith(provider.baseUrl.toLowerCase()),
  )
  if (match) return match.id
  if (url.includes(':11434')) return 'ollama'
  if (url.includes(':1234')) return 'lmstudio'
  return 'custom'
}

/** True for servers on this machine (Ollama, LM Studio, ...), which need no key. */
export function isLocalAiEndpoint(baseUrl: string | null | undefined): boolean {
  if (!baseUrl) return false
  const lower = baseUrl.toLowerCase()
  return (
    lower.includes('localhost') ||
    lower.includes('127.0.0.1') ||
    lower.includes('0.0.0.0') ||
    lower.includes(':11434') ||
    lower.includes(':1234')
  )
}

export function normalizeAiBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '')
}

/**
 * `fetch` routed through Tauri's Rust HTTP client. AI calls use it so the
 * webview CSP and provider CORS policies (most APIs block browser origins)
 * cannot get in the way of a user's own endpoint. Outside Tauri (tests, plain
 * browser) it falls back to the global `fetch`.
 */
export const aiFetch: typeof fetch = (input, init) =>
  isTauri() ? tauriFetch(input, init) : globalThis.fetch(input, init)

/**
 * The chat client validates every streamed chunk against OpenRouter's schema,
 * which only allows many fields to be absent, not `null`. OpenAI-style APIs
 * (DeepSeek, OpenAI, Groq, ...) send `"usage": null` on every chunk but the
 * last, plus null `system_fingerprint`, `tool_calls` and so on. Drop nulls
 * everywhere except `finish_reason` (required, and null until the end), and
 * fill the few required fields some providers leave out.
 */
export function normalizeChatChunk(chunk: unknown): unknown {
  const strip = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(strip)
    if (value === null || typeof value !== 'object') return value
    const out: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value)) {
      if (child === null && key !== 'finish_reason') continue
      out[key] = strip(child)
    }
    return out
  }
  const normalized = strip(chunk)
  if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) return normalized
  const record = normalized as Record<string, unknown>
  if (Array.isArray(record.choices)) {
    record.id ??= 'chatcmpl-veloxdb'
    record.created ??= Math.floor(Date.now() / 1000)
    record.model ??= ''
    for (const choice of record.choices as Array<Record<string, unknown>>) {
      if (choice && typeof choice === 'object') {
        choice.index ??= 0
        if (!('finish_reason' in choice)) choice.finish_reason = null
      }
    }
  }
  return record
}

/** Rewrites each `data: {...}` line of a server-sent-events stream. */
function normalizeEventStream(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ''
  const rewriteLine = (line: string): string => {
    const match = line.match(/^data:\s?(.*)$/)
    if (!match || match[1].trim() === '[DONE]' || !match[1].trim()) return line
    try {
      return `data: ${JSON.stringify(normalizeChatChunk(JSON.parse(match[1])))}`
    } catch {
      return line
    }
  }
  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      if (lines.length) controller.enqueue(encoder.encode(lines.map(rewriteLine).join('\n') + '\n'))
    },
    flush(controller) {
      buffer += decoder.decode()
      if (buffer) controller.enqueue(encoder.encode(rewriteLine(buffer)))
    },
  }))
}

/**
 * `aiFetch` for the chat client: normalizes streamed and JSON chat responses
 * from any OpenAI-compatible provider into the shape its schema expects.
 */
export const aiChatFetch: typeof fetch = async (input, init) => {
  const response = await aiFetch(input, init)
  const contentType = response.headers.get('content-type') ?? ''
  if (!response.ok || !response.body) return response
  const headers = new Headers(response.headers)
  headers.delete('content-length')
  if (contentType.includes('text/event-stream')) {
    return new Response(normalizeEventStream(response.body), {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  }
  if (contentType.includes('application/json')) {
    const payload = normalizeChatChunk(await response.json())
    return new Response(JSON.stringify(payload), {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  }
  return response
}

/**
 * `aiFetch` that turns a network failure (server down, wrong host, offline)
 * into a message that says which endpoint could not be reached.
 */
async function fetchOrExplain(url: string, init: RequestInit, root: string): Promise<Response> {
  try {
    return await aiFetch(url, init)
  } catch (error) {
    const local = isLocalAiEndpoint(root)
    const reason = error instanceof Error && error.message && !/failed to fetch|load failed|network/i.test(error.message)
      ? ` (${error.message})`
      : ''
    throw new Error(
      `Couldn't reach ${root}${reason}.${local ? " Make sure the server is running." : ' Check the endpoint and your internet connection.'}`,
    )
  }
}

/** Request headers for an OpenAI-compatible call. */
export function aiRequestHeaders(
  apiKey: string | null | undefined,
  baseUrl?: string | null,
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    // Sent for OpenRouter's app attribution; other providers ignore them.
    'HTTP-Referer': 'https://github.com/veloxbase/veloxdb',
    'X-Title': 'VeloxDB',
  }
  // Local servers accept any token, but some OpenAI-compatible ones reject a
  // request without one.
  const key = apiKey?.trim() || (isLocalAiEndpoint(baseUrl) ? 'ollama' : '')
  if (key) headers.Authorization = `Bearer ${key}`
  return headers
}

/**
 * Lists models from the provider's `/models` endpoint, merged after the
 * built-in suggestions. Falls back to the suggestions when the provider has
 * no listing or rejects the request.
 */
export async function fetchProviderModels(
  providerId: AiProviderId,
  apiKey: string,
  baseUrl: string,
): Promise<AiModelOption[]> {
  const provider = getAiProvider(providerId)
  const root = normalizeAiBaseUrl(baseUrl || provider.baseUrl)
  if (!root || (provider.requiresKey && !apiKey.trim())) return provider.models

  const headers = aiRequestHeaders(apiKey, root)
  if (providerId === 'anthropic') {
    // Anthropic's model listing is on its native API, which uses x-api-key.
    headers['x-api-key'] = apiKey.trim()
    headers['anthropic-version'] = '2023-06-01'
  }
  const response = await fetchOrExplain(`${root}/models`, { headers }, root)
  if (!response.ok) {
    throw new Error(`Could not list models from ${provider.label} (HTTP ${response.status}).`)
  }
  const payload = (await response.json()) as {
    data?: Array<{ id?: string; name?: string; display_name?: string }>
    models?: Array<{ name?: string; model?: string }>
  }
  const listed: AiModelOption[] = (payload.data ?? [])
    .map((item) => {
      const id = item.id?.trim() ?? ''
      return id ? { id, label: item.display_name?.trim() || item.name?.trim() || id } : null
    })
    .filter((item): item is AiModelOption => item !== null)
    .slice(0, 200)

  const byId = new Map<string, AiModelOption>()
  for (const model of provider.models) byId.set(model.id, model)
  for (const model of listed) if (!byId.has(model.id)) byId.set(model.id, model)
  return [...byId.values()]
}

export type ChatCompletionRequest = {
  baseUrl?: string | null
  apiKey?: string | null
  model: string
  systemPrompt: string
  userPrompt: string
  temperature?: number
  /** Ask for a JSON object reply where the provider supports it. */
  json?: boolean
}

/** One non-streaming chat completion against an OpenAI-compatible endpoint. */
export async function requestChatCompletion(request: ChatCompletionRequest): Promise<string> {
  const root = normalizeAiBaseUrl(request.baseUrl ?? '')
  if (!root) throw new Error('Set an AI provider in Settings → Veloxy.')
  const response = await fetchOrExplain(`${root}/chat/completions`, {
    method: 'POST',
    headers: aiRequestHeaders(request.apiKey, root),
    body: JSON.stringify({
      model: request.model,
      temperature: request.temperature ?? 0.1,
      ...(request.json ? { response_format: { type: 'json_object' } } : {}),
      messages: [
        { role: 'system', content: request.systemPrompt },
        { role: 'user', content: request.userPrompt },
      ],
    }),
  }, root)
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`AI request to ${root} failed (${response.status}): ${text.slice(0, 500)}`)
  }
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>
  }
  const content = payload.choices?.[0]?.message?.content
  if (typeof content !== 'string') {
    throw new Error('AI response did not include message content.')
  }
  return content
}
