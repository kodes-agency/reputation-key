import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { redirect } from '@tanstack/react-router'
import { QueryClient } from '@tanstack/react-query'

const { getSession, getActiveOrganization, getCapabilitySet, readViewportHint } =
  vi.hoisted(() => ({
    getSession: vi.fn(),
    getActiveOrganization: vi.fn(),
    getCapabilitySet: vi.fn(),
    readViewportHint: vi.fn(),
  }))

vi.mock('#/shared/auth/auth.functions', () => ({ getSession }))
vi.mock('#/contexts/identity/server/organizations', () => ({
  getActiveOrganization,
}))
vi.mock('#/contexts/inbox/server/inbox', () => ({ getLastVisitCountFn: vi.fn() }))
vi.mock('#/routes/-notification-fns', () => ({ notificationFns: {} }))
vi.mock('#/routes/-viewport-hint', () => ({ readViewportHint }))
vi.mock('#/shared/auth/capability-set', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#/shared/auth/capability-set')>()),
  getCapabilitySet,
}))

import { EMPTY_CAPABILITY_SET } from '#/shared/auth/capability-set'
import { Route } from './_authenticated'

/** The router context `beforeLoad` reads: a QueryClient of its own per test. */
const shellContext = (queryClient = new QueryClient()) => ({ queryClient })

const SESSION = {
  user: {
    id: 'user-1',
    name: 'Denev Staging',
    email: 'denev@kodes.agency',
    image: null,
  },
}

const ACTIVE_ORGANIZATION = {
  availability: 'available',
  organization: {
    id: 'organization-1',
    name: 'Riverside Hotels',
    slug: 'riverside-hotels',
    contactEmail: null,
  },
  role: 'Member',
  authz: {},
}

