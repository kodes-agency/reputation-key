// A story decorator for a reader whose role may change portals while the
// organisation's `portal.write` capability is off (a kill switch, a partial
// admission): the one case where role and capability disagree, and the pages say
// so rather than offering what the server refuses. The default `AuthedRouterDecorator`
// resolves no capability set, which reads as everything on.
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { useMemo, type ReactNode } from 'react'
import type { CapabilitySet } from '#/shared/auth/capability-set'
import type { Role } from '#/shared/domain/roles'

const PORTAL_WRITES_OFF: CapabilitySet = {
  propertyId: null,
  allowed: ['portal.read'],
  refused: [{ capability: 'portal.write', category: 'not_in_beta' }],
}

type Context = Readonly<{ role: Role; capabilities: CapabilitySet }>

export function PortalWritesOffDecorator(Story: () => ReactNode) {
  const router = useMemo(() => {
    const root = createRootRouteWithContext<Context>()({ component: Outlet })
    const authed = createRoute({
      getParentRoute: () => root,
      id: '/_authenticated',
      component: Outlet,
    })
    const index = createRoute({
      getParentRoute: () => authed,
      path: '/',
      component: () => <Story />,
    })
    return createRouter({
      routeTree: root.addChildren([authed.addChildren([index])]),
      history: createMemoryHistory({ initialEntries: ['/'] }),
      context: { role: 'AccountAdmin', capabilities: PORTAL_WRITES_OFF },
    })
  }, [Story])
  return <RouterProvider router={router} />
}
