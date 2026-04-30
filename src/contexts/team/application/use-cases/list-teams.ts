// Team context — list teams use case
// Filters teams by property access: AccountAdmin sees all teams in org,
// PropertyManager/Staff see only teams in properties they're assigned to.

import type { TeamRepository } from '../ports/team.repository'
import type { Team } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { PropertyId } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'

// fallow-ignore-next-line unused-type
export type ListTeamsDeps = Readonly<{
  teamRepo: TeamRepository
  staffApi: StaffPublicApi
}>

export const listTeams =
  (deps: ListTeamsDeps) =>
  async (
    input: { propertyId: PropertyId },
    ctx: AuthContext,
  ): Promise<ReadonlyArray<Team>> => {
    const accessibleIds = await deps.staffApi.getAccessiblePropertyIds(
      ctx.organizationId,
      ctx.userId,
      ctx.role,
    )

    // null means AccountAdmin — all properties accessible
    if (accessibleIds !== null) {
      const idSet = new Set(accessibleIds)
      if (!idSet.has(input.propertyId)) {
        return []
      }
    }

    return deps.teamRepo.listByProperty(ctx.organizationId, input.propertyId)
  }

// fallow-ignore-next-line unused-type
export type ListTeams = ReturnType<typeof listTeams>
