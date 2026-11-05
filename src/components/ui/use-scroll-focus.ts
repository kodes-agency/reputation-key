import { useCallback, useState, type RefCallback } from 'react'

// The outline is inset: a scroller often sits inside a frame that clips, which
// would cut off a ring drawn outside it.
const FOCUS_OUTLINE =
  'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring'

/**
 * Props for a scroll container, so the keyboard can reach it while its content
 * overflows. A scroller with nothing focusable inside cannot be scrolled from the
 * keyboard at all; one that fits takes no tab stop. Re-measured when the
 * container or one of its children present at mount is resized.
 */
export function useScrollFocus<T extends HTMLElement>(): Readonly<{
  ref: RefCallback<T>
  tabIndex: 0 | undefined
  className: string | undefined
}> {
  const [scrolls, setScrolls] = useState(false)
  const ref = useCallback((element: T | null) => {
    if (!element) return
    const measure = () =>
      setScrolls(
        element.scrollWidth > element.clientWidth ||
          element.scrollHeight > element.clientHeight,
      )
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    for (const child of element.children) observer.observe(child)
    return () => observer.disconnect()
  }, [])
  return {
    ref,
    tabIndex: scrolls ? 0 : undefined,
    className: scrolls ? FOCUS_OUTLINE : undefined,
  }
}
