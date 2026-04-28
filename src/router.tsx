import { createRouter as createTanStackRouter, useRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'
import { getContext } from './integrations/tanstack-query/root-provider'
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
  const context = getContext()

  const router = createTanStackRouter({
    routeTree,
    context,
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    defaultPendingComponent: DefaultPendingComponent,
    defaultErrorComponent: DefaultErrorComponent,
    defaultPendingMs: 500,
  })

  setupRouterSsrQueryIntegration({ router, queryClient: context.queryClient })

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
