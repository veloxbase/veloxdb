import { requestChatCompletion } from '@/lib/ai-providers'

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

  const content = await requestChatCompletion({
    baseUrl,
    apiKey,
    model,
    systemPrompt,
    userPrompt,
  })
  return cleanInlineSqlResponse(content)
}
