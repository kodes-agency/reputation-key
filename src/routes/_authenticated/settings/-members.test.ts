import { beforeEach, describe, expect, it, vi } from 'vitest'

const server = vi.hoisted(() => ({
  listMembers: vi.fn(async () => ({ members: [], requestingRole: 'AccountAdmin' })),
  listInvitations: vi.fn(async () => ({ invitations: [] })),
  listMemberPropertyAccess: vi.fn(async () => ({ access: [] })),
}))

vi.mock('#/contexts/identity/server/organizations', () => ({
  listMembers: server.listMembers,
  listInvitations: server.listInvitations,
  listMemberPropertyAccess: server.listMemberPropertyAccess,
  setMemberPropertyAccess: vi.fn(),
  inviteMember: vi.fn(),
  updateMemberRole: vi.fn(),
  removeMember: vi.fn(),
  resendInvitation: vi.fn(),
  cancelInvitation: vi.fn(),
}))
vi.mock('#/contexts/property/server/property-responsible-managers', () => ({
  listPropertyResponsibleManagers: vi.fn(),
  updatePropertyResponsibleManagers: vi.fn(),
}))
vi.mock('#/routes/-queries/route-queries', () => ({
  propertiesQuery: {},
  // The shared member list read; the route no longer keeps a copy of it.
  membersQuery: { queryKey: ['members'], queryFn: () => server.listMembers() },
}))
vi.mock('#/routes/_authenticated/properties/$propertyId/-settings-queries', () => ({
  responsibleManagersQuery: vi.fn(),
}))

import { Route } from './members'

type Role = 'AccountAdmin' | 'PropertyManager'

/** Runs the route's loader as `role`, reading through the real query functions. */
async function runLoader(role: Role) {
  const loader = Route.options.loader
  if (typeof loader !== 'function') {
    throw new Error('Members route must define a loader function')
  }
  return loader({
    context: {
      role,
      queryClient: {
        ensureQueryData: async (options: { queryFn: () => Promise<unknown> }) =>
          options.queryFn(),
      },
    },
  } as never)
}

/** What the route's beforeLoad throws for `role` (a redirect), or undefined. */
function thrownByBeforeLoad(role: string): unknown {
  const beforeLoad = Route.options.beforeLoad
  if (typeof beforeLoad !== 'function') {
    throw new Error('Members route must define beforeLoad')
  }
  try {
    beforeLoad({ context: { role } } as never)
  } catch (thrown) {
    return thrown
  }
  return undefined
}

beforeEach(() => {
  vi.clearAllMocks()
})

// Manager administration belongs to the Account Admin (ADR 0033, amended
// 2026-10). The loader reads only what the viewer's role may read, so a
// Property Manager's page never issues a read the server would refuse.
describe('Members route loader by role', () => {
  it("reads invitations and every member's Property access for an Account Admin", async () => {
    await runLoader('AccountAdmin')

    expect(server.listMembers).toHaveBeenCalledOnce()
    expect(server.listInvitations).toHaveBeenCalledOnce()
    expect(server.listMemberPropertyAccess).toHaveBeenCalledOnce()
  })

  it('reads only the member list for a Property Manager', async () => {
    await runLoader('PropertyManager')

    expect(server.listMembers).toHaveBeenCalledOnce()
    expect(server.listInvitations).not.toHaveBeenCalled()
    expect(server.listMemberPropertyAccess).not.toHaveBeenCalled()
  })

  it('offers an Account Admin both roles, the safe one first', async () => {
    await expect(runLoader('AccountAdmin')).resolves.toMatchObject({
      allowedRoles: ['PropertyManager', 'AccountAdmin'],
    })
  })

  it('offers a Property Manager only their own role', async () => {
    await expect(runLoader('PropertyManager')).resolves.toMatchObject({
      allowedRoles: ['PropertyManager'],
    })
  })
})

describe('Members route access', () => {
  it('lets a Property Manager open the page to read the list', () => {
    expect(thrownByBeforeLoad('PropertyManager')).toBeUndefined()
  })

  it('refuses a login that cannot list members in the shell, with the way back to Profile', () => {
    expect(thrownByBeforeLoad('Member')).toMatchObject({
      isNotFound: true,
      data: { cause: 'role', title: 'Members', back: 'profile' },
    })
  })
})
