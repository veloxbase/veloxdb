import { isLocalAiEndpoint } from './settings'

export type OpenRouterModelOption = {
  id: string
  label: string
  source: 'popular' | 'api'
}

type OpenRouterApiListedModel = {
  id: string
  label: string
  source: 'api'
}

export const OPENROUTER_POPULAR_MODELS: OpenRouterModelOption[] = [
  { id: 'deepseek/deepseek-chat', label: 'DeepSeek Chat (cheap)', source: 'popular' },
  { id: 'openai/gpt-4o-mini', label: 'ChatGPT 4o Mini (tools)', source: 'popular' },
  { id: 'openai/gpt-4.1-mini', label: 'ChatGPT 4.1 Mini (tools)', source: 'popular' },
  { id: 'anthropic/claude-3.5-haiku', label: 'Claude 3.5 Haiku', source: 'popular' },
  { id: 'anthropic/claude-3.7-sonnet', label: 'Claude 3.7 Sonnet (best tools)', source: 'popular' },
  { id: 'google/gemini-2.0-flash-001', label: 'Gemini 2.0 Flash', source: 'popular' },
  { id: 'google/gemini-1.5-pro', label: 'Gemini 1.5 Pro', source: 'popular' },
]

export const OLLAMA_POPULAR_MODELS: OpenRouterModelOption[] = [
  { id: 'qwen2.5-coder:latest', label: 'Qwen 2.5 Coder (recommended)', source: 'popular' },
  { id: 'llama3.2:latest', label: 'Llama 3.2', source: 'popular' },
  { id: 'deepseek-coder:latest', label: 'DeepSeek Coder', source: 'popular' },
  { id: 'mistral:latest', label: 'Mistral', source: 'popular' },
  { id: 'codellama:latest', label: 'Code Llama', source: 'popular' },
]

function normalizeBaseUrl(baseUrl: string) {
  const trimmed = baseUrl.trim() || 'https://openrouter.ai/api/v1'
  return trimmed.replace(/\/+$/, '')
}

export async function fetchOpenRouterModels(
  apiKey: string,
  baseUrl: string,
): Promise<OpenRouterModelOption[]> {
  const token = apiKey.trim()
  const isLocal = isLocalAiEndpoint(baseUrl)
  const defaultPopular = isLocal ? OLLAMA_POPULAR_MODELS : OPENROUTER_POPULAR_MODELS

  if (!token && !isLocal) {
    return OPENROUTER_POPULAR_MODELS
  }

  const endpoint = `${normalizeBaseUrl(baseUrl)}/models`
  const headers: Record<string, string> = {}
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  try {
    const res = await fetch(endpoint, { headers })
    if (!res.ok) {
      if (isLocal) return OLLAMA_POPULAR_MODELS
      throw new Error(`Failed to fetch models from ${baseUrl} (HTTP ${res.status})`)
    }

    const payload = (await res.json()) as {
      data?: Array<{ id?: string; name?: string }>
    }
    const apiModels = (payload.data ?? [])
      .map((item): OpenRouterApiListedModel | null => {
        const id = item.id?.trim() ?? ''
        if (!id) return null
        return {
          id,
          label: item.name?.trim() || id,
          source: 'api',
        }
      })
      .filter((item): item is OpenRouterApiListedModel => item !== null)
      .slice(0, 120)

    const byId = new Map<string, OpenRouterModelOption>()
    for (const model of defaultPopular) byId.set(model.id, model)
    for (const model of apiModels) byId.set(model.id, model)
    return [...byId.values()]
  } catch (error) {
    if (isLocal) {
      return OLLAMA_POPULAR_MODELS
    }
    throw error
  }
}
