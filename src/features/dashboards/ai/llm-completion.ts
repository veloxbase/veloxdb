import { requestChatCompletion } from '@/lib/ai-providers'

export type LlmAuth = {
  model: string
  apiKey: string
  baseUrl?: string | null
}

export type LlmCompletion = (systemPrompt: string, userPrompt: string) => Promise<string>

export async function requestLlmCompletion(input: LlmAuth & {
  systemPrompt: string
  userPrompt: string
}): Promise<string> {
  return requestChatCompletion({
    baseUrl: input.baseUrl,
    apiKey: input.apiKey,
    model: input.model,
    systemPrompt: input.systemPrompt,
    userPrompt: input.userPrompt,
    json: true,
  })
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
