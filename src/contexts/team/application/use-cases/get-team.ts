// Team context — get team use case
// Checks property access before returning team details.

import type { TeamRepository } from '../ports/team.repository'
import type { Team } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { TeamId } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { teamError } from '../../domain/errors'

// fallow-ignore-next-line unused-type
export type GetTeamDeps = Readonly<{
  teamRepo: TeamRepository
  staffApi: StaffPublicApi
}>

export const getTeam =
  (deps: GetTeamDeps) =>
  async (input: { teamId: TeamId }, ctx: AuthContext): Promise<Team> => {
    const team = await deps.teamRepo.findById(ctx.organizationId, input.teamId)
    if (!team) {
      throw teamError('team_not_found', 'team not found')
    }

    // Check property access for non-admin users
    const accessibleIds = await deps.staffApi.getAccessiblePropertyIds(
      ctx.organizationId,
      ctx.userId,
      ctx.role,
    )

    if (accessibleIds !== null) {
      const idSet = new Set(accessibleIds)
      if (!idSet.has(team.propertyId)) {
        // Return 404 to avoid leaking existence
        throw teamError('team_not_found', 'team not found')
      }
    }

    return team
  }

// fallow-ignore-next-line unused-type
export type GetTeam = ReturnType<typeof getTeam>
