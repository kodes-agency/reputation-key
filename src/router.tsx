import { getGlobalStartContext } from '@tanstack/react-start'
import { QueryClient } from '@tanstack/react-query'
import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'
import { routeTree } from './routeTree.gen'

// The router's defaults are `PageState` in the frame of the page that is pending,
// failed or missing: the page's title, breadcrumbs and tier come from its route
// (`staticData.page`), and a failure is sanitised, reported, retryable and sends a
// 401 to sign-in (see `useGuardedRouteError`). They stay in first paint on
// purpose: a failure must be able to draw while the network is gone.
import {
  RouteError,
  RoutePending,
  RouteNotFound,
} from '#/components/layout/route-page-state'

export function getRouter() {
  // TanStack Query client cache. The ssr-query integration handles per-request
  // dehydration/hydration + streaming during SSR, and auto-wraps the app in
  // QueryClientProvider (no manual provider needed in the root component).
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: 1 },
    },
  })

  const cspNonce = getGlobalStartContext()?.cspNonce

  const router = createTanStackRouter({
    routeTree,
    // Expose the QueryClient via router context so route loaders can
    // prefetchQuery / ensureQueryData.
    context: { queryClient },
    // The same nonce is applied to framework-generated SSR scripts by
    // TanStack Router and to RootDocument's theme initialization script.
    ssr: cspNonce ? { nonce: cspNonce } : undefined,
    scrollRestoration: true,
    // ── Caching ─────────────────────────────────────────────────────────
    defaultPreloadStaleTime: 30_000,
    // Garbage-collect unused loader data after 30 minutes (TanStack default).
    defaultGcTime: 30 * 60 * 1000,

    // ── Preload ─────────────────────────────────────────────────────────
    // Hovering a <Link> preloads the target route's loader.
    defaultPreload: 'intent',

    // ── Pending UI ──────────────────────────────────────────────────────
    // Show skeleton immediately on navigation (no delay).
    defaultPendingMs: 0,
    // Don't enforce a minimum display time for the skeleton.
    defaultPendingMinMs: 0,
    defaultPendingComponent: RoutePending,
    defaultErrorComponent: RouteError,
    defaultNotFoundComponent: RouteNotFound,
  })

  // Wire SSR dehydration/hydration + streaming between Router and Query.
  // By default this also wraps the router output in <QueryClientProvider>.
  setupRouterSsrQueryIntegration({ router, queryClient })

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
