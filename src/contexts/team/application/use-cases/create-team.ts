// Team context — create team use case
// Full 7-step pattern: authorize → validate refs → check uniqueness → build → persist → emit → return

import type { TeamRepository } from '../ports/team.repository'
import type { PropertyPublicApi } from '#/contexts/property/application/public-api'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { EventBus } from '#/shared/events/event-bus'
import type { Team, TeamId } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { CreateTeamInput } from '../dto/create-team.dto'
export type { CreateTeamInput } from '../dto/create-team.dto'
import { canForContext } from '#/shared/domain/permissions'
import { isPropertyAccessibleForPermission } from '#/shared/domain/property-access'
import { propertyId as toPropertyId, userId as toUserId } from '#/shared/domain/ids'
import { buildTeam } from '../../domain/constructors'
import { teamError } from '../../domain/errors'
import { teamCreated } from '../../domain/events'
import { emitAndRecord } from '#/shared/outbox/emit-and-record'
import type { OutboxRepository } from '#/shared/outbox/infrastructure/outbox-repository'

// fallow-ignore-next-line unused-type
export type CreateTeamDeps = Readonly<{
  teamRepo: TeamRepository
  propertyApi: PropertyPublicApi
  staffApi: StaffPublicApi
  events: EventBus
  idGen: () => TeamId
  clock: () => Date
  outboxRepo?: OutboxRepository
}>

export const createTeam =
  (deps: CreateTeamDeps) =>
  async (input: CreateTeamInput, ctx: AuthContext): Promise<Team> => {
    // 1. Authorize
    if (!canForContext(ctx, 'team.create')) {
      throw teamError('forbidden', 'this role cannot create teams')
    }
    // D6-001: PropertyManager/Staff must be assigned to the target property.
    const pid = toPropertyId(input.propertyId)
    const accessible = await isPropertyAccessibleForPermission(
      (orgId, uId, orgWide) =>
        deps.staffApi.getAccessiblePropertyIds(orgId, uId, orgWide),
      ctx,
      'team.create',
      pid,
    )
    if (!accessible) {
      throw teamError('forbidden', 'no access to this property')
    }

    // 2. Validate referenced entity — property must exist in this org
    if (!(await deps.propertyApi.propertyExists(ctx.organizationId, pid))) {
      throw teamError(
        'property_not_found',
        'property does not exist in this organization',
      )
    }

    // 3. Check uniqueness — team name must be unique per property
    if (await deps.teamRepo.nameExistsInProperty(ctx.organizationId, pid, input.name)) {
      throw teamError(
        'name_taken',
        'a team with this name already exists in this property',
      )
    }

    // 4. Build domain object
    const teamResult = buildTeam({
      id: deps.idGen(),
      organizationId: ctx.organizationId,
      propertyId: pid,
      name: input.name,
      description: input.description,
      teamLeadId: input.teamLeadId ? toUserId(input.teamLeadId) : null,
      now: deps.clock(),
    })

    if (teamResult.isErr()) {
      throw teamResult.error
    }

    const team = teamResult.value

    // 5. Persist
    await deps.teamRepo.insert(ctx.organizationId, team)

    // 6. Emit event
    await emitAndRecord(
      deps.events,
      deps.outboxRepo,
      teamCreated({
        teamId: team.id,
        organizationId: team.organizationId,
        propertyId: team.propertyId,
        name: team.name,
        occurredAt: team.createdAt,
      }),
    )

    // 7. Return
    return team
  }

// fallow-ignore-next-line unused-type
export type CreateTeam = ReturnType<typeof createTeam>
