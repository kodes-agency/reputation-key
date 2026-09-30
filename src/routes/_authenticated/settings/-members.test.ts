// wiring-03: /settings/members must not issue a read that can only fail.
//
// Production composes no responsibility facts, so the transfer worklist read is
// fenced by design and every visit used to spend a request on a guaranteed
// `forbidden`. The loader now asks Identity whether self-service leave is
// composed at all, and the worklist query is disabled while it is not.

import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const server = vi.hoisted(() => ({
  listMembers: vi.fn(async () => ({ members: [], requestingRole: 'AccountAdmin' })),
  listInvitations: vi.fn(async () => ({ invitations: [] })),
  listMemberPropertyAccess: vi.fn(async () => ({ access: [] })),
  getSelfServiceLeaveAvailabilityFn: vi.fn(async () => ({ available: false })),
  listOutstandingResponsibilitiesFn: vi.fn(async () => ({ outstanding: [] })),
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
vi.mock('#/contexts/identity/server/organization-leave-fns', () => ({
  getSelfServiceLeaveAvailabilityFn: server.getSelfServiceLeaveAvailabilityFn,
  listOutstandingResponsibilitiesFn: server.listOutstandingResponsibilitiesFn,
  leaveOrganizationFn: vi.fn(),
}))
vi.mock('#/contexts/property/server/property-responsible-managers', () => ({
  listPropertyResponsibleManagers: vi.fn(),
  updatePropertyResponsibleManagers: vi.fn(),
}))
vi.mock('#/routes/-queries/route-queries', () => ({
  propertiesQuery: {},
  responsibleManagersQuery: vi.fn(),
}))

import { Route } from './members'
import { outstandingResponsibilitiesQuery } from './-leave-organization-queries'

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

describe('Members route self-service leave', () => {
  it('asks Identity whether leave is composed, and never reads the worklist to find out', async () => {
    const loader = Route.options.loader
    if (typeof loader !== 'function') {
      throw new Error('Members route must define a loader function')
    }

    const result = await loader({
      context: {
        role: 'AccountAdmin',
        queryClient: {
          ensureQueryData: async (options: { queryFn: () => Promise<unknown> }) =>
            options.queryFn(),
        },
      },
    } as never)

    expect(server.getSelfServiceLeaveAvailabilityFn).toHaveBeenCalledOnce()
    expect(result).toMatchObject({ selfServiceLeaveAvailable: false })
    expect(server.listOutstandingResponsibilitiesFn).not.toHaveBeenCalled()
  })

  it('does not issue the worklist read while self-service leave is unavailable', () => {
    const observer = new QueryObserver(
      new QueryClient(),
      outstandingResponsibilitiesQuery(false),
    )

    const unsubscribe = observer.subscribe(() => {})

    // A mount that fetches moves the query to `fetching` synchronously (the
    // control below), so `idle` here means no request was started.
    expect(observer.getCurrentResult().fetchStatus).toBe('idle')
    expect(server.listOutstandingResponsibilitiesFn).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('issues it on mount once self-service leave is available', async () => {
    const observer = new QueryObserver(
      new QueryClient(),
      outstandingResponsibilitiesQuery(true),
    )

    const unsubscribe = observer.subscribe(() => {})

    expect(observer.getCurrentResult().fetchStatus).toBe('fetching')
    await vi.waitFor(() =>
      expect(server.listOutstandingResponsibilitiesFn).toHaveBeenCalledOnce(),
    )
    unsubscribe()
  })
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

  it('sends a login that cannot list members to Profile', () => {
    expect(thrownByBeforeLoad('Member')).toMatchObject({
      options: { to: '/settings/profile' },
    })
  })
})
