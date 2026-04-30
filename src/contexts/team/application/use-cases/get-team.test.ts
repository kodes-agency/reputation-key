// getTeam use case tests
// Per conventions: "Every use case tested for happy path + every error path."

import { describe, it, expect } from 'vitest'
import { getTeam } from './get-team'
import { createInMemoryTeamRepo } from '#/shared/testing/in-memory-team-repo'
import { buildTestAuthContext, buildTestTeam } from '#/shared/testing/fixtures'
import { isTeamError } from '../../domain/errors'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { PropertyId } from '#/shared/domain/ids'

const createStaffApi = (accessibleIds: PropertyId[] | null): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => accessibleIds,
})

const setup = (staffApi?: StaffPublicApi) => {
  const teamRepo = createInMemoryTeamRepo()
  const api = staffApi ?? createStaffApi(null) // null = AccountAdmin (all access)

  const deps = { teamRepo, staffApi: api }
  const useCase = getTeam(deps)
  return { useCase, teamRepo }
}

describe('getTeam', () => {
  it('returns team for AccountAdmin (all properties accessible)', async () => {
    const { useCase, teamRepo } = setup(createStaffApi(null))
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    const team = buildTestTeam({ organizationId: ctx.organizationId })
    teamRepo.seed([team])

    const result = await useCase({ teamId: team.id }, ctx)
    expect(result.id).toBe(team.id)
    expect(result.name).toBe(team.name)
  })

  it('returns team when user has access to the property', async () => {
    const team = buildTestTeam()
    const accessProvider = createStaffApi([team.propertyId])
    const { useCase, teamRepo } = setup(accessProvider)
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const orgTeam = buildTestTeam({
      organizationId: ctx.organizationId,
      propertyId: team.propertyId,
    })
    teamRepo.seed([orgTeam])

    const result = await useCase({ teamId: orgTeam.id }, ctx)
    expect(result.id).toBe(orgTeam.id)
  })

  it('throws team_not_found when user lacks property access', async () => {
    const accessProvider = createStaffApi([]) // no properties accessible
    const { useCase, teamRepo } = setup(accessProvider)
    const ctx = buildTestAuthContext({ role: 'Staff' })
    const team = buildTestTeam({ organizationId: ctx.organizationId })
    teamRepo.seed([team])

    await expect(useCase({ teamId: team.id }, ctx)).rejects.toSatisfy(
      (e) => isTeamError(e) && e.code === 'team_not_found',
    )
  })

  it('throws team_not_found when team does not exist', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    await expect(
      useCase(
        { teamId: 'nonexistent' as unknown as import('#/shared/domain/ids').TeamId },
        ctx,
      ),
    ).rejects.toSatisfy((e) => isTeamError(e) && e.code === 'team_not_found')
  })
})
