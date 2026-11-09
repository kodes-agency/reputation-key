import { createContext, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  useMatch,
  useMatches,
  useParams,
  type ErrorComponentProps,
} from '@tanstack/react-router'
import { propertyKeys } from '#/shared/queries/query-keys'
import {
  fallbackIdentity,
  headerLinesOf,
  loadingShapeOf,
  propertyNameInList,
  resolveCrumbs,
} from './page-identity'
import { PageState, type PageStateBack, type PageStateFrame } from './page-state'
import { SignedOutRedirect, useGuardedRouteError } from './use-guarded-route-error'

// The route-bound half of PageState: what a route hands to `pendingComponent`,
// `errorComponent` or `notFoundComponent`. It reads the page's identity from the
// route (`page-identity`) and, for an error, the behaviour from `useGuardedRouteError`.

/**
 * True below the app shell's `<main>`. A not-found for an unanswered address renders
 * inside the layout; one a loader threw replaces the layout and must bring its own shell.
 */
export const ShellPresence = createContext(false)

/** The name of a Property in the cache, if it is there. */
function propertyNameIn(cached: unknown): string | undefined {
  if (typeof cached !== 'object' || cached === null) return undefined
  const { property } = cached as { property?: { name?: unknown } | null }
  return typeof property?.name === 'string' ? property.name : undefined
}

/**
 * The Property in the address and its name once read: the Property's own read
 * first, the Properties list as fallback, so the breadcrumb names it while loading.
 */
export function usePageWhere(): Readonly<{ propertyId?: string; propertyName?: string }> {
  const { propertyId } = useParams({ strict: false }) as { propertyId?: string }
  const queryClient = useQueryClient()
  if (!propertyId) return {}
  const propertyName =
    propertyNameIn(queryClient.getQueryData(propertyKeys.detail(propertyId))) ??
    propertyNameInList(queryClient.getQueryData(propertyKeys.list()), propertyId)
  return { propertyId, propertyName }
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
      shape: loadingShapeOf(identity),
      headerLines: headerLinesOf(identity),
    },
  }
}

/** Below the app shell `<main>` pads the state; elsewhere the state brings the public container. */
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
  if (guarded.reloading) {
    return (
      <Framed inShell={inShell}>
        <PageState kind="loading" {...frame} />
      </Framed>
    )
  }
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

/** What a not-found draws, without a frame: the entity the route says is gone, else the missing page. */
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
