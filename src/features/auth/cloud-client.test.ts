import { describe, expect, it } from 'vitest'

import {
  isUnauthorizedStatus,
  parseCloudSseBlock,
  parseEntitlementsResponse,
  parseExchangeResponse,
  parseMeResponse,
} from '@/features/auth/cloud-client'

describe('cloud-client parsers', () => {
  it('treats 401 as a session-clearing status', () => {
    expect(isUnauthorizedStatus(401)).toBe(true)
    expect(isUnauthorizedStatus(403)).toBe(false)
    expect(isUnauthorizedStatus(200)).toBe(false)
  })

  it('maps a desktop exchange payload', () => {
    expect(
      parseExchangeResponse({
        accessToken: 'velox_abc',
        tokenType: 'Bearer',
        keyId: 'key-1',
        user: {
          userId: 'user-1',
          email: 'ada@veloxdb.dev',
          name: 'Ada',
          image: null,
          organizationId: 'org-1',
        },
      }),
    ).toEqual({
      accessToken: 'velox_abc',
      tokenType: 'Bearer',
      keyId: 'key-1',
      user: {
        userId: 'user-1',
        email: 'ada@veloxdb.dev',
        name: 'Ada',
        image: null,
        organizationId: 'org-1',
      },
    })
  })

  it('rejects an exchange payload without a token', () => {
    expect(() => parseExchangeResponse({ user: { userId: 'user-1' } })).toThrow(/access token/)
  })

  it('maps GET /api/v1/me', () => {
    expect(
      parseMeResponse({
        userId: 'user-1',
        email: 'ada@veloxdb.dev',
        name: 'Ada',
        image: null,
        organizationId: null,
      }),
    ).toEqual({
      userId: 'user-1',
      email: 'ada@veloxdb.dev',
      name: 'Ada',
      image: null,
      organizationId: null,
    })
  })

  it('maps GET /api/v1/me with nested user profile', () => {
    expect(
      parseMeResponse({
        userId: 'user-1',
        keyId: 'key-1',
        user: {
          id: 'user-1',
          email: 'ada@veloxdb.dev',
          name: 'Ada Lovelace',
          image: 'https://veloxdb.dev/avatar.png',
          organizationId: 'org-123',
        },
      }),
    ).toEqual({
      userId: 'user-1',
      email: 'ada@veloxdb.dev',
      name: 'Ada Lovelace',
      image: 'https://veloxdb.dev/avatar.png',
      organizationId: 'org-123',
    })
  })

  it('parses entitlements responses correctly', () => {
    expect(
      parseEntitlementsResponse({
        plan: 'pro',
        status: 'active',
        bi: true,
        ai: true,
        teamSharing: false,
        currentPeriodEnd: '2026-09-30T00:00:00Z',
      }),
    ).toEqual({
      plan: 'pro',
      status: 'active',
      bi: true,
      ai: true,
      teamSharing: false,
      currentPeriodEnd: '2026-09-30T00:00:00Z',
    })

    expect(
      parseEntitlementsResponse({
        plan: 'free',
        status: 'inactive',
      }),
    ).toEqual({
      plan: 'free',
      status: 'inactive',
      bi: false,
      ai: false,
      teamSharing: false,
      currentPeriodEnd: null,
    })
  })

  it('parses cloud SSE token, tool_call, and error events', () => {
    expect(parseCloudSseBlock('data: {"type":"token","text":"hello"}')).toEqual({
      type: 'token',
      text: 'hello',
    })
    expect(
      parseCloudSseBlock(
        'data: {"type":"tool_call","id":"call_1","name":"search_schema","arguments":"{\\"query\\":\\"orders\\"}"}',
      ),
    ).toEqual({
      type: 'tool_call',
      id: 'call_1',
      name: 'search_schema',
      arguments: '{"query":"orders"}',
    })
    expect(parseCloudSseBlock('data: {"type":"error","error":"quota exceeded"}')).toEqual({
      type: 'error',
      error: 'quota exceeded',
    })
  })

  it('handles measureCloudLatency gracefully when offline or mock fetch', async () => {
    const { measureCloudLatency } = await import('@/features/auth/cloud-client')
    const result = await measureCloudLatency()
    expect(typeof result.latencyMs).toBe('number')
    expect(typeof result.ok).toBe('boolean')
  })
})
