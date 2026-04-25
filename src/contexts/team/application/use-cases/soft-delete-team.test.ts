import { describe, it, expect } from 'vitest'
import { softDeleteTeam } from './soft-delete-team'
import { createInMemoryTeamRepo } from '#/shared/testing/in-memory-team-repo'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { buildTestAuthContext, buildTestTeam } from '#/shared/testing/fixtures'
import { isTeamError } from '../../domain/errors'
import type { TeamId } from '../../domain/types'
import { teamId } from '#/shared/domain/ids'
import type { OrganizationId } from '#/shared/domain/ids'

const FIXED_TIME = new Date('2026-04-15T12:00:00Z')

const setup = () => {
  const teamRepo = createInMemoryTeamRepo()
  const events = createCapturingEventBus()
  const useCase = softDeleteTeam({ teamRepo, events, clock: () => FIXED_TIME })
  return { useCase, teamRepo, events }
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
})