describe('authenticated route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getCapabilitySet.mockResolvedValue(EMPTY_CAPABILITY_SET)
  })

  it('redirects a capability-disabled workspace to its unavailable page', async () => {
    getSession.mockResolvedValue(SESSION)
    getActiveOrganization.mockResolvedValue({
      availability: 'disabled',
      organization: null,
      role: 'Member',
      authz: {},
    })

    const beforeLoad = Route.options.beforeLoad
    if (!beforeLoad) throw new Error('Authenticated route must define beforeLoad')

    await expect(
      beforeLoad({ context: shellContext(), location: { href: '/dashboard' } } as never),
    ).rejects.toMatchObject({
      options: {
        to: '/unavailable',
        search: { feature: 'Workspace' },
      },
    })
  })

  it('routes an active workspace without a resolved role to its unavailable page', async () => {
    getSession.mockResolvedValue(SESSION)
    getActiveOrganization.mockResolvedValue({
      ...ACTIVE_ORGANIZATION,
      role: null,
    })

    const beforeLoad = Route.options.beforeLoad
    if (!beforeLoad) throw new Error('Authenticated route must define beforeLoad')

    await expect(
      beforeLoad({
        context: shellContext(),
        location: { href: '/dashboard', pathname: '/dashboard' },
      } as never),
    ).rejects.toMatchObject({
      options: {
        to: '/unavailable',
        search: { feature: 'Workspace' },
      },
    })
  })

  it('routes a signed-in account without an active workspace to the access state', async () => {
    getSession.mockResolvedValue(SESSION)
    getActiveOrganization.mockResolvedValue({
      availability: 'available',
      organization: null,
      role: 'Member',
      authz: {},
    })

    const beforeLoad = Route.options.beforeLoad
    if (!beforeLoad) throw new Error('Authenticated route must define beforeLoad')

    await expect(
      beforeLoad({
        context: shellContext(),
        location: { href: '/dashboard', pathname: '/dashboard' },
      } as never),
    ).rejects.toMatchObject({
      options: {
        to: '/unavailable',
        search: { reason: 'workspace_access' },
      },
    })
  })

  it('routes an explicit no-active-organization denial to the same access state', async () => {
    getSession.mockResolvedValue(SESSION)
    getActiveOrganization.mockRejectedValue(
      Object.assign(new Error('No active organization selected'), {
        code: 'no_active_org',
      }),
    )

    const beforeLoad = Route.options.beforeLoad
    if (!beforeLoad) throw new Error('Authenticated route must define beforeLoad')

    await expect(
      beforeLoad({
        context: shellContext(),
        location: { href: '/dashboard', pathname: '/dashboard' },
      } as never),
    ).rejects.toMatchObject({
      options: {
        to: '/unavailable',
        search: { reason: 'workspace_access' },
      },
    })
  })

  it('degrades a non-redirect capability failure after organization resolution', async () => {
    getSession.mockResolvedValue(SESSION)
    getActiveOrganization.mockResolvedValue(ACTIVE_ORGANIZATION)
    getCapabilitySet.mockRejectedValue(new Error('capability service unavailable'))

    const beforeLoad = Route.options.beforeLoad
    if (!beforeLoad) throw new Error('Authenticated route must define beforeLoad')

    await expect(
      beforeLoad({
        context: shellContext(),
        location: { href: '/dashboard', pathname: '/dashboard' },
      } as never),
    ).resolves.toMatchObject({ capabilities: EMPTY_CAPABILITY_SET })
  })

  it('preserves a capability redirect after organization resolution', async () => {
    getSession.mockResolvedValue(SESSION)
    getActiveOrganization.mockResolvedValue(ACTIVE_ORGANIZATION)
    getCapabilitySet.mockRejectedValue(
      redirect({
        to: '/unavailable',
        search: {
          feature: 'Goals',
          category: 'needs_admin_enablement',
          propertyId: 'property-1',
        },
      }),
    )

    const beforeLoad = Route.options.beforeLoad
    if (!beforeLoad) throw new Error('Authenticated route must define beforeLoad')

    await expect(
      beforeLoad({
        context: shellContext(),
        location: { href: '/dashboard', pathname: '/dashboard' },
      } as never),
    ).rejects.toMatchObject({
      options: {
        to: '/unavailable',
        search: {
          feature: 'Goals',
          category: 'needs_admin_enablement',
          propertyId: 'property-1',
        },
      },
    })
  })

  it('hands the request viewport hint to the layout with the primed Properties', async () => {
    const hint = { width: 390, mobile: true }
    readViewportHint.mockReturnValue(hint)
    const ensureQueryData = vi.fn().mockResolvedValue({ properties: [] })

    const loader = Route.options.loader
    if (typeof loader !== 'function') {
      throw new Error('Authenticated route must define a loader function')
    }

    await expect(
      loader({ context: { queryClient: { ensureQueryData } } } as never),
    ).resolves.toEqual({ viewportHint: hint })
    expect(ensureQueryData).toHaveBeenCalledOnce()
  })

  describe('in the browser, where the checks are remembered for 30 seconds', () => {
    const DASHBOARD = { href: '/dashboard', pathname: '/dashboard' }
    const START = new Date('2026-10-28T10:00:00Z').getTime()
    const later = (ms: number) => vi.setSystemTime(START + ms)

    beforeEach(() => {
      vi.stubGlobal('document', {})
      // Only the clock: Query's own scheduling keeps its real timers.
      vi.useFakeTimers({ toFake: ['Date'], now: START })
      getSession.mockResolvedValue(SESSION)
      getActiveOrganization.mockResolvedValue(ACTIVE_ORGANIZATION)
    })

    afterEach(() => {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    })

    const beforeLoadIn = (queryClient: QueryClient) => {
      const beforeLoad = Route.options.beforeLoad
      if (!beforeLoad) throw new Error('Authenticated route must define beforeLoad')
      return beforeLoad({
        context: shellContext(queryClient),
        location: DASHBOARD,
      } as never)
    }

    it('opens a second page within 30 seconds without asking the server', async () => {
      const queryClient = new QueryClient()
      const first = await beforeLoadIn(queryClient)
      later(29_000)
      const second = await beforeLoadIn(queryClient)

      expect(second).toEqual(first)
      expect(getSession).toHaveBeenCalledOnce()
      expect(getActiveOrganization).toHaveBeenCalledOnce()
      expect(getCapabilitySet).toHaveBeenCalledOnce()
    })

    it('asks again after 30 seconds, and a session that ended meanwhile goes to login', async () => {
      const queryClient = new QueryClient()
      await beforeLoadIn(queryClient)
      later(30_001)
      getSession.mockResolvedValue(null)

      await expect(beforeLoadIn(queryClient)).rejects.toMatchObject({
        options: { to: '/login', search: { redirect: '/dashboard' } },
      })
      expect(getSession).toHaveBeenCalledTimes(2)
    })

    it('keeps no missing session: the next navigation asks again', async () => {
      const queryClient = new QueryClient()
      getSession.mockResolvedValue(null)
      await expect(beforeLoadIn(queryClient)).rejects.toMatchObject({
        options: { to: '/login' },
      })
      getSession.mockResolvedValue(SESSION)

      await expect(beforeLoadIn(queryClient)).resolves.toMatchObject({
        user: { id: 'user-1' },
      })
      expect(getSession).toHaveBeenCalledTimes(2)
    })

    it('keeps no workspace refusal: access granted a moment later opens the shell', async () => {
      const queryClient = new QueryClient()
      getActiveOrganization.mockResolvedValue({
        ...ACTIVE_ORGANIZATION,
        organization: null,
      })
      await expect(beforeLoadIn(queryClient)).rejects.toMatchObject({
        options: { to: '/unavailable', search: { reason: 'workspace_access' } },
      })
      getActiveOrganization.mockResolvedValue(ACTIVE_ORGANIZATION)

      await expect(beforeLoadIn(queryClient)).resolves.toMatchObject({
        activeOrganization: { id: 'organization-1' },
      })
      expect(getActiveOrganization).toHaveBeenCalledTimes(2)
      // The session was still fresh, so only the Organization was asked again.
      expect(getSession).toHaveBeenCalledOnce()
    })

    it('still turns a failed capability read into the empty set, and asks again next time', async () => {
      const queryClient = new QueryClient()
      getCapabilitySet.mockRejectedValueOnce(new Error('capability service unavailable'))
      await expect(beforeLoadIn(queryClient)).resolves.toMatchObject({
        capabilities: EMPTY_CAPABILITY_SET,
      })

      await beforeLoadIn(queryClient)
      expect(getCapabilitySet).toHaveBeenCalledTimes(2)
    })
  })
})

