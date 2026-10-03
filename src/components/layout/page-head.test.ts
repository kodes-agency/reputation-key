// The tab title and the refusal, through a real router (rendered on the server,
// as the first request is): a page that cannot be opened is still titled after
// the page that was asked for, and its refusal draws the page's name, why, and
// the way back. `_authenticated` names every page from one `head`, so this pins
// the assumption that makes that work: a layout's `head` is given the whole chain,
// the leaf's `staticData` included, even when the leaf threw.
import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { roleUnavailable } from '#/shared/auth/route-notice'
import { pageHead } from './page-identity'
import { NoticeState } from './route-notice-state'
import { RouteNotFound } from './route-page-state'

const shellLoaded = { done: false }

function build(url: string) {
  shellLoaded.done = false
  const root = createRootRoute({ component: Outlet })
  const app = createRoute({
    getParentRoute: () => root,
    id: '_authenticated',
    loader: async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      shellLoaded.done = true
    },
    head: ({ matches }) => pageHead(matches),
    component: Outlet,
    notFoundComponent: ({ data }: { data?: unknown }) =>
      h('main', { 'data-shell': true }, h(NoticeState, { data })),
  })
  const people = createRoute({
    getParentRoute: () => app,
    path: '/people',
    staticData: { page: { title: 'People' } },
    component: () => h('p', null, 'People page'),
  })
  const goals = createRoute({
    getParentRoute: () => app,
    path: '/goals',
    staticData: { page: { title: 'Goals' } },
    beforeLoad: () => {
      throw roleUnavailable('Goals', 'properties')
    },
    component: () => h('p', null, 'Goals page'),
  })
  const settings = createRoute({
    getParentRoute: () => app,
    path: '/settings',
    staticData: { page: { title: 'Property settings' } },
    component: Outlet,
  })
  const section = createRoute({
    getParentRoute: () => settings,
    path: '/profile',
    component: () => h('p', null, 'A section'),
  })
  return createRouter({
    routeTree: root.addChildren([
      app.addChildren([people, goals, settings.addChildren([section])]),
    ]),
    history: createMemoryHistory({ initialEntries: [url] }),
    defaultNotFoundComponent: RouteNotFound,
  })
}

async function load(url: string) {
  const router = build(url)
  await router.load()
  const titles = router.state.matches.flatMap((match) =>
    (match.meta ?? []).flatMap((meta) => (meta && 'title' in meta ? [meta.title] : [])),
  )
  const html = renderToString(
    h(QueryClientProvider, { client: new QueryClient() }, h(RouterProvider, { router })),
  )
  return { titles, html, router }
}

describe('the tab title of an authenticated page', () => {
  it('is the page that is open', async () => {
    expect((await load('/people')).titles).toEqual(['People | Reputation Key'])
  })

  it('is still the page that was asked for when the page refused', async () => {
    expect((await load('/goals')).titles).toEqual(['Goals | Reputation Key'])
  })

  it('is the layout’s page for a section that names none of its own', async () => {
    expect((await load('/settings/profile')).titles).toEqual([
      'Property settings | Reputation Key',
    ])
  })

  it('is left to the root for an address no page answers', async () => {
    expect((await load('/nowhere')).titles).toEqual([])
  })
})

describe('a refused page', () => {
  it('draws the page’s name, why it is refused, and the way back', async () => {
    const { html } = await load('/goals')
    expect(html).toContain('data-shell')
    expect(html).toContain('>Goals</h1>')
    expect(html).toContain('You do not have access to Goals')
    expect(html).toContain('Ask an account admin if you need it.')
    expect(html).toContain('href="/properties"')
    expect(html).toContain('Back to Properties')
    expect(html).not.toContain('Goals page')
  })
})

describe('the shell a refusal draws inside', () => {
  it('has loaded its own data first, which the shell reads while drawing', async () => {
    await load('/goals')
    expect(shellLoaded.done).toBe(true)
  })
})

describe('an address no page answers', () => {
  it('says so in a page of its own, with a way back', async () => {
    const { html } = await load('/nowhere')
    expect(html).toContain('>Page not found</h1>')
    expect(html).toContain('Back to Properties')
  })
})
