import { describe, it, expect } from 'vitest'
import { updateTeam } from './update-team'
import { createInMemoryTeamRepo } from '#/shared/testing/in-memory-team-repo'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { buildTestTeam } from '#/shared/testing/fixtures'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { PropertyId } from '#/shared/domain/ids'
import { isTeamError } from '../../domain/errors'

const FIXED_TIME = new Date('2026-04-15T12:00:00Z')
const teamUpdateContext = () =>
  buildTestAuthContext({
    role: 'PropertyManager',
    effectivePermissions: new Set(['team.update']),
  })

const setup = (accessible: ReadonlyArray<PropertyId> | null = null) => {
  const teamRepo = createInMemoryTeamRepo()
  const events = createCapturingEventBus()

  // AccountAdmin/PM with org-wide access (null = all properties)
  const staffApi: StaffPublicApi = {
    getAccessiblePropertyIds: async () => accessible,
    getAssignedPortals: async () => [],
    countAssignmentsByTeam: async () => 0,
  }
  const deps = {
    teamRepo,
    staffApi,
    events,
    clock: () => FIXED_TIME,
  }

  const useCase = updateTeam(deps)
  return { useCase, teamRepo, events }
}

describe('updateTeam', () => {
  it('updates team name', async () => {
    const { useCase, teamRepo } = setup()
    const ctx = teamUpdateContext()
    const existing = buildTestTeam({ organizationId: ctx.organizationId })
    teamRepo.seed([existing])

    const updated = await useCase(
      { teamId: existing.id as string, name: 'New Name' },
      ctx,
    )

    expect(updated.name).toBe('New Name')
    expect(teamRepo.all()[0].name).toBe('New Name')
  })

  it('updates team description', async () => {
    const { useCase, teamRepo } = setup()
    const ctx = teamUpdateContext()
    const existing = buildTestTeam({ organizationId: ctx.organizationId })
    teamRepo.seed([existing])

    const updated = await useCase(
      { teamId: existing.id as string, description: 'Updated desc' },
      ctx,
    )

    expect(updated.description).toBe('Updated desc')
  })

  it('rejects users who cannot edit teams', async () => {
    const { useCase, teamRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'Staff' })
    const existing = buildTestTeam({ organizationId: ctx.organizationId })
    teamRepo.seed([existing])

    await expect(
      useCase({ teamId: existing.id as string, name: 'X' }, ctx),
    ).rejects.toSatisfy((e) => isTeamError(e) && e.code === 'forbidden')
  })

  it('rejects PropertyManager without assignment to the team property (D6-001)', async () => {
    // An explicitly authorized dormant caller must still pass property scope before the
    // update lands. Guard is reached only after the team is loaded, so seed it.
    const { useCase, teamRepo } = setup([])
    const ctx = teamUpdateContext()
    const existing = buildTestTeam({ organizationId: ctx.organizationId })
    teamRepo.seed([existing])

    await expect(
      useCase({ teamId: existing.id as string, name: 'X' }, ctx),
    ).rejects.toSatisfy((e) => isTeamError(e) && e.code === 'forbidden')
  })

  it('rejects when team not found', async () => {
    const { useCase } = setup()
    const ctx = teamUpdateContext()

    await expect(useCase({ teamId: 'nonexistent', name: 'X' }, ctx)).rejects.toSatisfy(
      (e) => isTeamError(e) && e.code === 'team_not_found',
    )
  })

  it('emits team.updated event', async () => {
    const { useCase, teamRepo, events } = setup()
    const ctx = teamUpdateContext()
    const existing = buildTestTeam({ organizationId: ctx.organizationId })
    teamRepo.seed([existing])

    await useCase({ teamId: existing.id as string, name: 'New Name' }, ctx)

    expect(events.capturedEvents).toHaveLength(1)
    expect(events.capturedEvents[0]._tag).toBe('team.updated')
  })
})
