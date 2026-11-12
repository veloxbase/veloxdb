import {
  EventType,
  type AnyTool,
  type DefaultMessageMetadataByModality,
  type ModelMessage,
  type StreamChunk,
  type TextOptions,
} from '@tanstack/ai'
import { BaseTextAdapter, type StructuredOutputResult } from '@tanstack/ai/adapters'

import {
  chatWithCloudStream,
  type CloudChatMessage,
  type CloudFunctionTool,
} from '@/features/auth/cloud-client'

function textFromContent(content: ModelMessage['content']): string {
  if (typeof content === 'string') return content
  if (!content) return ''
  return content
    .filter((part): part is { type: 'text'; content: string } => part.type === 'text')
    .map((part) => part.content)
    .join('')
}

export function toolsToCloudTools(tools: ReadonlyArray<AnyTool> | undefined): CloudFunctionTool[] | undefined {
  if (!tools?.length) return undefined
  return tools.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters:
        tool.inputSchema && typeof tool.inputSchema === 'object'
          ? (tool.inputSchema as Record<string, unknown>)
          : { type: 'object', properties: {} },
    },
  }))
}

export function pruneToolMessagesForCloud(
  messages: CloudChatMessage[],
  keepFullTurns = 4
): CloudChatMessage[] {
  return messages.map((msg, i, arr) => {
    if (msg.role !== 'tool') return msg
    const remainingToolMessages = arr.slice(i + 1).filter((m) => m.role === 'tool').length
    if (remainingToolMessages < keepFullTurns) {
      return msg
    }
    if (msg.content && msg.content.length > 300) {
      return {
        ...msg,
        content: `${msg.content.slice(0, 240)}… [tool output condensed for context efficiency]`,
      }
    }
    return msg
  })
}

export function modelMessagesToCloudMessages(
  messages: ModelMessage[],
  systemPrompts: Array<string | { content: string }> = [],
): CloudChatMessage[] {
  const converted: CloudChatMessage[] = []

  for (const prompt of systemPrompts) {
    const content = typeof prompt === 'string' ? prompt : prompt.content
    if (content.trim()) converted.push({ role: 'system', content })
  }

  for (const message of messages) {
    if (message.role === 'tool') {
      converted.push({
        role: 'tool',
        content: textFromContent(message.content),
        toolCallId: message.toolCallId,
        name: message.name,
      })
      continue
    }

    const content = textFromContent(message.content)
    if (message.role === 'assistant') {
      const toolCalls = message.toolCalls?.map((call) => ({
        id: call.id,
        type: 'function' as const,
        function: {
          name: call.function.name,
          arguments:
            typeof call.function.arguments === 'string'
              ? call.function.arguments
              : JSON.stringify(call.function.arguments),
        },
      }))
      if (!content.trim() && !toolCalls?.length) continue
      converted.push({
        role: 'assistant',
        content,
        ...(toolCalls?.length ? { toolCalls } : {}),
      })
      continue
    }

    if (!content.trim()) continue
    converted.push({ role: 'user', content })
  }

  return converted
}

export type VeloxCloudAdapterOptions = {
  dialect?: string
  onUsage?: (usage: unknown) => void
}

export function veloxRunFinishedFinishReason(emittedToolCall: boolean): "tool_calls" | "stop" {
  // TanStack only executes server tools when RUN_FINISHED.finishReason is
  // "tool_calls". Omitting it leaves the UI showing the tool forever.
  return emittedToolCall ? "tool_calls" : "stop"
}

export function createVeloxCloudText(model: string, options: VeloxCloudAdapterOptions = {}) {
  return new VeloxCloudTextAdapter(model, options)
}

class VeloxCloudTextAdapter extends BaseTextAdapter<
  string,
  Record<string, never>,
  readonly ['text'],
  DefaultMessageMetadataByModality
