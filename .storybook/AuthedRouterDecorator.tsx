// Storybook decorator that wraps a story in a TanStack memory router containing
// a pathless `/_authenticated` layout route, so components that call
// `usePermissions()` — which does `useRouteContext({ from: '/_authenticated' })`
// — render without throwing "Could not find an active match from '/_authenticated'".
//
// The `role` in route context defaults to `AccountAdmin` (the owner role, which
// the permission table grants every statement), so create/update/delete
// affordances all render. Use `withPermissions` for an exact restricted reader.
//
// The router boots on `/`. A story whose component reads the location (a nav that
// marks the page it is on) passes `{ at }`: the router then also answers any other
// address with the story, so the component sees that address as the current one.
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
import { useMemo, type ReactNode } from 'react'
import type { Role } from '#/shared/domain/roles'
import type { ClientAuthz } from '#/shared/domain/auth-context'
import type { Permission } from '#/shared/domain/permissions'
import { EMPTY_CLIENT_AUTHZ } from '#/shared/domain/auth-context'

type AuthContext = Readonly<{ role: Role; authz: ClientAuthz }>

type AuthedRouterOptions = Readonly<{
  /** The address the story is "on". Defaults to `/`. */
  at?: string
}>

function makeAuthedRouter(
  Story: () => ReactNode,
  role: Role,
  at = '/',
  authz = EMPTY_CLIENT_AUTHZ,
) {
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
    // Render Storybook's hookified function as a component. The decorator
    // rebuilds this memory router only when Storybook changes that component.
    component: () => <Story />,
  })
  // A splat route, only for a story that is on another address than `/`.
  const atRoute = createRoute({
    getParentRoute: () => authedRoute,
    path: '$',
    component: () => <Story />,
  })
  const children = at === '/' ? [indexRoute] : [indexRoute, atRoute]
  const routeTree = rootRoute.addChildren([authedRoute.addChildren(children)])
  return createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [at] }),
    context: { role, authz },
  })
}

/** Default decorator — renders as AccountAdmin (owner: all permissions). */
export function AuthedRouterDecorator(Story: () => ReactNode) {
  const router = useMemo(() => makeAuthedRouter(Story, 'AccountAdmin'), [Story])
  return <RouterProvider router={router} />
}

/** Build a decorator that renders as a specific role.
 *  `withRole('PropertyManager', { at: '/properties/1/settings/google' })` also puts the
 *  story on that address. */
export function withRole(role: Role, { at }: AuthedRouterOptions = {}) {
  return function AuthedRouterDecoratorForRole(Story: () => ReactNode) {
    const router = useMemo(() => makeAuthedRouter(Story, role, at), [Story])
    return <RouterProvider router={router} />
  }
}

/** A reader's precise permissions, independent of the built-in staff login role. */
export function withPermissions(
  permissions: readonly Permission[],
  { at }: AuthedRouterOptions = {},
) {
  return function AuthedRouterDecoratorForPermissions(Story: () => ReactNode) {
    const router = useMemo(
      () =>
        makeAuthedRouter(Story, 'PropertyManager', at, {
          effectivePermissions: permissions,
          scopeByPermission: Object.fromEntries(
            permissions.map((permission) => [permission, 'all' as const]),
          ),
        }),
      [Story],
    )
    return <RouterProvider router={router} />
  }
}
