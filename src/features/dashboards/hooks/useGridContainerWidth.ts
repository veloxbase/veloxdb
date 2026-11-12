import { useEffect, useState, type RefObject } from 'react'

/** Measure a container for the dashboard grid canvas. */
export function useGridContainerWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const node = ref.current
    if (!node) return

    const update = () => {
      const next = Math.floor(node.getBoundingClientRect().width)
      if (next > 0) setWidth(next)
    }

    update()
    const observer = new ResizeObserver(() => update())
    observer.observe(node)
    return () => observer.disconnect()
  }, [ref])

  return width
}
