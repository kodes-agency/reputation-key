// Settings → Profile: a save reaches the signed-in identity the page and the shell show.
//
// The name and avatar on screen are not a Query: the form's saved values and the top
// bar's name, initials and picture are the `user` that `_authenticated`'s `beforeLoad`
// puts in the route context. So this runs the real route under the real layout route
// in a real router, saves through the page's own actions against an account the
// mocked server functions read and write, and asserts on what the context then holds.
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
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Action } from '#/components/hooks/use-action'

type Account = { id: string; name: string; email: string; image: string | null }

type CapturedPage = Readonly<{
  user: Pick<Account, 'name' | 'email' | 'image'>
  updateProfile: Action<{ data: { name: string } }>
  updateUserImage: Action<{ data: { imageUrl: string } }>
  removeUserImage: Action<{ data: { imageUrl: null } }>
}>

const server = vi.hoisted(() => {
  // What the account is on the server: `getSession` reads it, a save writes it.
  const account: { current: Account } = {
    current: { id: 'user-1', name: 'Ana', email: 'ana@example.com', image: null },
  }
  return {
    account,
    getSession: vi.fn(async () => ({ user: { ...account.current } })),
    getNotificationUserSettings: vi.fn(async () => null),
    page: { current: null as unknown },
  }
})

vi.mock('#/shared/auth/auth.functions', () => ({ getSession: server.getSession }))
vi.mock('#/contexts/identity/server/auth-settings', () => ({
  updateProfileFn: vi.fn(async (input: { data: { name: string } }) => {
    server.account.current = { ...server.account.current, name: input.data.name }
  }),
  updateUserImageFn: vi.fn(async (input: { data: { imageUrl: string | null } }) => {
    server.account.current = { ...server.account.current, image: input.data.imageUrl }
  }),
}))
vi.mock('#/contexts/identity/server/organizations', () => ({
  getActiveOrganization: vi.fn(async () => ({
    availability: 'available',
    organization: {
      id: 'organization-1',
      name: 'Riverside Hotels',
      slug: 'riverside-hotels',
      contactEmail: null,
    },
    role: 'AccountAdmin',
    authz: {},
  })),
  requestAvatarUpload: vi.fn(),
  finalizeAvatarUpload: vi.fn(),
}))
vi.mock('#/contexts/property/server/properties', () => ({
  listProperties: vi.fn(async () => ({ properties: [] })),
  getProperty: vi.fn(),
}))
vi.mock('#/contexts/feed/server/notifications', () => ({
  getNotificationUserSettingsFn: server.getNotificationUserSettings,
  updateNotificationUserSettingsFn: vi.fn(),
}))
vi.mock('#/contexts/inbox/server/inbox', () => ({ getLastVisitCountFn: vi.fn() }))
vi.mock('#/routes/-notification-fns', () => ({ notificationFns: {} }))
vi.mock('#/routes/-viewport-hint', () => ({ readViewportHint: () => undefined }))
vi.mock('#/shared/auth/capability-set', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#/shared/auth/capability-set')>()
  return { ...actual, getCapabilitySet: vi.fn(async () => actual.EMPTY_CAPABILITY_SET) }
})
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
// The page under the route: what it is handed is what the form and avatar show.
vi.mock('#/components/features/identity', () => ({
  ProfileSettingsPage: (props: unknown) => {
    server.page.current = props
    return null
  },
}))

import { Route as AuthenticatedRoute } from '#/routes/_authenticated'
import { Route as SettingsRoute } from '#/routes/_authenticated/settings'
import { Route as ProfileRoute } from './profile'

const AVATAR = '/api/public/identity-assets/avatars/user-1/3f1b2c4d'

