import { describe, expect, it } from 'vitest'

import { parseEntitlementsResponse } from '@/features/auth/cloud-client'

describe('useEntitlements and cloud parsing', () => {
  it('correctly derives entitlements for pro active subscription', () => {
    const parsed = parseEntitlementsResponse({
      plan: 'pro',
      status: 'active',
      currentPeriodEnd: '2026-10-01T00:00:00Z',
    })
    expect(parsed.bi).toBe(true)
    expect(parsed.ai).toBe(true)
    expect(parsed.plan).toBe('pro')
    expect(parsed.status).toBe('active')
  })

  it('correctly derives entitlements for a Cloud trial', () => {
    const parsed = parseEntitlementsResponse({
      plan: 'cloud',
      status: 'trialing',
    })
    expect(parsed.bi).toBe(true)
    expect(parsed.ai).toBe(true)
    expect(parsed.plan).toBe('cloud')
    expect(parsed.status).toBe('trialing')
  })

  it('correctly derives entitlements for free/canceled subscription', () => {
    const parsed = parseEntitlementsResponse({
      plan: 'free',
      status: 'canceled',
    })
    expect(parsed.bi).toBe(false)
    expect(parsed.ai).toBe(false)
    expect(parsed.plan).toBe('free')
  })

  it('handles empty or malformed cloud response', () => {
    const parsed = parseEntitlementsResponse(null)
    expect(parsed.bi).toBe(false)
    expect(parsed.ai).toBe(false)
    expect(parsed.plan).toBe('free')
  })
})
