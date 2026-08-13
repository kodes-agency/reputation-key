// Team context — soft-delete team use case

import type { TeamRepository } from '../ports/team.repository'
import type { EventBus } from '#/shared/events/event-bus'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { TeamId } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { TeamMembershipRepository } from '../ports/team-membership.repository'
import { canForContext } from '#/shared/domain/permissions'
import { isPropertyAccessibleForPermission } from '#/shared/domain/property-access'
import { teamError } from '../../domain/errors'
import { teamDeleted } from '../../domain/events'
import { emitAndRecord, type OutboxRepository } from '#/shared/outbox'

// ── Input type ────────────────────────────────────────────────────────────

export type SoftDeleteTeamInput = Readonly<{
  teamId: TeamId
}>

export type SoftDeleteTeamDeps = Readonly<{
  teamRepo: TeamRepository
  staffApi: StaffPublicApi
  membershipRepo: TeamMembershipRepository
  events: EventBus
  clock: () => Date
  outboxRepo?: OutboxRepository
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

    // Close active memberships at the archive boundary. Historical intervals
    // remain queryable; team archive never cascades or erases attribution.
    const now = deps.clock()
    await deps.membershipRepo.closeForTeam(
      ctx.organizationId,
      team.id,
      now,
      'team_archived',
    )
    await deps.teamRepo.softDelete(ctx.organizationId, team.id)

    // 5. Emit event
    await emitAndRecord(
      deps.events,
      deps.outboxRepo,
      teamDeleted({
        teamId: team.id,
        organizationId: team.organizationId,
        propertyId: team.propertyId,
        occurredAt: now,
      }),
    )
  }

export type SoftDeleteTeam = ReturnType<typeof softDeleteTeam>
