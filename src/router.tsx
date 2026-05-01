import { createRouter as createTanStackRouter, useRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

import { Skeleton } from '#/components/ui/skeleton'
import { Alert, AlertDescription } from '#/components/ui/alert'
import { AlertCircle } from 'lucide-react'
import { Button } from '#/components/ui/button'

/** Default pending component — shown while route loaders are resolving. */
function DefaultPendingComponent() {
  return (
    <div className="page-wrap px-4 pb-8 pt-14">
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-32 w-full" />
      </div>
    </div>
  )
}

/** Default error component — shown when route loaders throw. */
function DefaultErrorComponent({ error }: { error: Error }) {
  const router = useRouter()

  return (
    <div className="page-wrap px-4 pb-8 pt-14">
      <Alert variant="destructive">
        <AlertCircle />
        <AlertDescription>
          {error.message || 'Something went wrong loading this page.'}
        </AlertDescription>
      </Alert>
      <Button variant="outline" className="mt-4" onClick={() => router.invalidate()}>
        Try again
      </Button>
    </div>
  )
}

export function getRouter() {
  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    // ── Caching ─────────────────────────────────────────────────────────
    // Remove defaultStaleTime — fall back to TanStack default (0).
    // Each route opts into its own staleTime based on data volatility.
    // After mutations we call router.invalidate() which forces a refresh
    // regardless of staleTime.
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
    defaultPendingComponent: DefaultPendingComponent,
    defaultErrorComponent: DefaultErrorComponent,
  })

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
