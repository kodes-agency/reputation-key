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
import { NAV_LABEL } from './nav-labels'
import type { Crumb } from './page-header'
import type { PageTier } from './page-shell'

/** Where a page sits, as the breadcrumb parents above it. */
export type PageTrail =
  'properties' | 'property' | 'portals' | 'goals' | 'propertySettings' | 'settings'

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

/** The deepest page named in a chain of matches, loaded or not. */
export function deepestPage(matches: readonly PageMatch[]): PageIdentity | undefined {
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

/** What the address and the cache know about where a page sits. */
export type PageWhere = Readonly<{ propertyId?: string; propertyName?: string }>

/** The Property crumb, named once the Property is known; generic before that. Always a link. */
function propertyCrumb({ propertyId, propertyName }: PageWhere): readonly Crumb[] {
  if (!propertyId) return []
  return [{ label: propertyName ?? 'Property', to: `/properties/${propertyId}` }]
}

/** A place below the Property (Portals, Goals, its settings) that a deeper page links back to. */
function placeCrumb(label: string, segment: string, { propertyId }: PageWhere): Crumb {
  return propertyId ? { label, to: `/properties/${propertyId}/${segment}` } : { label }
}

function parentCrumbs(under: PageTrail, where: PageWhere): readonly Crumb[] {
  const properties = { label: NAV_LABEL.properties, to: '/properties' }
  const base = [properties, ...propertyCrumb(where)]
  switch (under) {
    case 'properties':
      return [properties]
    case 'property':
      return base
    case 'portals':
      return [...base, placeCrumb(NAV_LABEL.portals, 'portals', where)]
    case 'goals':
      return [...base, placeCrumb(NAV_LABEL.goals, 'goals', where)]
    case 'propertySettings':
      return [...base, placeCrumb(NAV_LABEL.propertySettings, 'settings', where)]
    case 'settings':
      // The first page of the area, not `/settings`, which only redirects there.
      return [{ label: NAV_LABEL.settings, to: '/settings/profile' }]
  }
}

/**
 * The breadcrumbs of a page: the places above it, each a link, then the page itself.
 * This is the one place a trail is spelled, so the Property crumb links on every page
 * below a Property, a loaded page and its fallback draw the same trail, and a
 * place is named as the sidebar names it (`NAV_LABEL`). A loaded page calls it with
 * what it knows (`where`) and its own name (`current`: its title, the shorter name
 * the sidebar gives it, or the entity it shows).
 */
export function trailCrumbs(
  under: PageTrail,
  where: PageWhere,
  current: string,
): readonly Crumb[] {
  return [...parentCrumbs(under, where), { label: current }]
}

/**
 * The breadcrumbs of a page that names itself in `staticData.page`: its parents, then
 * itself. A page at the top of the app has none. `where` is what the route's address
 * and the cache know; the Property crumb is generic until the Property is loaded.
 */
export function resolveCrumbs(
  identity: PageIdentity,
  where: PageWhere,
): readonly Crumb[] | undefined {
  if (!identity.under) return undefined
  return trailCrumbs(identity.under, where, identity.crumb ?? identity.title)
}
