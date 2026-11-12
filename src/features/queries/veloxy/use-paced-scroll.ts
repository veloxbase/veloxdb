import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

export type UsePacedScrollOptions = {
  /** Distance from bottom in px within which the user is considered 'at the bottom'. Defaults to 48. */
  bottomThresholdPx?: number
}

export function usePacedScroll(
  scrollRef: RefObject<HTMLElement | null>,
  deps: unknown[],
  options: UsePacedScrollOptions = {}
) {
  const { bottomThresholdPx = 48 } = options
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false)
  const isUserScrolledUpRef = useRef(false)
  const rafIdRef = useRef<number | null>(null)

  const handleScroll = useCallback(() => {
    const node = scrollRef.current
    if (!node) return

    const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight
    const scrolledUp = distanceFromBottom > bottomThresholdPx

    if (scrolledUp !== isUserScrolledUpRef.current) {
      isUserScrolledUpRef.current = scrolledUp
      setIsUserScrolledUp(scrolledUp)
    }
  }, [scrollRef, bottomThresholdPx])

  useEffect(() => {
    const node = scrollRef.current
    if (!node) return
    node.addEventListener('scroll', handleScroll, { passive: true })
    return () => node.removeEventListener('scroll', handleScroll)
  }, [scrollRef, handleScroll])

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const node = scrollRef.current
    if (!node) return
    if (behavior === 'auto') {
      node.scrollTop = node.scrollHeight
    } else {
      node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' })
    }
    isUserScrolledUpRef.current = false
    setIsUserScrolledUp(false)
  }, [scrollRef])

  useEffect(() => {
    if (isUserScrolledUpRef.current) return

    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current)
    }

    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null
      const node = scrollRef.current
      if (!node || isUserScrolledUpRef.current) return
      node.scrollTop = node.scrollHeight
    })

    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current)
        rafIdRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return {
    isUserScrolledUp,
    scrollToBottom,
  }
}
