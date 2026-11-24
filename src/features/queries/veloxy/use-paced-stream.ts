import { useCallback, useEffect, useRef, useState } from 'react'

export type PacedStreamOptions = {
  /** Target frame interval in ms. Defaults to ~16.6ms (60fps). Set to ~8.3ms for 120fps. */
  frameIntervalMs?: number
}

export class PacedTokenBuffer {
  private buffer = ''
  private displayed = ''
  private onUpdate: (text: string) => void
  private timerId: number | null = null
  private lastFlush = 0
  private frameIntervalMs: number

  constructor(onUpdate: (text: string) => void, frameIntervalMs = 16) {
    this.onUpdate = onUpdate
    this.frameIntervalMs = frameIntervalMs
  }

  push(chunk: string): void {
    if (!chunk) return
    this.buffer += chunk
    this.schedule()
  }

  flush(): void {
    this.cancel()
    if (this.buffer.length > 0) {
      this.displayed += this.buffer
      this.buffer = ''
      this.onUpdate(this.displayed)
      this.lastFlush = Date.now()
    }
  }

  reset(initialText = ''): void {
    this.cancel()
    this.buffer = ''
    this.displayed = initialText
    this.onUpdate(initialText)
    this.lastFlush = 0
  }

  get text(): string {
    return this.displayed
  }

  get isBuffering(): boolean {
    return this.buffer.length > 0
  }

  private schedule(): void {
    if (this.timerId !== null) return
    const execute = () => {
      this.timerId = null
      const now = Date.now()
      if (now - this.lastFlush >= this.frameIntervalMs || this.buffer.length > 200) {
        if (this.buffer.length > 0) {
          this.displayed += this.buffer
          this.buffer = ''
          this.onUpdate(this.displayed)
          this.lastFlush = now
        }
      } else {
        const remaining = Math.max(1, this.frameIntervalMs - (now - this.lastFlush))
        this.timerId = setTimeout(execute, remaining) as unknown as number
      }
    }

    if (typeof requestAnimationFrame === 'function' && typeof window !== 'undefined') {
      this.timerId = requestAnimationFrame(execute) as unknown as number
    } else {
      this.timerId = setTimeout(execute, this.frameIntervalMs) as unknown as number
    }
  }

  cancel(): void {
    if (this.timerId !== null) {
      if (typeof cancelAnimationFrame === 'function' && typeof window !== 'undefined') {
        cancelAnimationFrame(this.timerId)
      } else {
        clearTimeout(this.timerId)
      }
      this.timerId = null
    }
  }
}

export type PacedStreamBuffer = {
  push: (chunk: string) => void
  flush: () => void
  reset: (initialText?: string) => void
  displayedText: string
  isBuffering: boolean
}

export function usePacedStream(
  initialText = '',
  options: PacedStreamOptions = {}
): PacedStreamBuffer {
  const { frameIntervalMs = 16 } = options
  const [displayedText, setDisplayedText] = useState(initialText)
  const [isBuffering, setIsBuffering] = useState(false)
  const bufferRef = useRef<PacedTokenBuffer | null>(null)

  useEffect(() => {
    bufferRef.current = new PacedTokenBuffer((text) => {
      setDisplayedText(text)
      setIsBuffering(bufferRef.current?.isBuffering ?? false)
    }, frameIntervalMs)

    return () => {
      bufferRef.current?.cancel()
    }
  }, [frameIntervalMs])

  const push = useCallback((chunk: string) => {
    if (!bufferRef.current) return
    bufferRef.current.push(chunk)
    setIsBuffering(true)
  }, [])

  const flush = useCallback(() => {
    if (!bufferRef.current) return
    bufferRef.current.flush()
    setIsBuffering(false)
  }, [])

  const reset = useCallback((text = '') => {
    if (!bufferRef.current) return
    bufferRef.current.reset(text)
    setIsBuffering(false)
  }, [])

  return {
    push,
    flush,
    reset,
    displayedText,
    isBuffering,
  }
}
