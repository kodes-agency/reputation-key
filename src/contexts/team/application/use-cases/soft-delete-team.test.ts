import { describe, it, expect } from 'vitest'
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

const FIXED_TIME = new Date('2026-04-15T12:00:00Z')

// AccountAdmin has org-wide access (null = all properties)
const createStaffApi = (accessibleIds: PropertyId[] | null): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => accessibleIds,
  getAssignedPortals: async () => [],
  countAssignmentsByTeam: async () => 0,
})

const setup = (assignmentCount = 0) => {
  const teamRepo = createInMemoryTeamRepo()
  const events = createCapturingEventBus()
  const assignmentCheck = { countByTeam: async () => assignmentCount }
  const useCase = softDeleteTeam({
    teamRepo,
    staffApi: createStaffApi(null),
    assignmentCheck,
    events,
    clock: () => FIXED_TIME,
  })
  return { useCase, teamRepo, events, assignmentCheck }
}

describe('softDeleteTeam', () => {
  it('soft-deletes a team', async () => {
    const { useCase, teamRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
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
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    await expect(useCase({ teamId: teamId('nonexistent') }, ctx)).rejects.toSatisfy(
      (e) => isTeamError(e) && e.code === 'team_not_found',
    )
  })

  it('emits team.deleted event', async () => {
    const { useCase, teamRepo, events } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    const team = buildTestTeam({ organizationId: ctx.organizationId })
    teamRepo.seed([team])

    await useCase({ teamId: team.id as TeamId }, ctx)

    expect(events.capturedEvents).toHaveLength(1)
    expect(events.capturedEvents[0]._tag).toBe('team.deleted')
  })

  it('rejects when team has active assignments', async () => {
    const { useCase, teamRepo } = setup(3)
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    const team = buildTestTeam({ organizationId: ctx.organizationId })
    teamRepo.seed([team])

    await expect(useCase({ teamId: team.id as TeamId }, ctx)).rejects.toSatisfy(
      (e) => isTeamError(e) && e.code === 'team_has_assignments',
    )
  })
})
