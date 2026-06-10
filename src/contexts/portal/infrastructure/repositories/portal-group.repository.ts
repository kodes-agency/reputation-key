// Portal context — portal group Drizzle repository implementation
// Per architecture: factory function returning Readonly<{ method }>.
// Every query filters by organization_id AND deleted_at IS NULL via baseWhere().

import { and, eq, not, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { baseWhere } from '#/shared/db/base-where'
import { portalGroups, portalGroupMembers } from '#/shared/db/schema/portal.schema'
import type { PortalGroupRepository } from '../../application/ports/portal-group.repository'
import { portalGroupFromRow, portalGroupToRow } from '../mappers/portal-group.mapper'
import { portalError } from '../../domain/errors'
import { unbrand, portalGroupId, portalId } from '#/shared/domain/ids'
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

  nameExists: async (orgId, propertyId, name, excludeId) => {
    return trace('portalGroup.nameExists', async () => {
      const conditions = [
        ...baseWhere(portalGroups, orgId),
        eq(portalGroups.propertyId, unbrand(propertyId)),
        eq(portalGroups.name, name),
      ]
      if (excludeId) {
        conditions.push(not(eq(portalGroups.id, unbrand(excludeId))))
      }
      const rows = await db
        .select({ id: portalGroups.id })
        .from(portalGroups)
        .where(and(...conditions))
        .limit(1)
      return rows.length > 0
    })
  },

  insert: async (orgId, group) => {
    return trace('portalGroup.insert', async () => {
      if (group.organizationId !== orgId) {
        throw portalError('forbidden', 'Tenant mismatch on portal group insert')
      }
      await db.insert(portalGroups).values(portalGroupToRow(group))
    })
  },

  update: async (orgId, id, patch) => {
    return trace('portalGroup.update', async () => {
      const setValues: Record<string, unknown> = {}
      if (patch.name !== undefined) setValues['name'] = patch.name
      if (patch.sortKey !== undefined) setValues['sortKey'] = patch.sortKey
      if (patch.updatedAt !== undefined) setValues['updatedAt'] = patch.updatedAt

      await db
        .update(portalGroups)
        .set(setValues)
        .where(and(...baseWhere(portalGroups, orgId), eq(portalGroups.id, unbrand(id))))
    })
  },

  softDelete: async (orgId, id) => {
    return trace('portalGroup.softDelete', async () => {
      const now = new Date()
      await db
        .update(portalGroups)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(...baseWhere(portalGroups, orgId), eq(portalGroups.id, unbrand(id))))
    })
  },

  addPortal: async (orgId, groupId, portalId) => {
    return trace('portalGroup.addPortal', async () => {
      await db.transaction(async (tx) => {
        // Clean up any stale membership (e.g., from a soft-deleted group)
        // before inserting. Unique constraint on portalId means only one
        // active membership per portal.
        await tx
          .delete(portalGroupMembers)
          .where(
            and(
              eq(portalGroupMembers.portalId, unbrand(portalId)),
              eq(portalGroupMembers.organizationId, unbrand(orgId)),
            ),
          )
        await tx.insert(portalGroupMembers).values({
          portalGroupId: unbrand(groupId),
          portalId: unbrand(portalId),
          organizationId: unbrand(orgId),
        })
      })
    })
  },

  removePortal: async (orgId, groupId, portalId) => {
    return trace('portalGroup.removePortal', async () => {
      const result = await db
        .delete(portalGroupMembers)
        .where(
          and(
            eq(portalGroupMembers.organizationId, unbrand(orgId)),
            eq(portalGroupMembers.portalGroupId, unbrand(groupId)),
            eq(portalGroupMembers.portalId, unbrand(portalId)),
          ),
        )
        .returning({ id: portalGroupMembers.id })
      return result.length > 0
    })
  },

  findPortalMembership: async (orgId, portalId) => {
    return trace('portalGroup.findPortalMembership', async () => {
      const rows = await db
        .select({ portalGroupId: portalGroupMembers.portalGroupId })
        .from(portalGroupMembers)
        .innerJoin(
          portalGroups,
          and(
            eq(portalGroupMembers.portalGroupId, portalGroups.id),
            sql`${portalGroups.deletedAt} IS NULL`,
          ),
        )
        .where(
          and(
            eq(portalGroupMembers.organizationId, unbrand(orgId)),
            eq(portalGroupMembers.portalId, unbrand(portalId)),
          ),
        )
        .limit(1)
      return rows[0] ? portalGroupId(rows[0].portalGroupId) : null
    })
  },

  getGroupPortalIds: async (orgId, groupId) => {
    return trace('portalGroup.getGroupPortalIds', async () => {
      const rows = await db
        .select({ portalId: portalGroupMembers.portalId })
        .from(portalGroupMembers)
        .innerJoin(
          portalGroups,
          and(
            eq(portalGroupMembers.portalGroupId, portalGroups.id),
            sql`${portalGroups.deletedAt} IS NULL`,
          ),
        )
        .where(
          and(
            eq(portalGroupMembers.organizationId, unbrand(orgId)),
            eq(portalGroupMembers.portalGroupId, unbrand(groupId)),
          ),
        )
      return rows.map((r: { portalId: string }) => portalId(r.portalId))
    })
  },

  findGroupForPortal: async (orgId, portalId) => {
    return trace('portalGroup.findGroupForPortal', async () => {
      const rows = await db
        .select()
        .from(portalGroups)
        .innerJoin(
          portalGroupMembers,
          and(
            eq(portalGroupMembers.portalGroupId, portalGroups.id),
            eq(portalGroupMembers.portalId, unbrand(portalId)),
            eq(portalGroupMembers.organizationId, unbrand(orgId)),
          ),
        )
        .where(and(...baseWhere(portalGroups, orgId)))
        .limit(1)
      return rows[0] ? portalGroupFromRow(rows[0].portal_groups) : null
    })
  },
})
