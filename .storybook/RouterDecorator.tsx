// Wraps each story in a TanStack memory router so components that call
// useRouter()/useNavigate()/useRouterState()/usePermissions() — anything via
// useMutationAction or useRouteContext — have valid router + auth context.
//
// The route tree provides a `/_authenticated` layout route carrying
// `{ role: 'AccountAdmin' }` (the owner role → every permission granted), so
// any story subtree calling usePermissions() / useRouteContext({ from:
// '/_authenticated' }) resolves without a per-story decorator. A fresh router
// is built once per mount; the latest Story fn is kept in a ref so the index
// route always renders the current story on args changes.
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

const OWNER_ROLE: Role = 'AccountAdmin'

function RouterDecoratorRoot({ Story }: { Story: () => ReactNode }) {
  const storyRef = useRef(Story)
  storyRef.current = Story
  const [router] = useState(() => {
    const StoryRoute = () => {
      const CurrentStory = storyRef.current
      return <CurrentStory />
    }
    const rootRoute = createRootRouteWithContext<{ role: Role }>()({
      component: Outlet,
    })
    const authRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '_authenticated',
      component: Outlet,
    })
    const indexRoute = createRoute({
      getParentRoute: () => authRoute,
      path: '/',
      // Render the hookified Storybook function as a React component. Calling
      // it as a plain function bypasses Storybook's hook dispatcher and causes
      // invalid-hook-call failures in browser tests.
      component: StoryRoute,
    })
    const routeTree = rootRoute.addChildren([authRoute.addChildren([indexRoute])])
    return createRouter({
      routeTree,
      context: { role: OWNER_ROLE },
      history: createMemoryHistory({ initialEntries: ['/_authenticated/'] }),
    })
  })
  return <RouterProvider router={router} />
}

export function RouterDecorator(Story: () => ReactNode) {
  // Storybook invokes decorator functions through its own hook wrapper rather
  // than as React components. Keep React hooks in a component that React mounts.
  return <RouterDecoratorRoot Story={Story} />
}
