import type { Entitlements } from '@/data/types'
import { cloudApiUrl } from '@/features/auth/cloud-config'
import { clearCloudApiKey, getCloudApiKeySync } from '@/features/auth/cloud-credentials'

export type CloudUser = {
  userId: string
  email: string | null
  name: string | null
  image: string | null
  organizationId: string | null
}

export type DesktopExchangeResult = {
  accessToken: string
  tokenType: string
  keyId: string
  user: CloudUser
}

export type CloudAiUsage = {
  plan: string
  remaining: {
    dailyRequests: number
    monthlyRequests: number
    monthlyTokens: number
  }
}

export type CloudAiModel = {
  id: string
  slug: string
  displayName: string
  task: string
  supportsTools?: boolean
}

export type CloudChatToolCall = {
  id: string
  type?: 'function'
  function: { name: string; arguments: string }
}

export type CloudChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  toolCallId?: string
  name?: string
  toolCalls?: CloudChatToolCall[]
}

export type CloudFunctionTool = {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters?: Record<string, unknown>
  }
}

export type CloudChatRequest = {
  task: 'sql_generate' | 'sql_explain' | 'sql_fix' | 'general'
  prompt?: string
  model?: string
  dialect?: string
  messages?: CloudChatMessage[]
  tools?: CloudFunctionTool[]
}

export type CloudStreamEvent =
  | { type: 'token'; text: string }
  | { type: 'tool_call'; id: string; name: string; arguments: string }
  | { type: 'done'; model: string; usage?: unknown }
  | { type: 'error'; error: string }

/** Abort a silent SSE body so a hung DeepSeek/Cloudflare stream cannot sit for minutes. */
export const CLOUD_STREAM_IDLE_MS = 20_000

function abortError(message: string): Error {
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

async function readStreamIdle(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  idleMs: number,
  signal?: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (signal?.aborted) throw abortError('Aborted')
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      void reader.cancel().catch(() => undefined)
      reject(new Error('Velox Cloud stopped sending data. The model may have stalled — try again.'))
    }, idleMs)
    const onAbort = () => {
      cleanup()
      void reader.cancel().catch(() => undefined)
      reject(abortError('Aborted'))
    }
    const cleanup = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    reader.read().then(
      (result) => {
        cleanup()
        resolve(result)
      },
      (error) => {
        cleanup()
        reject(error)
      },
    )
  })
}

export type CloudChatResponse = {
  text: string
  model: string
  provider: string
}

export function isUnauthorizedStatus(status: number): boolean {
  return status === 401
}

export function parseExchangeResponse(data: unknown): DesktopExchangeResult {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid sign-in response.')
  }
  const body = data as {
    accessToken?: unknown
    tokenType?: unknown
    keyId?: unknown
    user?: {
      userId?: unknown
      email?: unknown
      name?: unknown
      image?: unknown
      organizationId?: unknown
    }
  }
  if (typeof body.accessToken !== 'string' || !body.accessToken.trim()) {
    throw new Error('Sign-in response is missing an access token.')
  }
  if (!body.user || typeof body.user.userId !== 'string') {
    throw new Error('Sign-in response is missing user details.')
  }
  return {
    accessToken: body.accessToken,
    tokenType: typeof body.tokenType === 'string' ? body.tokenType : 'Bearer',
    keyId: typeof body.keyId === 'string' ? body.keyId : '',
    user: {
      userId: body.user.userId,
      email: typeof body.user.email === 'string' ? body.user.email : null,
      name: typeof body.user.name === 'string' ? body.user.name : null,
      image: typeof body.user.image === 'string' ? body.user.image : null,
      organizationId:
        typeof body.user.organizationId === 'string' ? body.user.organizationId : null,
    },
  }
}

