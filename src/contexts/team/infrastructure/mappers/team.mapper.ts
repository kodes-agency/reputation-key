// Team context — row ↔ domain mapper
// Per architecture: pure functions, the only place where both row and domain shapes are known.

import type { teams } from '#/shared/db/schema/team.schema'
import type { Team } from '../../domain/types'
import { teamId, organizationId, propertyId, userId } from '#/shared/domain/ids'

type TeamRow = typeof teams.$inferSelect
type TeamInsertRow = typeof teams.$inferInsert

export const teamFromRow = (row: TeamRow): Team => ({
  id: teamId(row.id),
  organizationId: organizationId(row.organizationId),
  propertyId: propertyId(row.propertyId),
  name: row.name,
  description: row.description,
  teamLeadId: row.teamLeadId != null ? userId(row.teamLeadId) : null,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  deletedAt: row.deletedAt,
})

export const teamToRow = (team: Team): TeamInsertRow => ({
  id: team.id as string,
  organizationId: team.organizationId as string,
  propertyId: team.propertyId as string,
  name: team.name,
  description: team.description,
  teamLeadId: team.teamLeadId as string | null,
  createdAt: team.createdAt,
  updatedAt: team.updatedAt,
  deletedAt: team.deletedAt,
})
