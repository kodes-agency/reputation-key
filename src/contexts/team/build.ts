// Team context — build function.
// Wires team repo, use cases. No PublicApi surface (team is a leaf context).
// Per ADR-0001: the composition root calls this and passes publicApis from upstream contexts.

import type { PropertyPublicApi } from '#/contexts/property/application/public-api'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { EventBus } from '#/shared/events/event-bus'
import type { Database } from '#/shared/db'
import { createTeamRepository } from './infrastructure/repositories/team.repository'
import { createTeam } from './application/use-cases/create-team'
import { updateTeam } from './application/use-cases/update-team'
import { listTeams } from './application/use-cases/list-teams'
import { getTeam } from './application/use-cases/get-team'
import { softDeleteTeam } from './application/use-cases/soft-delete-team'
import { teamId } from '#/shared/domain/ids'
import { randomUUID } from 'crypto'

type TeamContextDeps = Readonly<{
  db: Database
  events: EventBus
  clock: () => Date
  propertyApi: PropertyPublicApi
  staffApi: StaffPublicApi
}>

export const buildTeamContext = (deps: TeamContextDeps) => {
  const teamRepo = createTeamRepository(deps.db)
  const idGen = () => teamId(randomUUID())

  const useCases = {
    createTeam: createTeam({
      teamRepo,
      propertyApi: deps.propertyApi,
      events: deps.events,
      idGen,
      clock: deps.clock,
    }),
    updateTeam: updateTeam({
      teamRepo,
      events: deps.events,
      clock: deps.clock,
    }),
    listTeams: listTeams({
      teamRepo,
      staffApi: deps.staffApi,
    }),
    getTeam: getTeam({
      teamRepo,
      staffApi: deps.staffApi,
    }),
    softDeleteTeam: softDeleteTeam({
      teamRepo,
      events: deps.events,
      clock: deps.clock,
    }),
  } as const

  return { useCases } as const
}
