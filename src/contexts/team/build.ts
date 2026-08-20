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
import { softDeleteTeam } from './application/use-cases/soft-delete-team'
import { createTeamMembershipRepository } from './infrastructure/repositories/team-membership.repository'
import { createTeamScopeRepository } from './infrastructure/repositories/team-scope.repository'
import {
  addTeamMember,
  clearTeamLead,
  listMyTeam,
  listTeamMemberships,
  removeTeamMember,
  setTeamLead,
} from './application/use-cases/team-memberships'
import { teamId } from '#/shared/domain/ids'
import { randomUUID } from 'crypto'

type TeamContextDeps = Readonly<{
  db: Database
  events: EventBus
  outboxRepo?: import('#/shared/outbox').OutboxRepository
  clock: () => Date
  propertyApi: PropertyPublicApi
  staffApi: StaffPublicApi
}>

export const buildTeamContext = (deps: TeamContextDeps) => {
  const teamRepo = createTeamRepository(deps.db, deps.clock)
  const membershipRepo = createTeamMembershipRepository(deps.db)
  const scopeRepo = createTeamScopeRepository(deps.db)
  const idGen = () => teamId(randomUUID())

  const useCases = {
    resolveTeamContext: scopeRepo.resolveTeam,
    resolveStaffParticipationContext: scopeRepo.resolveParticipation,
    listActiveTeamScopesByUser: scopeRepo.listActiveForUser,
    createTeam: createTeam({
      teamRepo,
      propertyApi: deps.propertyApi,
      staffApi: deps.staffApi,
      events: deps.events,
      idGen,
      clock: deps.clock,
    }),
    updateTeam: updateTeam({
      teamRepo,
      staffApi: deps.staffApi,
      events: deps.events,
      clock: deps.clock,
    }),
    listTeams: listTeams({
      teamRepo,
      staffApi: deps.staffApi,
    }),
    softDeleteTeam: softDeleteTeam({
      teamRepo,
      staffApi: deps.staffApi,
      membershipRepo,
      events: deps.events,
      clock: deps.clock,
    }),
    listTeamMemberships: listTeamMemberships({
      teamRepo,
      membershipRepo,
      staffApi: deps.staffApi,
      clock: deps.clock,
    }),
    addTeamMember: addTeamMember({
      teamRepo,
      membershipRepo,
      staffApi: deps.staffApi,
      clock: deps.clock,
    }),
    removeTeamMember: removeTeamMember({
      teamRepo,
      membershipRepo,
      staffApi: deps.staffApi,
      clock: deps.clock,
    }),
    setTeamLead: setTeamLead({
      teamRepo,
      membershipRepo,
      staffApi: deps.staffApi,
      clock: deps.clock,
    }),
    clearTeamLead: clearTeamLead({
      teamRepo,
      membershipRepo,
      staffApi: deps.staffApi,
      clock: deps.clock,
    }),
    listMyTeam: listMyTeam({
      teamRepo,
      membershipRepo,
      staffApi: deps.staffApi,
      clock: deps.clock,
    }),
  } as const

  return {
    publicApi: {} as const,
    internal: { repos: { teamRepo, membershipRepo } as const, useCases },
  } as const
}
