// Team context — soft-delete team use case

import type { TeamRepository } from '../ports/team.repository'
import type { AssignmentCheckPort } from '../ports/assignment-check.port'
import type { EventBus } from '#/shared/events/event-bus'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { TeamId } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { canForContext } from '#/shared/domain/permissions'
import { isPropertyAccessibleForPermission } from '#/shared/domain/property-access'
import { teamError } from '../../domain/errors'
import { teamDeleted } from '../../domain/events'

// ── Input type ────────────────────────────────────────────────────────────

export type SoftDeleteTeamInput = Readonly<{
  teamId: TeamId
}>

// fallow-ignore-next-line unused-type
export type SoftDeleteTeamDeps = Readonly<{
  teamRepo: TeamRepository
  staffApi: StaffPublicApi
  assignmentCheck: AssignmentCheckPort
  events: EventBus
  clock: () => Date
}>

export const softDeleteTeam =
  (deps: SoftDeleteTeamDeps) =>
  async (input: SoftDeleteTeamInput, ctx: AuthContext): Promise<void> => {
    // 1. Authorize
    if (!canForContext(ctx, 'team.delete')) {
      throw teamError('forbidden', 'this role cannot delete teams')
    }

    // 2. Validate entity exists
    const team = await deps.teamRepo.findById(ctx.organizationId, input.teamId)
    if (!team) {
      throw teamError('team_not_found', 'team not found')
    }

    // D6-001: PropertyManager/Staff must be assigned to the team's property.
    const accessible = await isPropertyAccessibleForPermission(
      (orgId, uId, orgWide) =>
        deps.staffApi.getAccessiblePropertyIds(orgId, uId, orgWide),
      ctx,
      'team.delete',
      team.propertyId,
    )
    if (!accessible) {
      throw teamError('forbidden', 'no access to this property')
    }

    // 3. Check for active assignments — prevent deletion if team has members
    // F139: Guard against deleting a team with active staff assignments.
    const assignmentCount = await deps.assignmentCheck.countByTeam(
      ctx.organizationId,
      team.id,
    )
    if (assignmentCount > 0) {
      throw teamError(
        'team_has_assignments',
        `Cannot delete team with ${assignmentCount} active assignment(s). Remove or reassign staff first.`,
      )
    }

    // 4. Persist
    await deps.teamRepo.softDelete(ctx.organizationId, team.id)

    // 5. Emit event
    await deps.events.emit(
      teamDeleted({
        teamId: team.id,
        organizationId: team.organizationId,
        propertyId: team.propertyId,
        occurredAt: deps.clock(),
      }),
    )
  }

// fallow-ignore-next-line unused-type
export type SoftDeleteTeam = ReturnType<typeof softDeleteTeam>
