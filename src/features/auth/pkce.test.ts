import { describe, expect, it } from 'vitest'

import { computeS256Challenge, createPkcePair, parseDesktopCallbackUrl } from '@/features/auth/pkce'

describe('pkce', () => {
  it('creates an S256 verifier in the RFC 7636 length range', async () => {
    const pair = await createPkcePair()
    expect(pair.codeVerifier.length).toBeGreaterThanOrEqual(43)
    expect(pair.codeVerifier.length).toBeLessThanOrEqual(128)
    expect(pair.codeChallenge).toBe(await computeS256Challenge(pair.codeVerifier))
    expect(pair.state.length).toBeGreaterThan(8)
  })

  it('is deterministic for a known verifier', async () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    expect(await computeS256Challenge(verifier)).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })

  it('parses a veloxdb deep-link callback', () => {
    expect(parseDesktopCallbackUrl('veloxdb://auth/callback?code=abc&state=xyz')).toEqual({
      code: 'abc',
      state: 'xyz',
    })
  })

  it('parses a local loopback callback', () => {
    expect(parseDesktopCallbackUrl('http://127.0.0.1:54321/callback?code=abc&state=xyz')).toEqual({
      code: 'abc',
      state: 'xyz',
    })
  })

  it('rejects a callback without a code', () => {
    expect(() => parseDesktopCallbackUrl('veloxdb://auth/callback?state=xyz')).toThrow(
      /authorization code/,
    )
  })
})
