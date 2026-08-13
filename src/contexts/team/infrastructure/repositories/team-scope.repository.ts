import { and, eq, isNull } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  staffParticipations,
  teamMemberships,
} from '#/shared/db/schema/people-access.schema'
import { teams } from '#/shared/db/schema/team.schema'
import type { TeamId } from '../../domain/types'
import { unbrand } from '#/shared/domain/ids'

export type TeamManagementScope = Readonly<{
  organizationId: string
  propertyId: string
  teamId: string
}>

export type ActiveTeamManagementScope = TeamManagementScope &
  Readonly<{ role: 'member' | 'lead' }>

export const createTeamScopeRepository = (db: Database) => ({
  resolveTeam: async (id: TeamId): Promise<TeamManagementScope | null> => {
    const [scope] = await db
      .select({
        organizationId: teams.organizationId,
        propertyId: teams.propertyId,
        teamId: teams.id,
      })
      .from(teams)
      .where(and(eq(teams.id, unbrand(id)), isNull(teams.deletedAt)))
      .limit(1)
    return scope ?? null
  },

  resolveParticipation: async (
    staffParticipationId: string,
  ): Promise<Readonly<{ organizationId: string; propertyId: string }> | null> => {
    const [scope] = await db
      .select({
        organizationId: staffParticipations.organizationId,
        propertyId: staffParticipations.propertyId,
      })
      .from(staffParticipations)
      .where(eq(staffParticipations.id, staffParticipationId))
      .limit(1)
    return scope ?? null
  },

  listActiveForUser: async (
    organizationId: string,
    userId: string,
  ): Promise<readonly ActiveTeamManagementScope[]> =>
    db
      .select({
        organizationId: teamMemberships.organizationId,
        propertyId: teamMemberships.propertyId,
        teamId: teamMemberships.teamId,
        role: teamMemberships.role,
      })
      .from(teamMemberships)
      .innerJoin(
        staffParticipations,
        and(
          eq(staffParticipations.organizationId, teamMemberships.organizationId),
          eq(staffParticipations.propertyId, teamMemberships.propertyId),
          eq(staffParticipations.id, teamMemberships.staffParticipationId),
        ),
      )
      .innerJoin(
        teams,
        and(
          eq(teams.organizationId, teamMemberships.organizationId),
          eq(teams.propertyId, teamMemberships.propertyId),
          eq(teams.id, teamMemberships.teamId),
          isNull(teams.deletedAt),
        ),
      )
      .where(
        and(
          eq(teamMemberships.organizationId, organizationId),
          eq(staffParticipations.userId, userId),
          eq(staffParticipations.status, 'active'),
          isNull(teamMemberships.effectiveTo),
        ),
      ),
})