> {
  readonly name = 'velox-cloud'
  private options: VeloxCloudAdapterOptions

  constructor(model: string, options: VeloxCloudAdapterOptions = {}) {
    super({}, model)
    this.options = options
  }

  async *chatStream(options: TextOptions): AsyncGenerator<StreamChunk> {
    const runId = options.runId ?? this.generateId()
    const threadId = options.threadId ?? this.generateId()
    const messageId = this.generateId()
    const timestamp = Date.now()

    yield {
      type: EventType.RUN_STARTED,
      runId,
      threadId,
      model: this.model,
      timestamp,
    }

    let hasEmittedTextStart = false
    let accumulated = ''
    let emittedToolCall = false
    const modelName = this.model

    const closeText = function* (): Generator<StreamChunk> {
      if (!hasEmittedTextStart) return
      yield {
        type: EventType.TEXT_MESSAGE_END,
        messageId,
        model: modelName,
        timestamp: Date.now(),
      }
      hasEmittedTextStart = false
    }

    try {
      const rawMessages = modelMessagesToCloudMessages(options.messages, options.systemPrompts ?? [])
      const messages = pruneToolMessagesForCloud(rawMessages)
      const lastUser = [...messages].reverse().find((message) => message.role === 'user')
      const tools = toolsToCloudTools(options.tools)

      for await (const event of chatWithCloudStream(
        {
          task: 'general',
          model: this.model,
          dialect: this.options.dialect,
          prompt: lastUser?.content,
          messages,
          tools,
        },
        options.abortController?.signal,
      )) {
        if (event.type === 'token') {
          if (!hasEmittedTextStart) {
            hasEmittedTextStart = true
            yield {
              type: EventType.TEXT_MESSAGE_START,
              messageId,
              model: this.model,
              timestamp: Date.now(),
              role: 'assistant',
            }
          }
          accumulated += event.text
          yield {
            type: EventType.TEXT_MESSAGE_CONTENT,
            messageId,
            model: this.model,
            timestamp: Date.now(),
            delta: event.text,
            content: accumulated,
          }
          continue
        }

        if (event.type === 'tool_call') {
          emittedToolCall = true
          yield* closeText()
          yield {
            type: EventType.TOOL_CALL_START,
            toolCallId: event.id,
            toolCallName: event.name,
            toolName: event.name,
            parentMessageId: messageId,
            model: this.model,
            timestamp: Date.now(),
          }
          if (event.arguments) {
            yield {
              type: EventType.TOOL_CALL_ARGS,
              toolCallId: event.id,
              model: this.model,
              timestamp: Date.now(),
              delta: event.arguments,
            }
          }
          let parsedInput: Record<string, unknown> = {}
          if (event.arguments) {
            try {
              const parsed = JSON.parse(event.arguments) as unknown
              parsedInput = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
            } catch {
              parsedInput = {}
            }
          }
          yield {
            type: EventType.TOOL_CALL_END,
            toolCallId: event.id,
            toolCallName: event.name,
            toolName: event.name,
            model: this.model,
            timestamp: Date.now(),
            input: parsedInput,
          }
          continue
        }

        if (event.type === 'error') {
          yield* closeText()
          yield {
            type: EventType.RUN_ERROR,
            runId,
            model: this.model,
            timestamp: Date.now(),
            message: event.error,
            code: 'cloud-chat-failed',
            error: { message: event.error, code: 'cloud-chat-failed' },
          }
          return
        }

        if (event.type === 'done') {
          yield* closeText()
          if (event.usage) {
            this.options.onUsage?.(event.usage)
          }
          yield {
            type: EventType.RUN_FINISHED,
            runId,
            threadId,
            model: event.model || this.model,
            timestamp: Date.now(),
            finishReason: veloxRunFinishedFinishReason(emittedToolCall),
          }
          return
        }
      }

      yield* closeText()
      yield {
        type: EventType.RUN_FINISHED,
        runId,
        threadId,
        model: this.model,
        timestamp: Date.now(),
        finishReason: veloxRunFinishedFinishReason(emittedToolCall),
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        yield* closeText()
        yield {
          type: EventType.RUN_FINISHED,
          runId,
          threadId,
          model: this.model,
          timestamp: Date.now(),
          finishReason: veloxRunFinishedFinishReason(emittedToolCall),
        }
        return
      }
      const message = error instanceof Error ? error.message : 'Velox Cloud chat failed'
      yield {
        type: EventType.RUN_ERROR,
        runId,
        model: this.model,
        timestamp: Date.now(),
        message,
        code: 'cloud-chat-failed',
        error: { message, code: 'cloud-chat-failed' },
      }
    }
  }

  async structuredOutput(): Promise<StructuredOutputResult<unknown>> {
    throw new Error('Velox Cloud does not support structured output.')
  }
}
