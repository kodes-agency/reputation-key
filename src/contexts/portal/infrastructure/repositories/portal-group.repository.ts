// Portal context — Drizzle PortalGroup repository
import { and, eq, ne } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { baseWhere } from '#/shared/db/base-where'
import { portalGroups } from '#/shared/db/schema/portal-group.schema'
import type { PortalGroupRepository } from '../../application/ports/portal-group.repository'
import { portalGroupFromRow } from '../mappers/portal-group.mapper'
import { unbrand } from '#/shared/domain/ids'
import { trace } from '#/shared/observability/trace'

export const createPortalGroupRepository = (db: Database): PortalGroupRepository => ({
  findById: async (orgId, id) => {
    return trace('portalGroup.findById', async () => {
      const rows = await db
        .select()
        .from(portalGroups)
        .where(and(...baseWhere(portalGroups, orgId), eq(portalGroups.id, unbrand(id))))
        .limit(1)
      return rows[0] ? portalGroupFromRow(rows[0]) : null
    })
  },

  listByProperty: async (orgId, propertyId) => {
    return trace('portalGroup.listByProperty', async () => {
      const rows = await db
        .select()
        .from(portalGroups)
        .where(
          and(
            ...baseWhere(portalGroups, orgId),
            eq(portalGroups.propertyId, unbrand(propertyId)),
          ),
        )
      return rows.map(portalGroupFromRow)
    })
  },

  findByNameDuplicate: async (orgId, propertyId, name, excludeId) => {
    return trace('portalGroup.findByNameDuplicate', async () => {
      const conditions = [
        ...baseWhere(portalGroups, orgId),
        eq(portalGroups.propertyId, unbrand(propertyId)),
        eq(portalGroups.name, name),
      ]
      if (excludeId) {
        conditions.push(ne(portalGroups.id, unbrand(excludeId)))
      }
      const rows = await db
        .select()
        .from(portalGroups)
        .where(and(...conditions))
        .limit(1)
      return rows[0] ? portalGroupFromRow(rows[0]) : null
    })
  },

  insert: async (group) => {
    return trace('portalGroup.insert', async () => {
      const result = await db
        .insert(portalGroups)
        .values({
          id: unbrand(group.id),
          organizationId: unbrand(group.organizationId),
          propertyId: unbrand(group.propertyId),
          name: group.name,
          createdAt: group.createdAt,
          updatedAt: group.updatedAt,
        })
        .returning()
      if (!result[0]) throw new Error('PortalGroup insert failed')
      return portalGroupFromRow(result[0])
    })
  },

  update: async (group) => {
    return trace('portalGroup.update', async () => {
      const result = await db
        .update(portalGroups)
        .set({ name: group.name, updatedAt: group.updatedAt })
        .where(
          and(
            eq(portalGroups.id, unbrand(group.id)),
            eq(portalGroups.organizationId, unbrand(group.organizationId)),
          ),
        )
        .returning()
      if (!result[0]) throw new Error('PortalGroup update failed')
      return portalGroupFromRow(result[0])
    })
  },

  delete: async (orgId, id) => {
    return trace('portalGroup.delete', async () => {
      await db
        .delete(portalGroups)
        .where(and(...baseWhere(portalGroups, orgId), eq(portalGroups.id, unbrand(id))))
    })
  },
})
