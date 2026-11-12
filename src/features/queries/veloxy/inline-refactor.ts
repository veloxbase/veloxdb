import { isLocalAiEndpoint } from '@/lib/settings'

export type InlineRefactorParams = {
  selectedSql: string
  fullSql: string
  instruction: string
  dialect: string
  schemaSummary?: string
  model: string
  apiKey: string
  baseUrl?: string | null
}

export function cleanInlineSqlResponse(raw: string): string {
  let cleaned = raw.trim()
  if (cleaned.startsWith('```sql')) {
    cleaned = cleaned.slice(6)
  } else if (cleaned.startsWith('```SQL')) {
    cleaned = cleaned.slice(6)
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.slice(3)
  }
  if (cleaned.endsWith('```')) {
    cleaned = cleaned.slice(0, -3)
  }
  return cleaned.trim()
}

export async function requestInlineRefactor(params: InlineRefactorParams): Promise<string> {
  const {
    selectedSql,
    fullSql,
    instruction,
    dialect,
    schemaSummary,
    model,
    apiKey,
    baseUrl,
  } = params

  const systemPrompt = `You are Veloxy, an expert inline SQL pair-programmer embedded in the Monaco code editor.
Your task is to refactor, edit, or generate SQL code in-place based on the user's instructions for ${dialect}.

Rules:
1. Return ONLY the replacement SQL snippet that should replace the selected code.
2. Do NOT add conversational prose, explanations, greetings, or commentary.
3. Use valid ${dialect} syntax and maintain proper formatting/indentation.
4. If schema context is provided, adhere strictly to the actual table and column names.`

  const userPrompt = [
    `Database Dialect: ${dialect}`,
    schemaSummary ? `Schema Context:\n${schemaSummary}` : '',
    '',
    `User Instruction: ${instruction.trim()}`,
    '',
    selectedSql.trim() ? `Selected Code to Replace:\n\`\`\`sql\n${selectedSql.trim()}\n\`\`\`` : 'Cursor is at an insertion point (no selection).',
    fullSql.trim() && fullSql !== selectedSql ? `\nFull Query Context:\n\`\`\`sql\n${fullSql.trim()}\n\`\`\`` : '',
  ].filter(Boolean).join('\n')

  const messages = [
    { role: 'system' as const, content: systemPrompt },
    { role: 'user' as const, content: userPrompt },
  ]

  // Bring your own key: OpenRouter, Ollama, or any OpenAI-compatible endpoint.
  const isLocal = isLocalAiEndpoint(baseUrl)
  const rawBaseUrl = baseUrl?.trim() || 'https://openrouter.ai/api/v1'
  const endpoint = `${rawBaseUrl.replace(/\/+$/, '')}/chat/completions`

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'HTTP-Referer': 'https://github.com/veloxbase/veloxdb',
    'X-Title': 'VeloxDB',
  }

  const effectiveKey = apiKey?.trim() || (isLocal ? 'ollama' : '')
  if (effectiveKey) {
    headers['Authorization'] = `Bearer ${effectiveKey}`
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      temperature: 0.1,
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
  return cleanInlineSqlResponse(content)
}
