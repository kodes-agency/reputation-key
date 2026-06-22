// Team context — update team use case
// Per patterns.md section 27: field-level validation for partial updates.
// Only validates fields that are changing, using domain rules directly.

import type { TeamRepository } from '../ports/team.repository'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { EventBus } from '#/shared/events/event-bus'
import type { Team } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { UpdateTeamInput } from '../dto/update-team.dto'
export type { UpdateTeamInput } from '../dto/update-team.dto'
import { can } from '#/shared/domain/permissions'
import { isPropertyAccessible } from '#/shared/domain/property-access'
import { teamId as toTeamId, userId as toUserId } from '#/shared/domain/ids'
import { validateTeamName } from '../../domain/rules'
import { teamError } from '../../domain/errors'
import { teamUpdated } from '../../domain/events'

// fallow-ignore-next-line unused-type
export type UpdateTeamDeps = Readonly<{
  teamRepo: TeamRepository
  staffApi: StaffPublicApi
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

    // D6-001: PropertyManager/Staff must be assigned to the team's property.
    const accessible = await isPropertyAccessible(
      (orgId, uId, role) => deps.staffApi.getAccessiblePropertyIds(orgId, uId, role),
      ctx.organizationId,
      ctx.userId,
      ctx.role,
      existing.propertyId,
    )
    if (!accessible) {
      throw teamError('forbidden', 'no access to this property')
    }

    // 3. Check uniqueness if name is changing
    let newName = input.name ?? existing.name
    if (input.name && input.name !== existing.name) {
      // 4. Validate only the changed field using domain rules directly
      const nameResult = validateTeamName(input.name)
      if (nameResult.isErr()) {
        throw nameResult.error
      }
      newName = nameResult.value

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
      input.teamLeadId !== undefined && input.teamLeadId !== null
        ? toUserId(input.teamLeadId)
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
    await deps.events.emit(
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

// fallow-ignore-next-line unused-type
export type UpdateTeam = ReturnType<typeof updateTeam>
