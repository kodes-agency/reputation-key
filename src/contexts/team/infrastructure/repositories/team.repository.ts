// Team context — Drizzle repository implementation
// Per architecture: factory function returning Readonly<{ method }>.
// Every query filters by organization_id AND deleted_at IS NULL via baseWhere().

import { and, eq, not } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { baseWhere } from '#/shared/db/base-where'
import { teams } from '#/shared/db/schema/team.schema'
import type { TeamRepository } from '../../application/ports/team.repository'
import { teamFromRow, teamToRow } from '../mappers/team.mapper'
import { teamError } from '../../domain/errors'

type SetValues = {
  name?: string
  description?: string | null
  teamLeadId?: string | null
  updatedAt?: Date
  deletedAt?: Date | null
}

export const createTeamRepository = (db: Database): TeamRepository => ({
  findById: async (orgId, id) => {
    const rows = await db
      .select()
      .from(teams)
      .where(and(...baseWhere(teams, orgId), eq(teams.id, id as string)))
      .limit(1)
    return rows[0] ? teamFromRow(rows[0]) : null
  },

  listByProperty: async (orgId, propertyId) => {
    const rows = await db
      .select()
      .from(teams)
      .where(and(...baseWhere(teams, orgId), eq(teams.propertyId, propertyId as string)))
    return rows.map(teamFromRow)
  },

  nameExistsInProperty: async (orgId, propertyId, name, excludeId) => {
    const conditions = [
      ...baseWhere(teams, orgId),
      eq(teams.propertyId, propertyId as string),
      eq(teams.name, name),
    ]
    if (excludeId) {
      conditions.push(not(eq(teams.id, excludeId as string)))
    }

    const rows = await db
      .select({ id: teams.id })
      .from(teams)
      .where(and(...conditions))
      .limit(1)
    return rows.length > 0
  },

  insert: async (orgId, team) => {
    if (team.organizationId !== orgId) {
      throw teamError('forbidden', 'Tenant mismatch on team insert')
    }
    await db.insert(teams).values(teamToRow(team))
  },

  update: async (orgId, id, patch) => {
    const setValues: SetValues = {}
    if (patch.updatedAt !== undefined) setValues.updatedAt = patch.updatedAt
    if (patch.name !== undefined) setValues.name = patch.name
    if (patch.description !== undefined) setValues.description = patch.description
    if (patch.teamLeadId !== undefined)
      setValues.teamLeadId = patch.teamLeadId as string | null

    await db
      .update(teams)
      .set(setValues)
      .where(and(...baseWhere(teams, orgId), eq(teams.id, id as string)))
  },

  softDelete: async (orgId, id) => {
    const now = new Date()
    await db
      .update(teams)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(...baseWhere(teams, orgId), eq(teams.id, id as string)))
  },
})