const rootRoute = createRootRouteWithContext<{
  queryClient: QueryClient
  reportUnexpectedFailure: (error: unknown) => void
}>()()
// Wired as `routeTree.gen.ts` wires them, so the route ids are the app's.
const authenticatedRoute = AuthenticatedRoute.update({
  id: '/_authenticated',
  getParentRoute: () => rootRoute,
} as never)
const settingsRoute = SettingsRoute.update({
  id: '/settings',
  path: '/settings',
  getParentRoute: () => authenticatedRoute,
} as never)
const profileRoute = ProfileRoute.update({
  id: '/profile',
  path: '/profile',
  getParentRoute: () => settingsRoute,
} as never)
// A sibling page that keeps what it loaded for a minute, as Organization settings does.
const organizationLoader = vi.fn(() => null)
const organizationRoute = createRoute({
  path: '/organization',
  getParentRoute: () => settingsRoute,
  staleTime: 60_000,
  loader: organizationLoader,
})
const routeTree = rootRoute.addChildren([
  authenticatedRoute.addChildren([
    settingsRoute.addChildren([profileRoute, organizationRoute]),
  ]),
])

async function openSettings(at: '/settings/profile' | '/settings/organization') {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [at] }),
    context: { queryClient, reportUnexpectedFailure: () => undefined },
    // The browser's loading path, which is where a save happens; the origin is
    // given so the router does not look for a `window` to read it from.
    isServer: false,
    origin: 'http://localhost',
  })
  await router.load()

  /** Renders the page as the route would now, and returns what it was handed. */
  const page = (): CapturedPage => {
    const Page = profileRoute.options.component
    if (!Page) throw new Error('The profile route has no component')
    renderToString(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(RouterContextProvider, { router, children: createElement(Page) }),
      ),
    )
    return server.page.current as CapturedPage
  }
  /** The identity the shell's top bar draws: `_authenticated`'s route context. */
  const shellUser = () =>
    router.state.matches.find((match) => match.routeId === '/_authenticated')?.context
      .user

  return { router, page, shellUser }
}

const openProfile = () => openSettings('/settings/profile')

describe('saving the profile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    server.account.current = {
      id: 'user-1',
      name: 'Ana',
      email: 'ana@example.com',
      image: null,
    }
    server.page.current = null
  })

  it('makes the saved name the one the form and the shell hold, without a navigation', async () => {
    const { page, shellUser } = await openProfile()
    expect(page().user.name).toBe('Ana')

    await page().updateProfile({ data: { name: 'Ana Petrova' } })

    // The shell's account menu, and the saved values the form takes as its defaults.
    expect(shellUser()).toMatchObject({ name: 'Ana Petrova' })
    expect(page().user.name).toBe('Ana Petrova')
  })

  it('has the saved name in place by the time the save resolves, so the form never shows saved edits as unsaved', async () => {
    const { page, shellUser } = await openProfile()
    const save = page().updateProfile({ data: { name: 'Ana Petrova' } })
    const seenWhenResolved = save.then(() => shellUser()?.name)

    await expect(seenWhenResolved).resolves.toBe('Ana Petrova')
  })

  it('shows a new avatar in the shell once its save lands', async () => {
    const { page, shellUser } = await openProfile()

    await page().updateUserImage({ data: { imageUrl: AVATAR } })

    await vi.waitFor(() => expect(shellUser()).toMatchObject({ image: AVATAR }))
    expect(page().user.image).toBe(AVATAR)
  })

  it('takes a removed avatar out of the shell once its save lands', async () => {
    server.account.current = { ...server.account.current, image: AVATAR }
    const { page, shellUser } = await openProfile()
    expect(shellUser()).toMatchObject({ image: AVATAR })

    await page().removeUserImage({ data: { imageUrl: null } })

    await vi.waitFor(() => expect(shellUser()).toMatchObject({ image: null }))
  })

  it('reads the identity again and leaves another page the data it loaded', async () => {
    const { router, page } = await openSettings('/settings/organization')
    await router.navigate({ to: '/settings/profile' })
    expect(organizationLoader).toHaveBeenCalledTimes(1)
    const sessionReads = server.getSession.mock.calls.length

    await page().updateProfile({ data: { name: 'Ana Petrova' } })

    expect(server.getSession).toHaveBeenCalledTimes(sessionReads + 1)
    // Only the layout that holds the identity went stale: the page left a moment ago
    // is still within its minute and opens from what it has.
    await router.navigate({ to: '/settings/organization' })
    expect(organizationLoader).toHaveBeenCalledTimes(1)
  })
})
