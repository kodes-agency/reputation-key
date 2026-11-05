import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router'
import { describe, expect, it } from 'vitest'
import { useTenantScope } from './useTenantScope'
import type { TenantScope } from '#/shared/queries/tenant-scope'

type Context = Readonly<{
  user?: { id: string }
  activeOrganization?: { id: string } | null
  staffUserId?: string
  entry?: { kind: string; userId?: string }
}>

async function renderScope(context: Context): Promise<TenantScope | undefined> {
  const root = createRootRouteWithContext<Context>()()
  const page = createRoute({ getParentRoute: () => root, path: '/' })
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

  it('refuses to manufacture a shared scope for an anonymous visitor', async () => {
    await expect(renderScope({})).rejects.toThrow('A signed-in query requires a person')
  })
})
