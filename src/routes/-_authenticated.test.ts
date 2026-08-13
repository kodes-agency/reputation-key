import { describe, expect, it, vi } from 'vitest'

const { getSession, getActiveOrganization } = vi.hoisted(() => ({
  getSession: vi.fn(),
  getActiveOrganization: vi.fn(),
}))

vi.mock('#/shared/auth/auth.functions', () => ({ getSession }))
vi.mock('#/contexts/identity/server/organizations', () => ({
  getActiveOrganization,
  setActiveOrganization: vi.fn(),
}))
vi.mock('#/contexts/inbox/server/inbox', () => ({ getLastVisitCountFn: vi.fn() }))
vi.mock('#/routes/-notification-fns', () => ({ notificationFns: {} }))

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
})