export function parseMeResponse(data: unknown): CloudUser {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid account response.')
  }
  const body = data as {
    userId?: unknown
    email?: unknown
    name?: unknown
    image?: unknown
    organizationId?: unknown
    user?: {
      id?: unknown
      userId?: unknown
      email?: unknown
      name?: unknown
      image?: unknown
      organizationId?: unknown
    }
  }
  const nested = body.user && typeof body.user === 'object' ? body.user : null
  const userId =
    typeof body.userId === 'string' && body.userId
      ? body.userId
      : typeof nested?.id === 'string' && nested.id
        ? nested.id
        : typeof nested?.userId === 'string' && nested.userId
          ? nested.userId
          : ''

  if (!userId) {
    throw new Error('Account response is missing a user id.')
  }
  return {
    userId,
    email:
      typeof body.email === 'string'
        ? body.email
        : typeof nested?.email === 'string'
          ? nested.email
          : null,
    name:
      typeof body.name === 'string'
        ? body.name
        : typeof nested?.name === 'string'
          ? nested.name
          : null,
    image:
      typeof body.image === 'string'
        ? body.image
        : typeof nested?.image === 'string'
          ? nested.image
          : null,
    organizationId:
      typeof body.organizationId === 'string'
        ? body.organizationId
        : typeof nested?.organizationId === 'string'
          ? nested.organizationId
          : null,
  }
}

export function parseEntitlementsResponse(data: unknown): Entitlements {
  if (!data || typeof data !== 'object') {
    return {
      bi: false,
      ai: false,
      teamSharing: false,
      plan: 'free',
      status: 'inactive',
      currentPeriodEnd: null,
    }
  }
  const body = data as {
    bi?: unknown
    ai?: unknown
    teamSharing?: unknown
    plan?: unknown
    status?: unknown
    currentPeriodEnd?: unknown
    entitlements?: {
      bi?: unknown
      ai?: unknown
      teamSharing?: unknown
      plan?: unknown
      status?: unknown
      currentPeriodEnd?: unknown
    }
  }
  const source =
    body.entitlements && typeof body.entitlements === 'object'
      ? body.entitlements
      : body

  const rawPlan = typeof source.plan === 'string' ? source.plan : 'free'
  const plan: 'free' | 'cloud' | 'pro' | 'team' =
    rawPlan === 'pro' || rawPlan === 'team' || rawPlan === 'cloud' ? rawPlan : 'free'
  const rawStatus = typeof source.status === 'string' ? source.status : 'inactive'
  const status: 'active' | 'trialing' | 'canceled' | 'inactive' =
    rawStatus === 'active' ||
    rawStatus === 'trialing' ||
    rawStatus === 'canceled'
      ? rawStatus
      : 'inactive'

  const isEntitled =
    (plan === 'pro' || plan === 'team' || plan === 'cloud') &&
    (status === 'active' || status === 'trialing')

  const bi = typeof source.bi === 'boolean' ? source.bi : isEntitled
  const ai = typeof source.ai === 'boolean' ? source.ai : isEntitled
  const teamSharing =
    typeof source.teamSharing === 'boolean' ? source.teamSharing : plan === 'team'
  const currentPeriodEnd =
    typeof source.currentPeriodEnd === 'string' ? source.currentPeriodEnd : null

  return {
    bi,
    ai,
    teamSharing,
    plan,
    status,
    currentPeriodEnd,
  }
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown }
    if (typeof body.error === 'string' && body.error.trim()) return body.error
  } catch {
    // Fall through to status text.
  }
  return response.statusText || `Request failed (${response.status})`
}

