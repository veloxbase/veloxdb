import { describe, expect, it } from 'vitest'
import { isLocalAiEndpoint, isVeloxyConfigured, migrateSettings, resolveFontSizePx, resolveTheme, themeClassName } from './settings'

describe('resolveFontSizePx', () => {
  it('handles default and undefined values', () => {
    expect(resolveFontSizePx(undefined)).toBe(14)
  })

  it('handles legacy sm, md, lg options', () => {
    expect(resolveFontSizePx('sm')).toBe(12)
    expect(resolveFontSizePx('md')).toBe(14)
    expect(resolveFontSizePx('lg')).toBe(16)
  })

  it('handles custom numeric font sizes', () => {
    expect(resolveFontSizePx(10)).toBe(10)
    expect(resolveFontSizePx(15)).toBe(15)
    expect(resolveFontSizePx(20)).toBe(20)
    expect(resolveFontSizePx(28)).toBe(28)
    expect(resolveFontSizePx(32)).toBe(32)
  })

  it('clamps values between 10 and 32', () => {
    expect(resolveFontSizePx(4)).toBe(10)
    expect(resolveFontSizePx(50)).toBe(32)
  })

  it('parses numeric strings correctly', () => {
    expect(resolveFontSizePx('18' as unknown as Parameters<typeof resolveFontSizePx>[0])).toBe(18)
    expect(resolveFontSizePx('24' as unknown as Parameters<typeof resolveFontSizePx>[0])).toBe(24)
  })
})

describe('theme helpers', () => {
  it('returns themeClassName correctly', () => {
    expect(themeClassName('dark')).toBe('dark')
    expect(themeClassName('sepia')).toBe('theme-sepia')
    expect(themeClassName('light')).toBeNull()
  })

  it('resolves light and dark themes correctly', () => {
    expect(resolveTheme('light')).toBe('light')
    expect(resolveTheme('sepia')).toBe('light')
    expect(resolveTheme('dark')).toBe('dark')
    expect(resolveTheme('ocean')).toBe('dark')
  })
})

describe('isLocalAiEndpoint', () => {
  it('identifies localhost and 127.0.0.1 and common local AI ports', () => {
    expect(isLocalAiEndpoint('http://localhost:11434/v1')).toBe(true)
    expect(isLocalAiEndpoint('http://127.0.0.1:11434/v1')).toBe(true)
    expect(isLocalAiEndpoint('http://localhost:1234/v1')).toBe(true)
    expect(isLocalAiEndpoint('https://api.my-local-server.internal:11434/v1')).toBe(true)
    expect(isLocalAiEndpoint('https://openrouter.ai/api/v1')).toBe(false)
    expect(isLocalAiEndpoint('https://api.openai.com/v1')).toBe(false)
    expect(isLocalAiEndpoint(null)).toBe(false)
    expect(isLocalAiEndpoint('')).toBe(false)
  })
})

describe('isVeloxyConfigured', () => {
  it('requires an API key for hosted endpoints such as OpenRouter', () => {
    expect(isVeloxyConfigured({
      apiKey: 'sk-123',
      model: 'deepseek/deepseek-chat',
      baseUrl: 'https://openrouter.ai/api/v1',
    })).toBe(true)

    expect(isVeloxyConfigured({
      apiKey: '',
      model: 'deepseek/deepseek-chat',
      baseUrl: 'https://openrouter.ai/api/v1',
    })).toBe(false)
  })

  it('handles local AI mode without requiring an API key', () => {
    expect(isVeloxyConfigured({
      apiKey: '',
      model: 'qwen2.5-coder:latest',
      baseUrl: 'http://localhost:11434/v1',
    })).toBe(true)

    expect(isVeloxyConfigured({
      apiKey: '',
      model: '',
      baseUrl: 'http://localhost:11434/v1',
    })).toBe(false)
  })
})

describe('isVeloxyConfigured with a provider', () => {
  it('requires a key for hosted providers', () => {
    expect(isVeloxyConfigured({ provider: 'deepseek', apiKey: '', model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com/v1' })).toBe(false)
    expect(isVeloxyConfigured({ provider: 'deepseek', apiKey: 'sk-1', model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com/v1' })).toBe(true)
  })

  it('lets a custom endpoint run without a key but not without a URL', () => {
    expect(isVeloxyConfigured({ provider: 'custom', apiKey: '', model: 'm', baseUrl: 'https://llm.internal/v1' })).toBe(true)
    expect(isVeloxyConfigured({ provider: 'custom', apiKey: '', model: 'm', baseUrl: '' })).toBe(false)
  })
})

describe('migrateSettings', () => {
  it('keeps existing OpenRouter users on OpenRouter and carries the plaintext key', () => {
    const migrated = migrateSettings({
      veloxyBaseUrl: 'https://openrouter.ai/api/v1',
      veloxyModel: 'deepseek/deepseek-chat',
      veloxyOpenRouterApiKey: 'sk-or-v1-abc',
      veloxyCloudModel: 'x',
    }, 0) as unknown as Record<string, unknown>
    expect(migrated.veloxyProvider).toBe('openrouter')
    expect(migrated.veloxyApiKey).toBe('sk-or-v1-abc')
    expect(migrated).not.toHaveProperty('veloxyOpenRouterApiKey')
    expect(migrated).not.toHaveProperty('veloxyCloudModel')
  })

  it('maps local and unknown URLs', () => {
    expect(migrateSettings({ veloxyBaseUrl: 'http://localhost:11434/v1' }, 0).veloxyProvider).toBe('ollama')
    expect(migrateSettings({ veloxyBaseUrl: 'https://llm.internal/v1' }, 0).veloxyProvider).toBe('custom')
  })
})
