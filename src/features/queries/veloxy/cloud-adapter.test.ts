import { describe, expect, it } from 'vitest'
import {
  modelMessagesToCloudMessages,
  pruneToolMessagesForCloud,
  toolsToCloudTools,
  veloxRunFinishedFinishReason,
} from '@/features/queries/veloxy/cloud-adapter'

describe('veloxRunFinishedFinishReason', () => {
  it('signals tool_calls so TanStack executes local tools', () => {
    expect(veloxRunFinishedFinishReason(true)).toBe('tool_calls')
    expect(veloxRunFinishedFinishReason(false)).toBe('stop')
  })
})

describe('modelMessagesToCloudMessages', () => {
  it('prepends system prompts and keeps tool results as role tool', () => {
    expect(
      modelMessagesToCloudMessages(
        [
          { role: 'user', content: 'count users' },
          {
            role: 'assistant',
            content: '',
            toolCalls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'search_schema', arguments: '{"query":"users"}' },
              },
            ],
          },
          { role: 'tool', content: '[{"name":"users"}]', toolCallId: 'call_1', name: 'search_schema' },
        ],
        ['You are Veloxy'],
      ),
    ).toEqual([
      { role: 'system', content: 'You are Veloxy' },
      { role: 'user', content: 'count users' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'search_schema', arguments: '{"query":"users"}' },
          },
        ],
      },
      {
        role: 'tool',
        content: '[{"name":"users"}]',
        toolCallId: 'call_1',
        name: 'search_schema',
      },
    ])
  })

  it('reads text parts from multimodal content', () => {
    expect(
      modelMessagesToCloudMessages([
        {
          role: 'user',
          content: [{ type: 'text', content: 'explain this' }],
        },
      ]),
    ).toEqual([{ role: 'user', content: 'explain this' }])
  })
})

describe('toolsToCloudTools', () => {
  it('maps TanStack tools to OpenAI function tools', () => {
    expect(
      toolsToCloudTools([
        {
          name: 'search_schema',
          description: 'Search catalog',
          inputSchema: {
            type: 'object',
            properties: { query: { type: 'string' } },
          },
        },
      ]),
    ).toEqual([
      {
        type: 'function',
        function: {
          name: 'search_schema',
          description: 'Search catalog',
          parameters: {
            type: 'object',
            properties: { query: { type: 'string' } },
          },
        },
      },
    ])
  })
})

describe('pruneToolMessagesForCloud', () => {
  it('preserves recent tool messages and condenses large older tool outputs', () => {
    const longOutput = 'x'.repeat(400)
    const messages = [
      { role: 'user' as const, content: 'first prompt' },
      { role: 'tool' as const, content: longOutput, toolCallId: 't1', name: 'search_schema' },
      { role: 'assistant' as const, content: 'first reply' },
      { role: 'user' as const, content: 'second prompt' },
      { role: 'tool' as const, content: 'short output', toolCallId: 't2', name: 'describe_table' },
      { role: 'user' as const, content: 'third prompt' },
      { role: 'tool' as const, content: longOutput, toolCallId: 't3', name: 'run_readonly' },
    ]

    const pruned = pruneToolMessagesForCloud(messages, 2)
    // t1 is older than last 2 -> pruned
    expect(pruned[1].content).toContain('[tool output condensed for context efficiency]')
    expect(pruned[1].content.length).toBeLessThan(300)
    // t2 and t3 are the 2 most recent -> preserved
    expect(pruned[4].content).toBe('short output')
    expect(pruned[6].content).toBe(longOutput)
  })
})
