import { beforeEach, describe, expect, it, vi } from 'vitest'
import { redirect } from '@tanstack/react-router'

const { getSession, getActiveOrganization, getCapabilitySet } = vi.hoisted(() => ({
  getSession: vi.fn(),
  getActiveOrganization: vi.fn(),
  getCapabilitySet: vi.fn(),
}))

vi.mock('#/shared/auth/auth.functions', () => ({ getSession }))
vi.mock('#/contexts/identity/server/organizations', () => ({
  getActiveOrganization,
  setActiveOrganization: vi.fn(),
}))
vi.mock('#/contexts/inbox/server/inbox', () => ({ getLastVisitCountFn: vi.fn() }))
vi.mock('#/routes/-notification-fns', () => ({ notificationFns: {} }))
vi.mock('#/shared/auth/capability-set', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#/shared/auth/capability-set')>()),
  getCapabilitySet,
}))

import { EMPTY_CAPABILITY_SET } from '#/shared/auth/capability-set'
import { Route } from './_authenticated'

const SESSION = {
  user: {
    id: 'user-1',
    name: 'Denev Staging',
    email: 'denev@kodes.agency',
    image: null,
  },
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
      role: 'Staff',
      authz: {},
    })

    const beforeLoad = Route.options.beforeLoad
    if (!beforeLoad) throw new Error('Authenticated route must define beforeLoad')

    await expect(
      beforeLoad({ location: { href: '/dashboard' } } as never),
    ).rejects.toMatchObject({
      options: {
        to: '/unavailable',
        search: { feature: 'Workspace' },
      },
    })
  })

  it('degrades a non-redirect capability failure after organization resolution', async () => {
    getSession.mockResolvedValue(SESSION)
    getActiveOrganization.mockResolvedValue({
      availability: 'enabled',
      organization: null,
      role: 'Staff',
      authz: {},
    })
    getCapabilitySet.mockRejectedValue(new Error('capability service unavailable'))

    const beforeLoad = Route.options.beforeLoad
    if (!beforeLoad) throw new Error('Authenticated route must define beforeLoad')

    await expect(
      beforeLoad({ location: { href: '/dashboard', pathname: '/dashboard' } } as never),
    ).resolves.toMatchObject({ capabilities: EMPTY_CAPABILITY_SET })
  })

  it('preserves a capability redirect after organization resolution', async () => {
    getSession.mockResolvedValue(SESSION)
    getActiveOrganization.mockResolvedValue({
      availability: 'enabled',
      organization: null,
      role: 'Staff',
      authz: {},
    })
    getCapabilitySet.mockRejectedValue(
      redirect({ to: '/unavailable', search: { feature: 'Capability' } }),
    )

    const beforeLoad = Route.options.beforeLoad
    if (!beforeLoad) throw new Error('Authenticated route must define beforeLoad')

    await expect(
      beforeLoad({ location: { href: '/dashboard', pathname: '/dashboard' } } as never),
    ).rejects.toMatchObject({
      options: {
        to: '/unavailable',
        search: { feature: 'Capability' },
      },
    })
  })
})
