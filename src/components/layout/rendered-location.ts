// Where the page ON SCREEN is, as opposed to where the router is going.
//
// `useRouterState(s => s.location)` is the address the router is navigating TO:
// it changes at the click, while the previous page stays on screen until the new
// route's loaders have finished (or its pending state is drawn). Anything that
// frames the page from that address (the sidebar's sections, the full-bleed
// frame, the Property in scope) switches at the click and then sits around the
// old page for as long as the loaders take.
//
// `resolvedLocation` is no cure: the router sets it only after the new page has
// been committed, so a full-bleed route's pending state would be drawn inside the
// old padded frame and the frame would flip a second time at the commit.
//
// The matches the router has PRESENTED are the right source. They are the old
// page's until the router shows the new route (its page, or its pending state),
// and the new route's from then on, so a frame derived from the deepest one and
// the `Outlet` it surrounds always agree.
import { useMatches } from '@tanstack/react-router'

export type RenderedLocation = Readonly<{
  pathname: string
  search: unknown
}>

type PresentedMatch = Readonly<{ pathname: string; search?: unknown }>

/** Nothing is on screen yet (before the first commit): no section, no frame. */
const NOTHING_RENDERED: RenderedLocation = { pathname: '', search: undefined }

/** The address of the deepest presented match: the page, or its pending state. */
export function renderedLocationFromMatches(
  matches: ReadonlyArray<PresentedMatch>,
): RenderedLocation {
  const leaf = matches.at(-1)
  return leaf ? { pathname: leaf.pathname, search: leaf.search } : NOTHING_RENDERED
}

/** The pathname of the page on screen. A string, so a re-render needs a real change. */
export function useRenderedPathname(): string {
  return useMatches({
    select: (matches) => renderedLocationFromMatches(matches).pathname,
  })
}

/**
 * Pathname and search of the page on screen. The search is the leaf match's own
 * object, which the router keeps referentially stable until it changes.
 */
export function useRenderedLocation(): RenderedLocation {
  const pathname = useRenderedPathname()
  const search = useMatches({
    select: (matches) => renderedLocationFromMatches(matches).search,
  })
  return { pathname, search }
}
