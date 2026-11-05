// Portal context — portal group Drizzle repository implementation
// Per architecture: factory function returning Readonly<{ method }>.
// Every query filters by organization_id AND deleted_at IS NULL via baseWhere().

import { and, asc, desc, eq, gt, inArray, isNull, lte, not, or } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { baseWhere } from '#/shared/db/base-where'
import { portalGroups } from '#/shared/db/schema/portal.schema'
import { portalGroupMemberships } from '#/shared/db/schema/people-access.schema'
import type { PortalGroupRepository } from '../../application/ports/portal-group.repository'
import { portalGroupFromRow } from '../mappers/portal-group.mapper'
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

  listPortalGroupsWithPortals: async (orgId, propertyId) => {
    return trace('portalGroup.listPortalGroupsWithPortals', async () => {
      const groupRows = await db
        .select()
        .from(portalGroups)
        .where(
          and(
            ...baseWhere(portalGroups, orgId),
            eq(portalGroups.propertyId, unbrand(propertyId)),
          ),
        )
        .orderBy(asc(portalGroups.name), asc(portalGroups.id))
      if (groupRows.length === 0) return []
      const memberRows = await db
        .select({
          portalGroupId: portalGroupMemberships.portalGroupId,
          portalId: portalGroupMemberships.portalId,
        })
        .from(portalGroupMemberships)
        .where(
          and(
            eq(portalGroupMemberships.organizationId, unbrand(orgId)),
            eq(portalGroupMemberships.propertyId, unbrand(propertyId)),
            inArray(
              portalGroupMemberships.portalGroupId,
              groupRows.map((row) => row.id),
            ),
            isNull(portalGroupMemberships.effectiveTo),
          ),
        )
        .orderBy(asc(portalGroupMemberships.portalId))
      return groupRows.map((row) => ({
        ...portalGroupFromRow(row),
        portalIds: memberRows
          .filter((member) => member.portalGroupId === row.id)
          .map((member) => portalId(member.portalId)),
      }))
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

  findPortalMembership: async (orgId, pid) => {
    return trace('portalGroup.findPortalMembership', async () => {
      const [row] = await db
        .select({ portalGroupId: portalGroupMemberships.portalGroupId })
        .from(portalGroupMemberships)
        .innerJoin(
          portalGroups,
          and(
            eq(portalGroupMemberships.organizationId, portalGroups.organizationId),
            eq(portalGroupMemberships.propertyId, portalGroups.propertyId),
            eq(portalGroupMemberships.portalGroupId, portalGroups.id),
            isNull(portalGroups.deletedAt),
          ),
        )
        .where(
          and(
            eq(portalGroupMemberships.organizationId, unbrand(orgId)),
            eq(portalGroupMemberships.portalId, unbrand(pid)),
            isNull(portalGroupMemberships.effectiveTo),
          ),
        )
        .limit(1)
      return row ? portalGroupId(row.portalGroupId) : null
    })
  },

  getGroupPortalIds: async (orgId, groupId) => {
    return trace('portalGroup.getGroupPortalIds', async () => {
      const rows = await db
        .select({ portalId: portalGroupMemberships.portalId })
        .from(portalGroupMemberships)
        .innerJoin(
          portalGroups,
          and(
            eq(portalGroupMemberships.organizationId, portalGroups.organizationId),
            eq(portalGroupMemberships.propertyId, portalGroups.propertyId),
            eq(portalGroupMemberships.portalGroupId, portalGroups.id),
            isNull(portalGroups.deletedAt),
          ),
        )
        .where(
          and(
            eq(portalGroupMemberships.organizationId, unbrand(orgId)),
            eq(portalGroupMemberships.portalGroupId, unbrand(groupId)),
            isNull(portalGroupMemberships.effectiveTo),
          ),
        )
      return rows.map((row) => portalId(row.portalId))
    })
  },

  findGroupIdsByPortalIds: async (orgId, portalIds) => {
    if (portalIds.length === 0) return []
    const rows = await db
      .selectDistinct({ portalGroupId: portalGroupMemberships.portalGroupId })
      .from(portalGroupMemberships)
      .innerJoin(
        portalGroups,
        and(
          eq(portalGroupMemberships.organizationId, portalGroups.organizationId),
          eq(portalGroupMemberships.propertyId, portalGroups.propertyId),
          eq(portalGroupMemberships.portalGroupId, portalGroups.id),
          isNull(portalGroups.deletedAt),
        ),
      )
      .where(
        and(
          eq(portalGroupMemberships.organizationId, unbrand(orgId)),
          inArray(
            portalGroupMemberships.portalId,
            portalIds.map((id) => unbrand(id)),
          ),
          isNull(portalGroupMemberships.effectiveTo),
        ),
      )
    return rows.map((row) => portalGroupId(row.portalGroupId))
  },

  findGroupForPortal: async (orgId, pid, asOf) => {
    return trace('portalGroup.findGroupForPortal', async () => {
      const [row] = await db
        .select({ group: portalGroups })
        .from(portalGroups)
        .innerJoin(
          portalGroupMemberships,
          and(
            eq(portalGroupMemberships.organizationId, portalGroups.organizationId),
            eq(portalGroupMemberships.propertyId, portalGroups.propertyId),
            eq(portalGroupMemberships.portalGroupId, portalGroups.id),
            eq(portalGroupMemberships.portalId, unbrand(pid)),
            lte(portalGroupMemberships.effectiveFrom, asOf),
            or(
              isNull(portalGroupMemberships.effectiveTo),
              gt(portalGroupMemberships.effectiveTo, asOf),
            ),
          ),
        )
        .where(
          and(
            eq(portalGroups.organizationId, unbrand(orgId)),
            or(isNull(portalGroups.deletedAt), gt(portalGroups.deletedAt, asOf)),
          ),
        )
        .limit(1)
      return row ? portalGroupFromRow(row.group) : null
    })
  },

  listGroupsForPortals: async (orgId, portalIds, asOf) => {
    return trace('portalGroup.listGroupsForPortals', async () => {
      if (portalIds.length === 0) return []
      // The same interval and archive predicate as findGroupForPortal, for a set
      // of Portals. DISTINCT ON keeps one row per Portal, the newest membership.
      const rows = await db
        .selectDistinctOn([portalGroupMemberships.portalId], {
          portalId: portalGroupMemberships.portalId,
          group: portalGroups,
        })
        .from(portalGroups)
        .innerJoin(
          portalGroupMemberships,
          and(
            eq(portalGroupMemberships.organizationId, portalGroups.organizationId),
            eq(portalGroupMemberships.propertyId, portalGroups.propertyId),
            eq(portalGroupMemberships.portalGroupId, portalGroups.id),
            inArray(
              portalGroupMemberships.portalId,
              portalIds.map((id) => unbrand(id)),
            ),
            lte(portalGroupMemberships.effectiveFrom, asOf),
            or(
              isNull(portalGroupMemberships.effectiveTo),
              gt(portalGroupMemberships.effectiveTo, asOf),
            ),
          ),
        )
        .where(
          and(
            eq(portalGroups.organizationId, unbrand(orgId)),
            or(isNull(portalGroups.deletedAt), gt(portalGroups.deletedAt, asOf)),
          ),
        )
        .orderBy(
          asc(portalGroupMemberships.portalId),
          desc(portalGroupMemberships.effectiveFrom),
        )
      return rows.map((row) => ({
        portalId: portalId(row.portalId),
        group: portalGroupFromRow(row.group),
      }))
    })
  },
})
