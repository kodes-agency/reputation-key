import { describe, it, expect } from 'vitest'
import { createTeam } from './create-team'
import { createInMemoryTeamRepo } from '#/shared/testing/in-memory-team-repo'
import { createInMemoryPropertyRepo } from '#/shared/testing/in-memory-property-repo'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { buildTestAuthContext, buildTestProperty } from '#/shared/testing/fixtures'
import { isTeamError } from '../../domain/errors'
import type { TeamId } from '../../domain/types'
import { teamId } from '#/shared/domain/ids'
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'

const FIXED_ID = teamId('team-00000000-0000-0000-0000-000000000001') as TeamId
const FIXED_TIME = new Date('2026-04-15T12:00:00Z')

const setup = () => {
  const teamRepo = createInMemoryTeamRepo()
  const propertyRepo = createInMemoryPropertyRepo()
  const events = createCapturingEventBus()

  const propertyExists = {
    exists: async (_orgId: OrganizationId, pid: PropertyId) => {
      const p = await propertyRepo.findById(_orgId, pid)
      return p !== null
    },
  }

  const deps = {
    teamRepo,
    propertyExists,
    events,
    idGen: () => FIXED_ID,
    clock: () => FIXED_TIME,
  }

  const useCase = createTeam(deps)
  return { useCase, teamRepo, propertyRepo, events }
}

describe('createTeam', () => {
  it('creates a team with required fields', async () => {
    const { useCase, propertyRepo, teamRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const property = buildTestProperty({ organizationId: ctx.organizationId })
    propertyRepo.seed([property])

    const team = await useCase({ propertyId: property.id, name: 'Front Desk' }, ctx)

    expect(team.name).toBe('Front Desk')
    expect(team.propertyId).toBe(property.id)
    expect(teamRepo.all()).toHaveLength(1)
  })

  it('creates a team with optional fields', async () => {
    const { useCase, propertyRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const property = buildTestProperty({ organizationId: ctx.organizationId })
    propertyRepo.seed([property])

    const team = await useCase(
      {
        propertyId: property.id,
        name: 'Housekeeping',
        description: 'Room cleaning team',
        teamLeadId: 'user-00000000-0000-0000-0000-000000000001',
      },
      ctx,
    )

    expect(team.description).toBe('Room cleaning team')
    expect(team.teamLeadId).toBeTruthy()
  })

  it('rejects users who cannot create teams', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'Staff' })

    await expect(useCase({ propertyId: 'any', name: 'Test' }, ctx)).rejects.toSatisfy(
      (e) => isTeamError(e) && e.code === 'forbidden',
    )
  })

  it('rejects when property does not exist', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await expect(
      useCase({ propertyId: 'nonexistent', name: 'Test' }, ctx),
    ).rejects.toSatisfy((e) => isTeamError(e) && e.code === 'property_not_found')
  })

  it('rejects duplicate team name in same property', async () => {
    const { useCase, propertyRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const property = buildTestProperty({ organizationId: ctx.organizationId })
    propertyRepo.seed([property])

    await useCase({ propertyId: property.id, name: 'Front Desk' }, ctx)

    await expect(
      useCase({ propertyId: property.id, name: 'Front Desk' }, ctx),
    ).rejects.toSatisfy((e) => isTeamError(e) && e.code === 'name_taken')
  })

  it('emits team.created event on success', async () => {
    const { useCase, propertyRepo, events } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const property = buildTestProperty({ organizationId: ctx.organizationId })
    propertyRepo.seed([property])

    await useCase({ propertyId: property.id, name: 'Front Desk' }, ctx)

    const emitted = events.capturedEvents
    expect(emitted).toHaveLength(1)
    expect(emitted[0]._tag).toBe('team.created')
  })
})
