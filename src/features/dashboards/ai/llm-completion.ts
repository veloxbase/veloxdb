import { chatWithCloudStream } from '@/features/auth/cloud-client'
import { isLocalAiEndpoint } from '@/lib/settings'

export type LlmAuth = {
  model: string
  apiKey: string
  baseUrl?: string | null
  authMode: 'cloud' | 'byok'
}

export type LlmCompletion = (systemPrompt: string, userPrompt: string) => Promise<string>

export async function requestLlmCompletion(input: LlmAuth & {
  systemPrompt: string
  userPrompt: string
}): Promise<string> {
  const messages = [
    { role: 'system' as const, content: input.systemPrompt },
    { role: 'user' as const, content: input.userPrompt },
  ]

  if (input.authMode === 'cloud') {
    let accumulated = ''
    for await (const event of chatWithCloudStream({
      task: 'general',
      model: input.model,
      prompt: input.userPrompt,
      messages,
    })) {
      if (event.type === 'token') {
        accumulated += event.text
      } else if (event.type === 'error') {
        throw new Error(event.error)
      }
    }
    return accumulated
  }

  // BYOK (OpenRouter, Ollama, or OpenAI-compatible custom endpoint)
  const isLocal = isLocalAiEndpoint(input.baseUrl)
  const rawBaseUrl = input.baseUrl?.trim() || 'https://openrouter.ai/api/v1'
  const endpoint = `${rawBaseUrl.replace(/\/+$/, '')}/chat/completions`

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'HTTP-Referer': 'https://veloxdb.dev',
    'X-Title': 'VeloxDB',
  }

  const effectiveKey = input.apiKey?.trim() || (isLocal ? 'ollama' : '')
  if (effectiveKey) {
    headers['Authorization'] = `Bearer ${effectiveKey}`
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: input.model,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages,
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`AI request to ${rawBaseUrl} failed (${response.status}): ${text}`)
  }

  const payload = await response.json()
  const content = payload.choices?.[0]?.message?.content
  if (typeof content !== 'string') {
    throw new Error('AI response did not include message content.')
  }
  return content
}

export function bindLlmCompletion(auth: LlmAuth): LlmCompletion {
  return (systemPrompt, userPrompt) => requestLlmCompletion({ ...auth, systemPrompt, userPrompt })
}

/** Strips ```json fences and pulls the outermost object out of a model reply. */
export function extractJsonObject(raw: string): unknown {
  let cleaned = raw.trim()
  if (cleaned.startsWith('```json') || cleaned.startsWith('```JSON')) {
    cleaned = cleaned.slice(7)
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.slice(3)
  }
  if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3)
  cleaned = cleaned.trim()

  try {
    return JSON.parse(cleaned)
  } catch {
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start !== -1 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1))
    }
    throw new Error('AI output did not contain valid JSON.')
  }
}
