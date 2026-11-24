import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PacedTokenBuffer } from './use-paced-stream'

describe('PacedTokenBuffer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('buffers tokens and flushes on immediate flush()', () => {
    let output = ''
    const buffer = new PacedTokenBuffer((text) => {
      output = text
    }, 16)

    buffer.push('SELECT ')
    buffer.push('* FROM ')
    buffer.push('orders;')

    expect(buffer.isBuffering).toBe(true)

    buffer.flush()

    expect(output).toBe('SELECT * FROM orders;')
    expect(buffer.text).toBe('SELECT * FROM orders;')
    expect(buffer.isBuffering).toBe(false)
  })

  it('flushes on timer execution', () => {
    let output = ''
    const buffer = new PacedTokenBuffer((text) => {
      output = text
    }, 16)

    buffer.push('Hello')
    expect(output).toBe('')

    vi.advanceTimersByTime(20)

    expect(output).toBe('Hello')
    expect(buffer.isBuffering).toBe(false)
  })

  it('resets buffer and text correctly', () => {
    let output = ''
    const buffer = new PacedTokenBuffer((text) => {
      output = text
    }, 16)

    buffer.push('Some query')
    buffer.reset('Initial state')

    expect(output).toBe('Initial state')
    expect(buffer.text).toBe('Initial state')
    expect(buffer.isBuffering).toBe(false)
  })
})
