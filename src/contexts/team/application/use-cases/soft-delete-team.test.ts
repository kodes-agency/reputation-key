import { describe, it, expect, vi } from 'vitest'
import { softDeleteTeam } from './soft-delete-team'
import { createInMemoryTeamRepo } from '#/shared/testing/in-memory-team-repo'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { buildTestAuthContext, buildTestTeam } from '#/shared/testing/fixtures'
import { isTeamError } from '../../domain/errors'
import type { TeamId } from '../../domain/types'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { PropertyId } from '#/shared/domain/ids'
import { teamId } from '#/shared/domain/ids'
import type { OrganizationId } from '#/shared/domain/ids'

import type { TeamMembershipRepository } from '../ports/team-membership.repository'
const FIXED_TIME = new Date('2026-04-15T12:00:00Z')
const teamDeleteContext = () =>
  buildTestAuthContext({
    role: 'AccountAdmin',
    effectivePermissions: new Set(['team.delete']),
  })

// AccountAdmin has org-wide access (null = all properties)
const createStaffApi = (accessibleIds: PropertyId[] | null): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => accessibleIds,
  getAssignedPortals: async () => [],
})

const setup = () => {
  const teamRepo = createInMemoryTeamRepo()
  const events = createCapturingEventBus()
  const closeForTeam = vi.fn(async () => 0)
  const membershipRepo = { closeForTeam } as unknown as TeamMembershipRepository
  const useCase = softDeleteTeam({
    teamRepo,
    staffApi: createStaffApi(null),
    membershipRepo,
    events,
    clock: () => FIXED_TIME,
  })
  return { useCase, teamRepo, events, closeForTeam }
}

describe('softDeleteTeam', () => {
  it('soft-deletes a team', async () => {
    const { useCase, teamRepo } = setup()
    const ctx = teamDeleteContext()
    const team = buildTestTeam({ organizationId: ctx.organizationId })
    teamRepo.seed([team])

    await useCase({ teamId: team.id as TeamId }, ctx)

    const found = await teamRepo.findById(
      ctx.organizationId as OrganizationId,
      team.id as TeamId,
    )
    expect(found).toBeNull()
  })

  it('rejects non-admin roles', async () => {
    const { useCase, teamRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const team = buildTestTeam({ organizationId: ctx.organizationId })
    teamRepo.seed([team])

    await expect(useCase({ teamId: team.id as TeamId }, ctx)).rejects.toSatisfy(
      (e) => isTeamError(e) && e.code === 'forbidden',
    )
  })

  it('rejects when team not found', async () => {
    const { useCase } = setup()
    const ctx = teamDeleteContext()

    await expect(useCase({ teamId: teamId('nonexistent') }, ctx)).rejects.toSatisfy(
      (e) => isTeamError(e) && e.code === 'team_not_found',
    )
  })

  it('emits team.deleted event', async () => {
    const { useCase, teamRepo, events } = setup()
    const ctx = teamDeleteContext()
    const team = buildTestTeam({ organizationId: ctx.organizationId })
    teamRepo.seed([team])

    await useCase({ teamId: team.id as TeamId }, ctx)

    expect(events.capturedEvents).toHaveLength(1)
    expect(events.capturedEvents[0]._tag).toBe('team.deleted')
  })

  it('closes active memberships instead of rejecting or deleting history', async () => {
    const { useCase, teamRepo, closeForTeam } = setup()
    const ctx = teamDeleteContext()
    const team = buildTestTeam({ organizationId: ctx.organizationId })
    teamRepo.seed([team])

    await useCase({ teamId: team.id as TeamId }, ctx)

    expect(closeForTeam).toHaveBeenCalledWith(
      ctx.organizationId,
      team.id,
      FIXED_TIME,
      'team_archived',
    )
  })
})
