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
  { id: 'openai/gpt-4o-mini', label: 'ChatGPT 4o Mini', source: 'popular' },
  { id: 'openai/gpt-4.1-mini', label: 'ChatGPT 4.1 Mini', source: 'popular' },
  { id: 'anthropic/claude-3.5-haiku', label: 'Claude 3.5 Haiku', source: 'popular' },
  { id: 'anthropic/claude-3.7-sonnet', label: 'Claude 3.7 Sonnet', source: 'popular' },
  { id: 'google/gemini-2.0-flash-001', label: 'Gemini 2.0 Flash', source: 'popular' },
  { id: 'google/gemini-1.5-pro', label: 'Gemini 1.5 Pro', source: 'popular' },
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
  if (!token) {
    return OPENROUTER_POPULAR_MODELS
  }

  const endpoint = `${normalizeBaseUrl(baseUrl)}/models`
  const res = await fetch(endpoint, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
  if (!res.ok) {
    throw new Error(`Failed to fetch OpenRouter models (HTTP ${res.status})`)
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
  for (const model of OPENROUTER_POPULAR_MODELS) byId.set(model.id, model)
  for (const model of apiModels) byId.set(model.id, model)
  return [...byId.values()]
}
