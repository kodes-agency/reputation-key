// Team context — update team use case
// Per patterns.md section 27: field-level validation for partial updates.
// Only validates fields that are changing, using domain rules directly.

import type { TeamRepository } from '../ports/team.repository'
import type { EventBus } from '#/shared/events/event-bus'
import type { Team } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { UpdateTeamInput } from '../dto/update-team.dto'
import { can } from '#/shared/domain/permissions'
import { validateTeamName } from '../../domain/rules'
import { teamError } from '../../domain/errors'
import { teamUpdated } from '../../domain/events'
import { teamId as toTeamId } from '#/shared/domain/ids'

export type UpdateTeamDeps = Readonly<{
  teamRepo: TeamRepository
  events: EventBus
  clock: () => Date
}>

export const updateTeam =
  (deps: UpdateTeamDeps) =>
  async (input: UpdateTeamInput, ctx: AuthContext): Promise<Team> => {
    // 1. Authorize
    if (!can(ctx.role, 'team.update')) {
      throw teamError('forbidden', 'this role cannot edit teams')
    }

    // 2. Load existing team
    const tid = toTeamId(input.teamId)
    const existing = await deps.teamRepo.findById(ctx.organizationId, tid)
    if (!existing) {
      throw teamError('team_not_found', 'team not found')
    }

    // 3. Check uniqueness if name is changing
    const newName = input.name ?? existing.name
    if (input.name && input.name !== existing.name) {
      // 4. Validate only the changed field using domain rules directly
      const nameResult = validateTeamName(input.name)
      if (nameResult.isErr()) {
        throw nameResult.error
      }

      if (
        await deps.teamRepo.nameExistsInProperty(
          ctx.organizationId,
          existing.propertyId,
          newName,
          tid,
        )
      ) {
        throw teamError(
          'name_taken',
          'a team with this name already exists in this property',
        )
      }
    }

    // Resolve final field values (fall through to existing when not provided)
    const updatedDescription =
      input.description !== undefined ? input.description : existing.description
    const updatedTeamLeadId =
      input.teamLeadId !== undefined
        ? (input.teamLeadId as Team['teamLeadId'])
        : existing.teamLeadId

    const now = deps.clock()
    const updated: Team = {
      ...existing,
      name: newName,
      description: updatedDescription,
      teamLeadId: updatedTeamLeadId,
      updatedAt: now,
    }

    // 5. Persist
    await deps.teamRepo.update(ctx.organizationId, tid, {
      name: updated.name,
      description: updated.description,
      teamLeadId: updated.teamLeadId,
      updatedAt: now,
    })

    // 6. Emit event
    deps.events.emit(
      teamUpdated({
        teamId: updated.id,
        organizationId: updated.organizationId,
        propertyId: updated.propertyId,
        name: updated.name,
        occurredAt: now,
      }),
    )

    // 7. Return
    return updated
  }

export type UpdateTeam = ReturnType<typeof updateTeam>
