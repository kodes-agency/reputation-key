import { AsyncLocalStorage } from 'node:async_hooks'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { organizationId, userId } from '#/shared/domain/ids'
import { ServerFunctionError } from '#/shared/auth/server-errors'

const START_KEY = Symbol.for('tanstack-start:start-storage-context')
function withStartContext<T>(fn: () => Promise<T>): Promise<T> {
  const global = globalThis as Record<symbol, AsyncLocalStorage<unknown> | undefined>
  const storage = global[START_KEY] ?? new AsyncLocalStorage<unknown>()
  global[START_KEY] = storage
  return storage.run({ startOptions: {} }, fn)
}

const mocks = vi.hoisted(() => ({
  resolveTenantContext: vi.fn(),
  decide: vi.fn(),
  requireExecutionAllowed: vi.fn(),
  listActiveTeamScopesByUser: vi.fn(),
  listMyTeam: vi.fn(),
  resolveTeamContext: vi.fn(),
  resolveStaffParticipationContext: vi.fn(),
  addTeamMember: vi.fn(),
  setTeamLead: vi.fn(),
}))

vi.mock('#/shared/auth/headers', () => ({
  headersFromContext: vi.fn(async () => new Headers()),
}))
vi.mock('#/shared/auth/middleware', () => ({
  resolveTenantContext: mocks.resolveTenantContext,
}))
vi.mock('#/shared/auth/execution-policy', () => ({
  requireExecutionAllowed: mocks.requireExecutionAllowed,
  getExecutionPolicy: vi.fn(() => ({ decide: mocks.decide })),
}))
vi.mock('#/composition', () => ({
  getContainer: vi.fn(() => ({
    useCases: {
      listActiveTeamScopesByUser: mocks.listActiveTeamScopesByUser,
      listMyTeam: mocks.listMyTeam,
      resolveTeamContext: mocks.resolveTeamContext,
      resolveStaffParticipationContext: mocks.resolveStaffParticipationContext,
      addTeamMember: mocks.addTeamMember,
      setTeamLead: mocks.setTeamLead,
    },
  })),
}))

import { addTeamMember, listMyTeam, setTeamLead } from './teams'

const ACTOR = {
  userId: userId('user-1'),
  organizationId: organizationId('org-a'),
  role: 'Staff',
} as const

const TEAM_ID = '00000000-0000-4000-8000-000000000001'
const PARTICIPATION_ID = '00000000-0000-4000-8000-000000000002'
const propertyDisabled = () =>
  new ServerFunctionError(
    'AuthError',
    'Authorization denied: property_disabled',
    'property_disabled',
    403,
  )

describe('Team server property scope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveTenantContext.mockResolvedValue(ACTOR)
    mocks.requireExecutionAllowed.mockImplementation(async ({ propertyId }) => {
      if (propertyId === 'property-p2') throw propertyDisabled()
    })
    mocks.decide.mockImplementation(async ({ propertyId }) => ({
      allowed: propertyId === 'property-p1',
      reason: propertyId === 'property-p1' ? 'allowed' : 'property_disabled',
    }))
  })

  it('prevents Staff my-team enumeration from widening P1 into P2', async () => {
    mocks.listActiveTeamScopesByUser.mockResolvedValue([
      {
        organizationId: 'org-a',
        propertyId: 'property-p1',
        teamId: 'team-p1',
        role: 'lead',
      },
      {
        organizationId: 'org-a',
        propertyId: 'property-p2',
        teamId: 'team-p2',
        role: 'lead',
      },
    ])
    mocks.listMyTeam.mockResolvedValue({ team: { id: 'team-p1' }, memberships: [] })

    await withStartContext(() => listMyTeam({ data: {} }))

    expect(mocks.listMyTeam).toHaveBeenCalledWith(
      { authorizedScopes: [{ teamId: 'team-p1', role: 'lead' }] },
      ACTOR,
    )
  })

  it('denies a P2 membership mutation before its effect', async () => {
    mocks.resolveTeamContext.mockResolvedValue({
      organizationId: 'org-a',
      propertyId: 'property-p2',
      teamId: TEAM_ID,
    })
    mocks.resolveStaffParticipationContext.mockResolvedValue({
      organizationId: 'org-a',
      propertyId: 'property-p2',
    })

    await expect(
      withStartContext(() =>
        addTeamMember({
          data: { teamId: TEAM_ID, staffParticipationId: PARTICIPATION_ID },
        }),
      ),
    ).rejects.toMatchObject({ _tag: 'AuthError', code: 'property_disabled', status: 403 })

    expect(mocks.addTeamMember).not.toHaveBeenCalled()
  })

  it('denies a P2 lead appointment before its effect', async () => {
    mocks.resolveTeamContext.mockResolvedValue({
      organizationId: 'org-a',
      propertyId: 'property-p2',
      teamId: TEAM_ID,
    })
    mocks.resolveStaffParticipationContext.mockResolvedValue({
      organizationId: 'org-a',
      propertyId: 'property-p2',
    })

    await expect(
      withStartContext(() =>
        setTeamLead({
          data: { teamId: TEAM_ID, staffParticipationId: PARTICIPATION_ID },
        }),
      ),
    ).rejects.toMatchObject({ _tag: 'AuthError', code: 'property_disabled', status: 403 })

    expect(mocks.setTeamLead).not.toHaveBeenCalled()
  })
})
