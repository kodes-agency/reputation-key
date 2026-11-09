// Where the page ON SCREEN is, as opposed to where the router is going.
//
// `useRouterState(s => s.location)` is the address the router is navigating TO: it
// changes at the click while the old page stays on screen, so anything framing the
// page from it would switch around the old page. `resolvedLocation` is set only
// after the new page commits, so a full-bleed pending state would draw inside the
// old padded frame and flip twice.
//
// The matches the router has PRESENTED are the right source: the old page's until
// the router shows the new route (page or pending state), so a frame derived from
// the deepest one and the `Outlet` it surrounds always agree.
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
