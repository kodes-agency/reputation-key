import { createElement, type ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router'
import type { AuthRouteContext } from './_authenticated'
import { EMPTY_CLIENT_AUTHZ } from '#/shared/domain/auth-context'
import { EMPTY_CAPABILITY_SET } from '#/shared/auth/capability-set'

export const routeQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  })

/** Supply only the inputs a route hook reads, retaining their declared types. */
export function runRouteHook<TFn extends (...args: never[]) => unknown>(
  hook: TFn | undefined,
  args: {
    [K in keyof Parameters<TFn>[0]]?: Parameters<TFn>[0][K] extends object
      ? Partial<Parameters<TFn>[0][K]>
      : Parameters<TFn>[0][K]
  },
): ReturnType<TFn> {
  if (typeof hook !== 'function') throw new Error('The route hook is missing')
  return hook(args as never) as ReturnType<TFn>
}

/** Real providers for route hooks; server calls stay at each test's boundary. */
export async function createRouteHarness(overrides: Partial<AuthRouteContext> = {}) {
  const queryClient = routeQueryClient()
  const context: AuthRouteContext & { queryClient: QueryClient } = {
    queryClient,
    user: { id: 'user-1', name: 'Ana', email: 'ana@example.com', image: null },
    role: 'AccountAdmin',
    authz: EMPTY_CLIENT_AUTHZ,
    capabilities: EMPTY_CAPABILITY_SET,
    activeOrganization: {
      id: 'organization-1',
      name: 'Riverside Hotels',
      slug: 'riverside-hotels',
      contactEmail: null,
    },
    ...overrides,
  }
  const root = createRootRouteWithContext<typeof context>()()
  const authenticated = createRoute({
    id: '_authenticated',
    getParentRoute: () => root,
  })
  const index = createRoute({ path: '/', getParentRoute: () => authenticated })
  const router = createRouter({
    routeTree: root.addChildren([authenticated.addChildren([index])]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
    context,
    isServer: false,
    origin: 'http://localhost',
  })
  await router.load()
  const provide = (children: ReactNode) =>
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(RouterContextProvider, { router, children }),
    )
  return {
    queryClient,
    router,
    authenticated,
    context,
    provide,
    renderHook<T>(useValue: () => T): T {
      let result: { value: T } | undefined
      function Probe() {
        result = { value: useValue() }
        return null
      }
      renderToString(provide(createElement(Probe)))
      if (!result) throw new Error('The route hook did not render')
      return result.value
    },
  }
}
