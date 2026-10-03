import { createContext, useContext, useSyncExternalStore } from 'react'
import { isHintBelow, UNKNOWN_VIEWPORT, type ViewportHint } from './viewport-hint'

/**
 * The request's viewport hint, provided by the authenticated layout from its
 * loader. Without a provider (Storybook, tests) the server render keeps the
 * wide layout, as it did before the hint existed.
 */
export const ViewportHintContext = createContext<ViewportHint>(UNKNOWN_VIEWPORT)

// One subscription for every breakpoint: a width query can only change when
// the window resizes, and the snapshot is a boolean, so a resize that crosses
// no breakpoint re-renders nothing. Module-level, so it is never resubscribed.
// This hook sits in a first-paint chunk (scripts/check-bundle-budget.mjs).
function subscribeToResize(onStoreChange: () => void): () => void {
  window.addEventListener('resize', onStoreChange)
  return () => window.removeEventListener('resize', onStoreChange)
}

/**
 * Is the viewport narrower than `breakpointPx`? The browser answers with
 * `matchMedia`. The server render, and the hydration that must match it, answer
 * from the request's viewport hint, so a phone's first paint is already the
 * phone layout.
 */
export function useViewportBelow(breakpointPx: number): boolean {
  const hint = useContext(ViewportHintContext)
  return useSyncExternalStore(
    subscribeToResize,
    () => window.matchMedia(`(max-width: ${breakpointPx - 1}px)`).matches,
    () => isHintBelow(hint, breakpointPx),
  )
}
