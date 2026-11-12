import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_VELOXY_WIDTH,
  MAX_VELOXY_WIDTH,
  MIN_VELOXY_WIDTH,
  clampVeloxyWidth,
  loadVeloxyDrawerOpen,
  loadVeloxyDrawerWidth,
  saveVeloxyDrawerOpen,
  saveVeloxyDrawerWidth,
} from './veloxy-ui-persistence'

describe('veloxy-ui-persistence', () => {
  let mockStore: Record<string, string> = {}

  beforeEach(() => {
    mockStore = {}
    const mockStorage = {
      getItem: (key: string) => mockStore[key] ?? null,
      setItem: (key: string, value: string) => {
        mockStore[key] = value
      },
      removeItem: (key: string) => {
        delete mockStore[key]
      },
      clear: () => {
        mockStore = {}
      },
      key: (_i: number) => null,
      length: 0,
    } as Storage

    ;(globalThis as any).window = {
      localStorage: mockStorage,
    }
  })

  afterEach(() => {
    delete (globalThis as any).window
  })

  it('clamps width within min and max bounds', () => {
    expect(clampVeloxyWidth(100)).toBe(MIN_VELOXY_WIDTH)
    expect(clampVeloxyWidth(1200)).toBe(MAX_VELOXY_WIDTH)
    expect(clampVeloxyWidth(450)).toBe(450)
  })

  it('loads and saves drawer width', () => {
    expect(loadVeloxyDrawerWidth()).toBe(DEFAULT_VELOXY_WIDTH)
    saveVeloxyDrawerWidth(520)
    expect(loadVeloxyDrawerWidth()).toBe(520)
  })

  it('loads and saves open state', () => {
    expect(loadVeloxyDrawerOpen()).toBe(false)
    saveVeloxyDrawerOpen(true)
    expect(loadVeloxyDrawerOpen()).toBe(true)
    saveVeloxyDrawerOpen(false)
    expect(loadVeloxyDrawerOpen()).toBe(false)
  })
})
