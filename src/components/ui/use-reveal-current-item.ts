import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { revealCurrentItem } from './strip-scroll'

/** What the strip last did: which item it brought into view, and where it left the row. */
type Revealed = Readonly<{ item: Element | null; left: number }>

const currentItemOf = (strip: HTMLElement) => strip.querySelector('[aria-current="page"]')

/**
 * Keep a scrolling strip's current item (`aria-current="page"`) in view.
 *
 * - When the current item changes (and on mount), the strip scrolls to it. A
 *   re-render for another reason does not: the person scrolling the row to an edge
 *   re-renders it (the fade follows the edge), and that must not pull it back.
 * - When the strip or its content changes size (a web font arrives after the first
 *   paint, a count widens a tab, the phone turns), the current item may have moved
 *   out of reach, or there was nothing to scroll yet and now there is. The strip scrolls to it again,
 *   unless the person has scrolled it since: the position the last reveal left is
 *   the only position that is re-revealed.
 */
export function useRevealCurrentItem(ref: RefObject<HTMLElement | null>) {
  const revealed = useRef<Revealed | null>(null)

  const reveal = useCallback(() => {
    const strip = ref.current
    if (!strip) return
    revealCurrentItem(strip)
    revealed.current = { item: currentItemOf(strip), left: strip.scrollLeft }
  }, [ref])

  useLayoutEffect(() => {
    const strip = ref.current
    if (strip && currentItemOf(strip) !== revealed.current?.item) reveal()
  })

  useEffect(() => {
    const strip = ref.current
    if (!strip || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      if (strip.scrollLeft === revealed.current?.left) reveal()
    })
    observer.observe(strip)
    for (const child of strip.children) observer.observe(child)
    return () => observer.disconnect()
  }, [ref, reveal])
}
