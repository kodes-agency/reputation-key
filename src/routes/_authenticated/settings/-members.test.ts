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
  getSelfServiceLeaveAvailabilityFn: vi.fn(async () => ({ available: false })),
  listOutstandingResponsibilitiesFn: vi.fn(async () => ({ outstanding: [] })),
}))

vi.mock('#/contexts/identity/server/organizations', () => ({
  listMembers: server.listMembers,
  listInvitations: server.listInvitations,
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
vi.mock('#/routes/-queries/route-queries', () => ({
  propertiesQuery: {},
}))

import { Route } from './members'
import { outstandingResponsibilitiesQuery } from './-leave-organization-queries'

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