describe('staff-only manager-route redirects', () => {
  it.each(['/dashboard', '/inbox', '/properties/11111111-1111-4111-8111-111111111111'])(
    'returns %s to my when the organization reports staff',
    async (pathname) => {
      getSession.mockResolvedValue(SESSION)
      getCapabilitySet.mockResolvedValue(EMPTY_CAPABILITY_SET)
      getActiveOrganization.mockResolvedValue({
        availability: 'staff',
        organization: null,
        role: 'Member',
        authz: {},
      })
      const beforeLoad = Route.options.beforeLoad
      if (!beforeLoad) throw new Error('Missing shell guard')
      await expect(
        beforeLoad({
          context: shellContext(),
          location: { href: pathname, pathname },
        } as never),
      ).rejects.toMatchObject({ options: { to: '/my' } })
    },
  )
  it('handles a serialized beta_role_inactive refusal without opening the manager gate', async () => {
    getSession.mockResolvedValue(SESSION)
    getCapabilitySet.mockResolvedValue(EMPTY_CAPABILITY_SET)
    getActiveOrganization.mockRejectedValue(
      Object.assign(new Error('Staff only'), { code: 'beta_role_inactive', status: 403 }),
    )
    const beforeLoad = Route.options.beforeLoad
    if (!beforeLoad) throw new Error('Missing shell guard')
    await expect(
      beforeLoad({
        context: shellContext(),
        location: { href: '/inbox', pathname: '/inbox' },
      } as never),
    ).rejects.toMatchObject({ options: { to: '/my' } })
  })
})
