import { createContext, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  useMatch,
  useMatches,
  useParams,
  type ErrorComponentProps,
} from '@tanstack/react-router'
import { propertyKeys } from '#/shared/queries/query-keys'
import { fallbackIdentity, resolveCrumbs } from './page-identity'
import { PageState, type PageStateBack, type PageStateFrame } from './page-state'
import { SignedOutRedirect, useGuardedRouteError } from './use-guarded-route-error'

// The route-bound half of PageState. Each component is what a route (or the
// router, as its default) hands to `pendingComponent`, `errorComponent` or
// `notFoundComponent`: it finds the page's identity on the route (see
// `page-identity`), draws `PageState` in that frame, and for an error takes the
// sanitised message, report, 401 redirect and retry from `useGuardedRouteError`.

/**
 * True below the app shell's `<main>`. A not-found for an address no page answers
 * renders inside the boundary route's layout, so it is already in the shell; one a
 * loader threw replaces the layout, so it must bring a shell of its own. The shell
 * marks its children, and a boundary asks.
 */
export const ShellPresence = createContext(false)

/** The name of a Property in the cache, if it is there. */
function propertyNameIn(cached: unknown): string | undefined {
  if (typeof cached !== 'object' || cached === null) return undefined
  const { property } = cached as { property?: { name?: unknown } | null }
  return typeof property?.name === 'string' ? property.name : undefined
}

/**
 * What the address and the cache know about where a page sits: the Property in
 * the address, and its name once it has been read.
 */
export function usePageWhere(): Readonly<{ propertyId?: string; propertyName?: string }> {
  const { propertyId } = useParams({ strict: false }) as { propertyId?: string }
  const queryClient = useQueryClient()
  const cached = propertyId
    ? queryClient.getQueryData(propertyKeys.detail(propertyId))
    : undefined
  return { propertyId, propertyName: propertyNameIn(cached) }
}

type RouteFrame = Readonly<{
  /** The app shell is on screen and its `<main>` already pads the state. */
  inShell: boolean
  /** Title, breadcrumbs and tier of the page the state stands in for. */
  frame: PageStateFrame
}>

function useRouteFrame(): RouteFrame {
  const routeId: string = useMatch({ strict: false }).routeId
  const matches = useMatches()
  const where = usePageWhere()

  const shell = matches.findIndex((match) => match.routeId === '/_authenticated')
  const here = matches.findIndex((match) => match.routeId === routeId)
  const inShell = shell >= 0 && here > shell
  const identity = fallbackIdentity(matches, routeId)
  if (!identity) return { inShell, frame: {} }

  return {
    inShell,
    frame: {
      title: identity.title,
      breadcrumbs: resolveCrumbs(identity, where),
      tier: identity.tier,
      fullBleed: identity.fullBleed,
    },
  }
}

/**
 * Below the app shell `<main>` pads the state. Anywhere else (the public pages,
 * or the shell's own load) nothing does, so the state brings the public
 * container the old defaults used.
 */
function Framed({
  inShell,
  children,
}: Readonly<{ inShell: boolean; children: ReactNode }>) {
  return inShell ? children : <div className="page-wrap px-4 pb-8 pt-14">{children}</div>
}

/** The loading state of whichever page is pending. */
export function RoutePending() {
  const { inShell, frame } = useRouteFrame()
  return (
    <Framed inShell={inShell}>
      <PageState kind="loading" {...frame} />
    </Framed>
  )
}

/** The failure state of whichever page failed. Guarded: see `useGuardedRouteError`. */
export function RouteError({ error }: ErrorComponentProps) {
  const guarded = useGuardedRouteError(error)
  const { inShell, frame } = useRouteFrame()
  if (guarded.signedOut) return <SignedOutRedirect />
  return (
    <Framed inShell={inShell}>
      <PageState
        kind="error"
        message={guarded.message}
        onRetry={guarded.retry}
        {...frame}
      />
    </Framed>
  )
}

/** What a missing entity says, for a route that knows better than "page not found". */
export type NotFoundCopy = Readonly<{
  heading: string
  reason?: string
  back: PageStateBack
}>

const PAGE_NOT_FOUND: NotFoundCopy = {
  heading: "The page you're looking for doesn't exist or may have moved.",
  back: { to: '/properties', label: 'Back to properties' },
}

/**
 * What a not-found draws, without a frame: the entity the route says is gone (in
 * the page's own frame), else the page that does not exist. `RouteNotFound` adds
 * the frame a route needs; the shell's boundary draws it inside the shell (see
 * `NoticeState`, which adds the notices of `route-notice`).
 */
export function NotFoundState({
  entity,
  frame,
}: Readonly<{ entity?: NotFoundCopy; frame?: PageStateFrame }>) {
  if (entity) return <PageState kind="notFound" {...frame} {...entity} />
  return <PageState kind="notFound" title="Page not found" {...PAGE_NOT_FOUND} />
}

/** The not-found state of whichever route has no better one. */
export function RouteNotFound({
  entity,
}: Readonly<{
  entity?: NotFoundCopy
  /** What a thrown `notFound()` carried. The router passes it; a notice is the shell's to read. */
  data?: unknown
}>) {
  const { inShell, frame } = useRouteFrame()
  return (
    <Framed inShell={inShell}>
      <NotFoundState entity={entity} frame={frame} />
    </Framed>
  )
}
