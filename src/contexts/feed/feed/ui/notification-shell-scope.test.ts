import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { Header } from '#/components/layout/header'
import { AppTopBar } from '#/components/layout/app-top-bar'
import { createKeys } from '#/shared/queries/query-keys'
import { useTenantScope } from '#/shared/hooks/useTenantScope'
import { useNotifications } from './notification-queries'
import * as notificationMutations from './notification-mutations'
import { readHeadKeepingOlderTrue } from './notification-feed-head'
import {
  loadOlderNotifications,
  type FetchNotificationPage,
  type OlderNotifications,
} from './notification-feed-older'
import {
  makeNotification,
  makeStatefulNotificationFns,
  notificationUserSettingsFixture,
} from './notification.stories.fixtures'
import type { ReactNode } from 'react'
import type { NotificationView } from '#/contexts/feed/application/public-api'

const user = { id: 'manager', name: 'Manager', email: 'manager@example.com', image: null }
const scope = { userId: user.id, organizationId: 'org' }
const { notificationKeys } = createKeys(scope)

vi.mock('#/shared/auth/auth-client', () => ({
  authClient: {
    useSession: () => ({
      data: { user, session: { activeOrganizationId: scope.organizationId } },
    }),
  },
}))

afterEach(() => vi.restoreAllMocks())

type Context = {
  user?: typeof user
  activeOrganization?: { id: string }
  staffUserId?: string
}

async function page(
  client: QueryClient,
  path: string,
  context: Context,
  body: ReactNode,
) {
  const root = createRootRouteWithContext<Context>()()
  const route = createRoute({ getParentRoute: () => root, path })
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: [path] }),
    context,
  })
  await router.load()
  return renderToString(
    createElement(
      QueryClientProvider,
      { client },
      createElement(RouterContextProvider, { router, children: body }),
    ),
  )
}

it.each(['/privacy', '/accept-invitation'])(
  'renders the signed-in public Header at %s using its session notification cache',
  async (path) => {
    const client = new QueryClient()
    const fns = makeStatefulNotificationFns([
      makeNotification({
        id: '10000000-0000-4000-8000-000000000001',
        type: 'reply.pending_approval',
      }),
    ])
    client.setQueryData(
      notificationKeys.head('org', 20, 'needs_you'),
      await fns.getFeedHead({ data: { limit: 20, filter: 'needs_you' } }),
    )
    client.setQueryData(
      notificationKeys.userSettings('org'),
      notificationUserSettingsFixture,
    )
    try {
      const html = await page(
        client,
        path,
        {},
        createElement(Header, { onSignOut: () => {}, notificationFns: fns }),
      )
      expect(html).toContain('aria-label="Notifications, 1 needs you"')
    } finally {
      client.clear()
    }
  },
)

it('dismisses loaded older notifications from the manager bell on /my-code and keeps it dismissed after returning and polling', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const rows = Array.from({ length: 4 }, (_, index) =>
    makeNotification({
      id: `10000000-0000-4000-8000-00000000000${index + 1}`,
      type: 'review.created',
      status: 'read',
      createdAt: new Date(Date.UTC(2026, 10, 1, 12, 4 - index)),
    }),
  )
  const target = rows[2]!
  const fns = makeStatefulNotificationFns(rows)
  let visible: ReadonlyArray<NotificationView> = []
  function Notifications() {
    visible = useNotifications(
      useTenantScope(),
      fns.getFeedHead,
      fns.getList,
      'org',
      2,
      'all',
      true,
    ).notifications
    return null
  }
  const managerContext = { user, activeOrganization: { id: 'org' } }
  const headKey = notificationKeys.head('org', 2, 'all')
  const olderKey = notificationKeys.list('org', 2, 'all')
  const fetchPage: FetchNotificationPage = (before, limit) =>
    fns.getList({ data: { limit, filter: 'all', before } })
  const fetchHead = readHeadKeepingOlderTrue(
    client,
    olderKey,
    () => fns.getFeedHead({ data: { limit: 2, filter: 'all' } }),
    fetchPage,
    2,
  )
  await client.fetchQuery({ queryKey: headKey, queryFn: fetchHead })
  try {
    await loadOlderNotifications(client, olderKey, headKey, fetchPage, 2)
    expect(
      client.getQueryData<OlderNotifications>(olderKey)?.rows.map((row) => row.id),
    ).toContain(target.id)
    await page(client, '/notifications', managerContext, createElement(Notifications))
    expect(visible.map((row) => row.id)).toContain(target.id)

    let actions: notificationMutations.NotificationFeedMutations | undefined
    const useRealMutations = notificationMutations.useNotificationMutations
    vi.spyOn(notificationMutations, 'useNotificationMutations').mockImplementation(
      function useCapturedMutations(...args) {
        actions = useRealMutations(...args)
        return actions
      },
    )
    await page(
      client,
      '/my-code',
      { ...managerContext, staffUserId: user.id },
      createElement(AppTopBar, {
        user,
        organizationId: 'org',
        notificationFns: fns,
        hasSidebar: false,
      }),
    )
    expect(actions).toBeDefined()
    actions!.onDismiss(target.id)
    await vi.waitFor(() => expect(client.isMutating()).toBe(0))

    // Returning shows the older rows again; only the head polls.
    await client.fetchQuery({ queryKey: headKey, queryFn: fetchHead })
    await page(client, '/notifications', managerContext, createElement(Notifications))
    expect(visible.map((row) => row.id)).toEqual([rows[0]!.id, rows[1]!.id, rows[3]!.id])
  } finally {
    client.clear()
  }
})
