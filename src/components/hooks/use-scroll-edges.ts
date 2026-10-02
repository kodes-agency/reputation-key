// Which ends of a horizontal scroller have more to show, so a strip of tabs can
// fade the side that continues instead of cutting a label in half with no hint
// that the strip scrolls. `scrollEdges` is the pure rule; the hook follows an
// element's scroll position and size.

import { useEffect, useRef, useState, type RefObject } from 'react'

export type ScrollEdges = Readonly<{ before: boolean; after: boolean }>

type ScrollBox = Readonly<{
  scrollLeft: number
  scrollWidth: number
  clientWidth: number
}>

/** A pixel of slack: a fractional width otherwise leaves a strip "scrollable" by half a pixel. */
const SLACK_PX = 1

const NONE: ScrollEdges = { before: false, after: false }

export function scrollEdges(box: ScrollBox): ScrollEdges {
  return {
    before: box.scrollLeft > SLACK_PX,
    after: box.scrollLeft + box.clientWidth < box.scrollWidth - SLACK_PX,
  }
}

export function useScrollEdges<T extends HTMLElement>(): readonly [
  RefObject<T | null>,
  ScrollEdges,
] {
  const ref = useRef<T>(null)
  const [edges, setEdges] = useState<ScrollEdges>(NONE)

  useEffect(() => {
    const element = ref.current
    if (element === null) return
    const update = () => {
      const next = scrollEdges(element)
      setEdges((current) =>
        current.before === next.before && current.after === next.after ? current : next,
      )
    }
    update()
    element.addEventListener('scroll', update, { passive: true })
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => {
      element.removeEventListener('scroll', update)
      observer.disconnect()
    }
  }, [])

  return [ref, edges] as const
}
