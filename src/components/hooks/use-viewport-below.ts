import { createContext, useCallback, useContext, useSyncExternalStore } from 'react'
import { isHintBelow, UNKNOWN_VIEWPORT, type ViewportHint } from './viewport-hint'

/**
 * The request's viewport hint, provided by the authenticated layout from its
 * loader. Without a provider (Storybook, tests) the server render keeps the
 * wide layout, as it did before the hint existed.
 */
export const ViewportHintContext = createContext<ViewportHint>(UNKNOWN_VIEWPORT)

/**
 * Is the viewport narrower than `breakpointPx`? The browser answers with
 * `matchMedia`. The server render, and the hydration that must match it, answer
 * from the request's viewport hint, so a phone's first paint is already the
 * phone layout.
 */
export function useViewportBelow(breakpointPx: number): boolean {
  const hint = useContext(ViewportHintContext)
  const query = `(max-width: ${breakpointPx - 1}px)`
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const media = window.matchMedia(query)
      media.addEventListener('change', onStoreChange)
      return () => media.removeEventListener('change', onStoreChange)
    },
    [query],
  )
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => isHintBelow(hint, breakpointPx),
  )
}
