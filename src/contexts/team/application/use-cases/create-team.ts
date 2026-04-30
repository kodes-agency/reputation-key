// Team context — create team use case
// Full 7-step pattern: authorize → validate refs → check uniqueness → build → persist → emit → return

import type { TeamRepository } from '../ports/team.repository'
import type { PropertyPublicApi } from '#/contexts/property/application/public-api'
import type { EventBus } from '#/shared/events/event-bus'
import type { Team, TeamId } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { CreateTeamInput } from '../dto/create-team.dto'
import { can } from '#/shared/domain/permissions'
import { propertyId as toPropertyId } from '#/shared/domain/ids'
import { buildTeam } from '../../domain/constructors'
import { teamError } from '../../domain/errors'
import { teamCreated } from '../../domain/events'

// fallow-ignore-next-line unused-type
export type CreateTeamDeps = Readonly<{
  teamRepo: TeamRepository
  propertyApi: PropertyPublicApi
  events: EventBus
  idGen: () => TeamId
  clock: () => Date
}>

export const createTeam =
  (deps: CreateTeamDeps) =>
  async (input: CreateTeamInput, ctx: AuthContext): Promise<Team> => {
    // 1. Authorize
    if (!can(ctx.role, 'team.create')) {
      throw teamError('forbidden', 'this role cannot create teams')
    }

    // 2. Validate referenced entity — property must exist in this org
    const pid = toPropertyId(input.propertyId)
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
      teamLeadId: input.teamLeadId as Team['teamLeadId'],
      now: deps.clock(),
    })

    if (teamResult.isErr()) {
      throw teamResult.error
    }

    const team = teamResult.value

    // 5. Persist
    await deps.teamRepo.insert(ctx.organizationId, team)

    // 6. Emit event
    deps.events.emit(
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
