// Team context — get team use case
// Checks property access before returning team details.

import type { TeamRepository } from '../ports/team.repository'
import type { Team } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { TeamId } from '#/shared/domain/ids'
import type { PropertyAccessProvider } from '#/shared/domain/property-access.port'
import { teamError } from '../../domain/errors'

export type GetTeamDeps = Readonly<{
  teamRepo: TeamRepository
  propertyAccess: PropertyAccessProvider
}>

export const getTeam =
  (deps: GetTeamDeps) =>
  async (input: { teamId: TeamId }, ctx: AuthContext): Promise<Team> => {
    const team = await deps.teamRepo.findById(ctx.organizationId, input.teamId)
    if (!team) {
      throw teamError('team_not_found', 'team not found')
    }

    // Check property access for non-admin users
    const accessibleIds = await deps.propertyAccess.getAccessiblePropertyIds(
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

export type GetTeam = ReturnType<typeof getTeam>
