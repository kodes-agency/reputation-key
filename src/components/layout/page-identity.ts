// A page is named once, on its route, in `staticData.page`:
//
//   staticData: { page: { title: 'People', tier: 'dashboard', under: 'property' } }
//
// That one declaration gives the page its tab title ("People | Reputation Key")
// and gives every fallback for it (pending, failed, missing, unavailable) the
// title, breadcrumbs and tier the loaded page has, so a page does not lose its
// name or change width while it loads. `PageState` prints it; `RoutePending`,
// `RouteError` and `RouteNotFound` read it from the route.
//
// Only a route that draws a page header declares a page. A layout that draws
// none (the Property layout) borrows the page below it for its fallbacks; a route
// inside a page that already has a header (a Property settings section) declares
// nothing and its fallbacks print no second header.
//
// Kept free of React so the rules are unit-tested without a router.
import type { Crumb } from './page-header'
import type { PageTier } from './page-shell'

/** Where a page sits, as the breadcrumb parents above it. */
export type PageTrail = 'properties' | 'property' | 'portals' | 'goals' | 'settings'

export type PageIdentity = Readonly<{
  /** The page header's `h1`, and the tab title. */
  title: string
  /** The page's own breadcrumb, when it is shorter than the title. */
  crumb?: string
  /** The `PageShell` tier the loaded page uses; its fallbacks use the same. */
  tier?: PageTier
  under?: PageTrail
  /** A full-bleed surface: its fallbacks wear the page gutter and scroll themselves. */
  fullBleed?: boolean
}>

declare module '@tanstack/react-router' {
  interface StaticDataRouteOption {
    page?: PageIdentity
  }
}

/** The part of a route match this module reads. */
export type PageMatch = Readonly<{
  routeId: string
  staticData?: Readonly<{ page?: PageIdentity }>
}>

const DOCUMENT_TITLE_SUFFIX = 'Reputation Key'

/** The tab title for a page, in the format the legal pages already use. */
export function documentTitle(title: string): string {
  return `${title} | ${DOCUMENT_TITLE_SUFFIX}`
}

function deepestPage(matches: readonly PageMatch[]): PageIdentity | undefined {
  for (let index = matches.length - 1; index >= 0; index--) {
    const page = matches[index]?.staticData?.page
    if (page) return page
  }
  return undefined
}

/**
 * The head of an authenticated route: the tab is titled after the deepest page
 * in the chain. A route that names no page leaves the root title alone.
 */
export function pageHead(matches: readonly PageMatch[]): {
  meta?: Array<{ title: string }>
} {
  const page = deepestPage(matches)
  return page ? { meta: [{ title: documentTitle(page.title) }] } : {}
}

/**
 * The identity a fallback for `routeId` prints, or null when it prints none.
 *
 * - The route's own page, when it declares one.
 * - Otherwise nothing, when a route above it is a page: that page's header is
 *   already on screen.
 * - Otherwise the deepest page below it, so a layout with no header of its own
 *   shows the page that is loading rather than an anonymous skeleton.
 */
export function fallbackIdentity(
  matches: readonly PageMatch[],
  routeId: string,
): PageIdentity | null {
  const index = matches.findIndex((match) => match.routeId === routeId)
  if (index < 0) return null
  const own = matches[index]?.staticData?.page
  if (own) return own
  if (deepestPage(matches.slice(0, index))) return null
  return deepestPage(matches.slice(index + 1)) ?? null
}

type Where = Readonly<{ propertyId?: string; propertyName?: string }>

/** The Property crumb, named once the Property is known; generic before that. */
function propertyCrumb({ propertyId, propertyName }: Where): readonly Crumb[] {
  if (!propertyId) return []
  return [{ label: propertyName ?? 'Property', to: `/properties/${propertyId}` }]
}

/** A list below the Property (Portals, Goals) that a deeper page links back to. */
function listCrumb(label: string, segment: string, { propertyId }: Where): Crumb {
  return propertyId ? { label, to: `/properties/${propertyId}/${segment}` } : { label }
}

function parentCrumbs(under: PageTrail, where: Where): readonly Crumb[] {
  const properties = { label: 'Properties', to: '/properties' }
  const base = [properties, ...propertyCrumb(where)]
  switch (under) {
    case 'properties':
      return [properties]
    case 'property':
      return base
    case 'portals':
      return [...base, listCrumb('Portals', 'portals', where)]
    case 'goals':
      return [...base, listCrumb('Goals', 'goals', where)]
    case 'settings':
      return [{ label: 'Settings', to: '/settings' }]
  }
}

/**
 * The breadcrumbs of a page: its parents, then itself. A page at the top of the
 * app has none. `where` is what the route's address and the cache know; the
 * Property crumb is generic until the Property is loaded.
 */
export function resolveCrumbs(
  identity: PageIdentity,
  where: Where,
): readonly Crumb[] | undefined {
  if (!identity.under) return undefined
  return [
    ...parentCrumbs(identity.under, where),
    { label: identity.crumb ?? identity.title },
  ]
}
