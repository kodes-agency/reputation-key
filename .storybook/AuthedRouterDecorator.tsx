// Storybook decorator that wraps a story in a TanStack memory router containing
// a pathless `/_authenticated` layout route, so components that call
// `usePermissions()` — which does `useRouteContext({ from: '/_authenticated' })`
// — render without throwing "Could not find an active match from '/_authenticated'".
//
// The `role` in route context defaults to `AccountAdmin` (the owner role, which
// the permission table grants every statement), so create/update/delete
// affordances all render. Use `withRole('Staff')` for a read-only member view.
//
// This is a NEW, parallel router provider. The global RouterDecorator from
// preview.ts still wraps every story (outermost); this decorator nests an
// inner RouterProvider whose context wins for the story subtree, so the story's
// useRouteContext/useRouter calls resolve against THIS router.
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { useRef, useState, type ReactNode } from 'react'
import type { Role } from '#/shared/domain/roles'

type AuthContext = Readonly<{ role: Role }>

function makeAuthedRouter(Story: () => ReactNode, role: Role) {
  const rootRoute = createRootRouteWithContext<AuthContext>()({
    component: Outlet,
  })
  // Pathless layout route — its id matches what usePermissions reads.
  const authedRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: '/_authenticated',
    component: Outlet,
  })
  const indexRoute = createRoute({
    getParentRoute: () => authedRoute,
    path: '/',
    // Render the live Story fn so args changes re-render without rebuilding
    // the router (createRouter is expensive and must stay stable per mount).
    component: () => <>{Story()}</>,
  })
  const routeTree = rootRoute.addChildren([authedRoute.addChildren([indexRoute])])
  return createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/'] }),
    context: { role },
  })
}

/** Default decorator — renders as AccountAdmin (owner: all permissions). */
export function AuthedRouterDecorator(Story: () => ReactNode) {
  // Re-read Story on every render; rebuild router only on mount.
  const storyRef = useRef(Story)
  storyRef.current = Story
  const [router] = useState(() =>
    makeAuthedRouter(() => storyRef.current(), 'AccountAdmin'),
  )
  return <RouterProvider router={router} />
}

/** Build a decorator that renders as a specific role (e.g. 'Staff' for a
 *  permission-restricted view). Usage: `decorators: [withRole('Staff')]`. */
export function withRole(role: Role) {
  return function AuthedRouterDecoratorForRole(Story: () => ReactNode) {
    const storyRef = useRef(Story)
    storyRef.current = Story
    const [router] = useState(() => makeAuthedRouter(() => storyRef.current(), role))
    return <RouterProvider router={router} />
  }
}