async function authorizedFetch(
  path: string,
  init: RequestInit = {},
  apiKey = getCloudApiKeySync(),
): Promise<Response> {
  if (!apiKey?.trim()) {
    throw new Error('Sign in to Velox Cloud first.')
  }

  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${apiKey}`)
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const response = await fetch(cloudApiUrl(path), { ...init, headers })
  if (isUnauthorizedStatus(response.status)) {
    await clearCloudApiKey()
  }
  return response
}

export async function exchangeDesktopCode(input: {
  code: string
  code_verifier: string
}): Promise<DesktopExchangeResult> {
  const response = await fetch(cloudApiUrl('/api/v1/auth/desktop/exchange'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const data: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
        ? data.error
        : 'Failed to complete desktop sign-in.'
    throw new Error(message)
  }
  return parseExchangeResponse(data)
}

export async function fetchMe(apiKey?: string): Promise<CloudUser> {
  const response = await authorizedFetch('/api/v1/me', { method: 'GET' }, apiKey ?? getCloudApiKeySync())
  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }
  return parseMeResponse(await response.json())
}

export async function fetchEntitlements(apiKey?: string): Promise<Entitlements> {
  const response = await authorizedFetch(
    '/api/v1/me/entitlements',
    { method: 'GET' },
    apiKey ?? getCloudApiKeySync(),
  )
  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }
  return parseEntitlementsResponse(await response.json())
}

export async function fetchAiUsage(): Promise<CloudAiUsage> {
  const response = await authorizedFetch('/api/v1/ai/usage')
  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }
  return (await response.json()) as CloudAiUsage
}

export async function fetchAiModels(): Promise<CloudAiModel[]> {
  const response = await authorizedFetch('/api/v1/ai/models')
  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }
  const body = (await response.json()) as { models?: CloudAiModel[] }
  return Array.isArray(body.models) ? body.models : []
}

export async function measureCloudLatency(): Promise<{ latencyMs: number; ok: boolean }> {
  const start = performance.now()
  try {
    const response = await authorizedFetch('/api/v1/ai/models')
    const latencyMs = Math.round(performance.now() - start)
    return { latencyMs, ok: response.ok }
  } catch {
    const latencyMs = Math.round(performance.now() - start)
    return { latencyMs, ok: false }
  }
}

export async function chatWithCloud(input: CloudChatRequest): Promise<CloudChatResponse> {
  const response = await authorizedFetch('/api/v1/ai/chat', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }
  return (await response.json()) as CloudChatResponse
}

export async function* chatWithCloudStream(
  input: CloudChatRequest,
  signal?: AbortSignal,
): AsyncGenerator<CloudStreamEvent> {
  let response: Response | null = null
  let lastError: Error | null = null

  // Transient retry on 502/503/504 or initial network glitch
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (signal?.aborted) return
      response = await authorizedFetch('/api/v1/ai/chat/stream', {
        method: 'POST',
        body: JSON.stringify(input),
        signal,
      })

      if (response.status >= 502 && response.status <= 504 && attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 350))
        continue
      }
      break
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      if (signal?.aborted || attempt > 0) throw lastError
      await new Promise((resolve) => setTimeout(resolve, 350))
    }
  }

  if (!response) {
    throw lastError || new Error('Failed to connect to Velox Cloud AI.')
  }
  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }
  if (!response.body) {
    throw new Error('Velox Cloud returned an empty stream.')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await readStreamIdle(reader, CLOUD_STREAM_IDLE_MS, signal)
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const blocks = buffer.split('\n\n')
      buffer = blocks.pop() ?? ''
      for (const block of blocks) {
        const event = parseCloudSseBlock(block)
        if (!event) continue
        yield event
        if (event.type === 'done' || event.type === 'error') return
      }
    }
    const trailing = parseCloudSseBlock(buffer)
    if (trailing) yield trailing
  } finally {
    reader.releaseLock()
  }
}

export function parseCloudSseBlock(block: string): CloudStreamEvent | null {
  const lines = block
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.startsWith('data:'))
  if (lines.length === 0) return null
  const payload = lines.map((line) => line.slice(5).trimStart()).join('\n')
  if (!payload || payload === '[DONE]') return null
  try {
    const parsed = JSON.parse(payload) as Partial<CloudStreamEvent> & { error?: unknown }
    if (parsed.type === 'token' && typeof parsed.text === 'string') {
      return { type: 'token', text: parsed.text }
    }
    if (
      parsed.type === 'tool_call' &&
      typeof parsed.id === 'string' &&
      typeof parsed.name === 'string' &&
      typeof parsed.arguments === 'string'
    ) {
      return {
        type: 'tool_call',
        id: parsed.id,
        name: parsed.name,
        arguments: parsed.arguments,
      }
    }
    if (parsed.type === 'done') {
      return { type: 'done', model: typeof parsed.model === 'string' ? parsed.model : '', usage: parsed.usage }
    }
    if (parsed.type === 'error') {
      const error = typeof parsed.error === 'string' ? parsed.error : 'Velox Cloud stream failed'
      return { type: 'error', error }
    }
  } catch {
    return null
  }
  return null
}
