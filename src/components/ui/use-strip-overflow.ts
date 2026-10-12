import { useCallback, useEffect, useLayoutEffect, useState, type RefObject } from 'react'
import { stripEdgesFor, type StripEdges } from './strip-scroll'

// Until measured, claim everything fits: no fade is the safe first paint.
const FITS: StripEdges = { atStart: true, atEnd: true }

/**
 * Which edges of a horizontally scrolling strip are out of reach.
 *
 * Re-measured after every render (a count change widens a pill, and a pill
 * added or removed changes the strip's content, so both land here), on scroll,
 * and when the strip or one of the pills present when the effect was set up is
 * resized: the ResizeObserver is not re-attached when the pill list changes,
 * the per-render measure is what catches those. Returns the previous object
 * while the answer is unchanged, so scrolling does not re-render on every frame.
 */
export function useStripOverflow(ref: RefObject<HTMLElement | null>): StripEdges {
  const [edges, setEdges] = useState<StripEdges>(FITS)

  const measure = useCallback(() => {
    const element = ref.current
    if (!element) return
    const next = stripEdgesFor(element)
    setEdges((previous) =>
      previous.atStart === next.atStart && previous.atEnd === next.atEnd
        ? previous
        : next,
    )
  }, [ref])

  useLayoutEffect(measure)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    element.addEventListener('scroll', measure, { passive: true })
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(element)
    for (const child of element.children) observer?.observe(child)
    return () => {
      element.removeEventListener('scroll', measure)
      observer?.disconnect()
    }
  }, [ref, measure])

  return edges
}
