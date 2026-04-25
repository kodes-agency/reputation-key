// Team context — row ↔ domain mapper
// Per architecture: pure functions, the only place where both row and domain shapes are known.

import type { teams } from '#/shared/db/schema/team.schema'
import type { Team } from '../../domain/types'
import type { TeamId, OrganizationId, PropertyId, UserId } from '#/shared/domain/ids'

type TeamRow = typeof teams.$inferSelect
type TeamInsertRow = typeof teams.$inferInsert

export const teamFromRow = (row: TeamRow): Team => ({
  id: row.id as TeamId,
  organizationId: row.organizationId as OrganizationId,
  propertyId: row.propertyId as PropertyId,
  name: row.name,
  description: row.description,
  teamLeadId: row.teamLeadId as UserId | null,
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
