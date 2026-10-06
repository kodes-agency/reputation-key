import { describe, expect, it, vi } from 'vitest'

const server = vi.hoisted(() => ({
  listStaffParticipations: vi.fn(async () => ({
    participations: [],
    responsibilities: [],
  })),
  listMembers: vi.fn(async () => ({ members: [] })),
  listPortals: vi.fn(async () => ({ portals: [] })),
}))

vi.mock('#/contexts/identity/server/staff-participations', () => ({
  archiveStaffParticipation: vi.fn(),
  createStaffParticipation: vi.fn(),
  listStaffParticipations: server.listStaffParticipations,
  updatePortalResponsibilities: vi.fn(),
}))
vi.mock('#/contexts/identity/server/organizations', () => ({
  listMembers: server.listMembers,
}))
vi.mock('#/contexts/portal/server/portals', () => ({
  listPortals: server.listPortals,
}))

import { Route } from './people'

describe('Staff route beta contract', () => {
  it('primes Staff Participants and Portal Responsibility without a duplicate loader payload', async () => {
    const loader = Route.options.loader
    if (typeof loader !== 'function') {
      throw new Error('Staff route must define a loader function')
    }

    const result = await loader({
      params: { propertyId: '10000000-0000-4000-8000-000000000001' },
      context: {
        queryClient: {
          ensureQueryData: async (options: { queryFn: () => Promise<unknown> }) =>
            options.queryFn(),
        },
      },
    } as never)

    expect(server.listStaffParticipations).toHaveBeenCalledOnce()
    // Staff lists the people who work here, not every login in the Organization
    // (that is Settings > Members), so it no longer reads the member list.
    expect(server.listMembers).not.toHaveBeenCalled()
    expect(server.listPortals).toHaveBeenCalledOnce()
    // Query hydration owns these payloads. Returning another object here would
    // serialize the same data twice and could accidentally revive Team fields.
    expect(result).toBeUndefined()
  })
})
