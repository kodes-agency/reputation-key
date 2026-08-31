import { describe, expect, it, vi } from 'vitest'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import type { TeamRepository } from '../ports/team.repository'
import type {
  TeamMembershipRepository,
  TeamMembershipView,
} from '../ports/team-membership.repository'
import {
  addTeamMember,
  clearTeamLead,
  removeTeamMember,
  setTeamLead,
} from './team-memberships'
import { organizationId, propertyId, teamId, userId } from '#/shared/domain/ids'

const NOW = new Date('2026-08-08T12:00:00.000Z')
const ORG = organizationId('org-1')
const PROPERTY = propertyId('a0000000-0000-4000-8000-000000000001')
const TEAM = teamId('b0000000-0000-4000-8000-000000000001')
const teamMembershipContext = (
  role: 'PropertyManager' | 'Staff',
  overrides: Parameters<typeof buildTestAuthContext>[0] = {},
) =>
  buildTestAuthContext({
    ...overrides,
    role,
    effectivePermissions: new Set(['team.membership.manage']),
  })

const teamRepo: TeamRepository = {
  findById: async () => ({
    id: TEAM,
    organizationId: ORG,
    propertyId: PROPERTY,
    name: 'Front desk',
    description: null,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
  }),
  listByProperty: async () => [],
  nameExistsInProperty: async () => false,
  insert: async () => undefined,
  update: async () => undefined,
  softDelete: async () => undefined,
}

function view(participationId: string, role: 'member' | 'lead', user = 'user-2') {
  return {
    id: `membership-${participationId}-${role}`,
    organizationId: ORG,
    propertyId: PROPERTY,
    teamId: TEAM,
    staffParticipationId: participationId,
    userId: user,
    displayName: user,
    role,
    effectiveFrom: new Date('2026-08-01T00:00:00.000Z'),
    effectiveTo: null,
    createdBy: 'owner',
    endReason: null,
  } satisfies TeamMembershipView
}

function setup(actorRole: 'member' | 'lead' | null) {
  const addMember = vi.fn(async (input) => ({
    ok: true as const,
    membership: view(input.staffParticipationId, 'member'),
  }))
  const removeMember = vi.fn(async (input) => ({
    ok: true as const,
    membership: view(input.staffParticipationId, 'member'),
  }))
  const setLead = vi.fn(async (input) => ({
    ok: true as const,
    membership: view(input.staffParticipationId, 'lead'),
  }))
  const clearLead = vi.fn(async () => ({
    ok: true as const,
    membership: null,
  }))
  const membershipRepo: TeamMembershipRepository = {
    listByTeam: async () => [],
    listActiveByUser: async () => [],
    listAvailableForTeam: async () => [],
    findActiveRoleForUser: async () => actorRole,
    addMember,
    removeMember,
    setLead,
    clearLead,
    closeForTeam: async () => 0,
  }
  const deps = {
    teamRepo,
    membershipRepo,
    staffApi: {
      getAccessiblePropertyIds: async () => [PROPERTY],
      getAssignedPortals: async () => [],
    },
    clock: () => NOW,
  }
  return { deps, addMember, removeMember, setLead, clearLead }
}

describe('team membership commands', () => {
  it('allows Staff to add a non-lead member only to the actively led team', async () => {
    const { deps, addMember } = setup('lead')
    const result = await addTeamMember(deps)(
      { teamId: TEAM, staffParticipationId: 'participation-2' },
      teamMembershipContext('Staff', { userId: userId('lead-user') }),
    )
    expect(result.role).toBe('member')
    expect(addMember).toHaveBeenCalledOnce()
  })

  it('denies Staff membership management when the actor is not active lead', async () => {
    const { deps, addMember } = setup('member')
    await expect(
      addTeamMember(deps)(
        { teamId: TEAM, staffParticipationId: 'participation-2' },
        teamMembershipContext('Staff'),
      ),
    ).rejects.toMatchObject({ _tag: 'TeamError', code: 'forbidden' })
    expect(addMember).not.toHaveBeenCalled()
  })

  it('never lets Staff appoint or clear a lead', async () => {
    const { deps, setLead, clearLead } = setup('lead')
    const ctx = teamMembershipContext('Staff')
    await expect(
      setTeamLead(deps)({ teamId: TEAM, staffParticipationId: 'participation-2' }, ctx),
    ).rejects.toMatchObject({ code: 'forbidden' })
    await expect(
      clearTeamLead(deps)({ teamId: TEAM, reason: 'rotation' }, ctx),
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(setLead).not.toHaveBeenCalled()
    expect(clearLead).not.toHaveBeenCalled()
  })

  it('allows a manager to remove a non-lead member within granted property scope', async () => {
    const { deps, removeMember } = setup(null)
    const result = await removeTeamMember(deps)(
      { teamId: TEAM, staffParticipationId: 'participation-2', reason: 'reassigned' },
      teamMembershipContext('PropertyManager'),
    )
    expect(result.role).toBe('member')
    expect(removeMember).toHaveBeenCalledOnce()
  })
})
