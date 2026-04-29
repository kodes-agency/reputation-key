// Team context — soft-delete team use case

import type { TeamRepository } from '../ports/team.repository'
import type { EventBus } from '#/shared/events/event-bus'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { TeamId } from '#/shared/domain/ids'
import { can } from '#/shared/domain/permissions'
import { teamError } from '../../domain/errors'
import { teamDeleted } from '../../domain/events'

// fallow-ignore-next-line unused-type
export type SoftDeleteTeamDeps = Readonly<{
  teamRepo: TeamRepository
  events: EventBus
  clock: () => Date
}>

export const softDeleteTeam =
  (deps: SoftDeleteTeamDeps) =>
  async (input: { teamId: TeamId }, ctx: AuthContext): Promise<void> => {
    // 1. Authorize
    if (!can(ctx.role, 'team.delete')) {
      throw teamError('forbidden', 'this role cannot delete teams')
    }

    // 2. Validate entity exists
    const team = await deps.teamRepo.findById(ctx.organizationId, input.teamId)
    if (!team) {
      throw teamError('team_not_found', 'team not found')
    }

    // 5. Persist
    await deps.teamRepo.softDelete(ctx.organizationId, team.id)

    // 6. Emit event
    deps.events.emit(
      teamDeleted({
        teamId: team.id,
        organizationId: team.organizationId,
        occurredAt: deps.clock(),
      }),
    )
  }

// fallow-ignore-next-line unused-type
export type SoftDeleteTeam = ReturnType<typeof softDeleteTeam>
