import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  RouterContextProvider,
  RouterProvider,
  Outlet,
} from '@tanstack/react-router'
import { describe, expect, it, vi } from 'vitest'
import { useTenantScope } from './useTenantScope'
import type { TenantScope } from '#/shared/queries/tenant-scope'
import { RoutePending } from '#/components/layout/route-page-state'

type Context = Readonly<{
  user?: { id: string }
  activeOrganization?: { id: string } | null
  staffUserId?: string
  entry?: { kind: string; userId?: string }
}>

async function renderScope(
  context: Context,
  childContext: Context = {},
): Promise<TenantScope | undefined> {
  const root = createRootRouteWithContext<Context>()()
  const page = createRoute({
    getParentRoute: () => root,
    path: '/',
    beforeLoad: () => childContext,
  })
  const router = createRouter({
    routeTree: root.addChildren([page]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
    context,
  })
  await router.load()
  let scope: TenantScope | undefined
  function ReadScope() {
    scope = useTenantScope()
    return null
  }
  renderToString(
    createElement(RouterContextProvider, {
      router,
      children: createElement(ReadScope),
    }),
  )
  return scope
}

describe('query scope from the signed-in route', () => {
  it.each(['Overview', 'Goals', 'Portal'])(
    'renders the %s placeholder with the shell query scope while descendant context is unresolved',
    async (title) => {
      vi.useFakeTimers()
      const client = new QueryClient()
      const scope = { userId: 'manager', organizationId: 'org' }
      let observedScope: TenantScope | undefined
      function ShellQuery() {
        observedScope = useTenantScope()
        return createElement(Outlet)
      }
      const root = createRootRouteWithContext<Context>()()
      const shell = createRoute({
        getParentRoute: () => root,
        id: 'authenticated',
        beforeLoad: () => ({
          user: { id: scope.userId },
          activeOrganization: { id: scope.organizationId },
        }),
        component: ShellQuery,
      })
      const source = createRoute({ getParentRoute: () => shell, path: '/' })
      let finishGate!: () => void
      const gate = new Promise<void>((resolve) => {
        finishGate = resolve
      })
      const destination = createRoute({
        getParentRoute: () => shell,
        path: 'destination',
        beforeLoad: () => gate,
        staticData: { page: { title, tier: 'dashboard' } },
      })
      const child = createRoute({ getParentRoute: () => destination, path: '/' })
      const router = createRouter({
        routeTree: root.addChildren([
          shell.addChildren([source, destination.addChildren([child])]),
        ]),
        history: createMemoryHistory({ initialEntries: ['/'] }),
        context: {},
        isServer: false,
        origin: 'http://localhost',
        defaultPendingMs: 250,
        defaultPendingComponent: RoutePending,
      })
      const render = () => {
        observedScope = undefined
        // Snapshot the client presentation without mounting a DOM transitioner.
        router.isServer = true
        try {
          return renderToString(
            createElement(
              QueryClientProvider,
              { client },
              createElement(RouterProvider, { router }),
            ),
          )
        } finally {
          router.isServer = false
        }
      }
      let navigation: Promise<void> | undefined
      try {
        await router.load()
        render()
        expect(observedScope).toEqual(scope)
        navigation = router.navigate({ href: '/destination' })
        await vi.advanceTimersByTimeAsync(250)
        expect(router.state.matches.at(-1)?.context).toEqual({})
        const pending = render()
        expect(observedScope).toEqual(scope)
        expect(pending).toContain('aria-busy="true"')
        expect(pending).toContain(title)
        finishGate()
        await navigation
        expect(render()).not.toContain('aria-busy="true"')
        expect(observedScope).toEqual(scope)
      } finally {
        finishGate()
        await navigation
        client.clear()
        vi.useRealTimers()
      }
    },
  )

  it('uses the manager workspace person and Organization', async () => {
    await expect(
      renderScope({ user: { id: 'manager' }, activeOrganization: { id: 'org' } }),
    ).resolves.toEqual({ userId: 'manager', organizationId: 'org' })
  })

  it.each([
    { staffUserId: 'staff' },
    { staffUserId: 'staff', user: { id: 'staff' }, activeOrganization: { id: 'org' } },
  ])(
    'uses the same own-account scope for standalone and embedded Staff Home: %j',
    async (context) => {
      await expect(renderScope(context)).resolves.toEqual({
        userId: 'staff',
        organizationId: null,
      })
    },
  )

  it('scopes the invitation list before an Organization is selected', async () => {
    await expect(
      renderScope({ entry: { kind: 'list', userId: 'invited' } }),
    ).resolves.toEqual({ userId: 'invited', organizationId: null })
  })

  it.each([
    { context: { staffUserId: 'staff' }, userId: 'staff' },
    {
      context: { user: { id: 'other' }, activeOrganization: null },
      userId: 'other',
    },
  ])(
    'prefers the resolved child identity over its manager ancestor: %j',
    async ({ context, userId }) => {
      await expect(
        renderScope(
          { user: { id: 'manager' }, activeOrganization: { id: 'org' } },
          context,
        ),
      ).resolves.toEqual({ userId, organizationId: null })
    },
  )

  it('refuses to manufacture a shared scope for an anonymous visitor', async () => {
    await expect(renderScope({})).rejects.toThrow('A signed-in query requires a person')
  })
})
