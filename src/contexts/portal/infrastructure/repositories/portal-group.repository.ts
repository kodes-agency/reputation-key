// Portal context — portal group Drizzle repository implementation
// Per architecture: factory function returning Readonly<{ method }>.
// Every query filters by organization_id AND deleted_at IS NULL via baseWhere().

import { and, eq, gt, inArray, isNull, lte, not, or, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { baseWhere } from '#/shared/db/base-where'
import { portalGroups, portals } from '#/shared/db/schema/portal.schema'
import { portalGroupMemberships } from '#/shared/db/schema/people-access.schema'
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

  softDelete: async (orgId, id, at) => {
    return trace('portalGroup.softDelete', async () => {
      await db.transaction(async (tx) => {
        const active = await tx
          .select({
            id: portalGroupMemberships.id,
            effectiveFrom: portalGroupMemberships.effectiveFrom,
          })
          .from(portalGroupMemberships)
          .where(
            and(
              eq(portalGroupMemberships.organizationId, unbrand(orgId)),
              eq(portalGroupMemberships.portalGroupId, unbrand(id)),
              isNull(portalGroupMemberships.effectiveTo),
            ),
          )
        const transientIds = active
          .filter((row) => row.effectiveFrom >= at)
          .map((row) => row.id)
        const historicalIds = active
          .filter((row) => row.effectiveFrom < at)
          .map((row) => row.id)
        if (transientIds.length > 0) {
          await tx
            .delete(portalGroupMemberships)
            .where(inArray(portalGroupMemberships.id, transientIds))
        }
        if (historicalIds.length > 0) {
          await tx
            .update(portalGroupMemberships)
            .set({ effectiveTo: at, endReason: 'group_archived' })
            .where(inArray(portalGroupMemberships.id, historicalIds))
        }
        await tx
          .update(portalGroups)
          .set({ deletedAt: at, updatedAt: at })
          .where(and(...baseWhere(portalGroups, orgId), eq(portalGroups.id, unbrand(id))))
      })
    })
  },

  addPortal: async (orgId, groupId, pid, at, createdBy) => {
    return trace('portalGroup.addPortal', async () => {
      await db.transaction(async (tx) => {
        const [ownership] = await tx
          .select({
            groupPropertyId: portalGroups.propertyId,
            portalPropertyId: portals.propertyId,
          })
          .from(portalGroups)
          .innerJoin(
            portals,
            and(
              eq(portals.organizationId, portalGroups.organizationId),
              eq(portals.id, unbrand(pid)),
              isNull(portals.deletedAt),
            ),
          )
          .where(
            and(...baseWhere(portalGroups, orgId), eq(portalGroups.id, unbrand(groupId))),
          )
          .limit(1)
        if (!ownership || ownership.groupPropertyId !== ownership.portalPropertyId) {
          throw portalError(
            'forbidden',
            'portal group membership requires an active same-property parent chain',
          )
        }

        await tx.execute(sql`
          SELECT id FROM portal_group_memberships
          WHERE organization_id = ${unbrand(orgId)}
            AND portal_id = ${unbrand(pid)}
            AND effective_to IS NULL
          FOR UPDATE
        `)
        const [existing] = await tx
          .select({
            id: portalGroupMemberships.id,
            portalGroupId: portalGroupMemberships.portalGroupId,
          })
          .from(portalGroupMemberships)
          .where(
            and(
              eq(portalGroupMemberships.organizationId, unbrand(orgId)),
              eq(portalGroupMemberships.portalId, unbrand(pid)),
              isNull(portalGroupMemberships.effectiveTo),
            ),
          )
          .limit(1)
        if (existing?.portalGroupId === unbrand(groupId)) return
        if (existing) {
          throw portalError('portal_already_grouped', 'portal is already in a group')
        }
        await tx.insert(portalGroupMemberships).values({
          organizationId: unbrand(orgId),
          propertyId: ownership.groupPropertyId,
          portalId: unbrand(pid),
          portalGroupId: unbrand(groupId),
          effectiveFrom: at,
          createdBy,
        })
      })
    })
  },

  removePortal: async (orgId, groupId, pid, at, reason) => {
    return trace('portalGroup.removePortal', async () =>
      db.transaction(async (tx) => {
        await tx.execute(sql`
          SELECT id FROM portal_group_memberships
          WHERE organization_id = ${unbrand(orgId)}
            AND portal_group_id = ${unbrand(groupId)}
            AND portal_id = ${unbrand(pid)}
            AND effective_to IS NULL
          FOR UPDATE
        `)
        const [active] = await tx
          .select()
          .from(portalGroupMemberships)
          .where(
            and(
              eq(portalGroupMemberships.organizationId, unbrand(orgId)),
              eq(portalGroupMemberships.portalGroupId, unbrand(groupId)),
              eq(portalGroupMemberships.portalId, unbrand(pid)),
              isNull(portalGroupMemberships.effectiveTo),
            ),
          )
          .limit(1)
        if (!active) return false
        if (active.effectiveFrom >= at) {
          await tx
            .delete(portalGroupMemberships)
            .where(eq(portalGroupMemberships.id, active.id))
        } else {
          await tx
            .update(portalGroupMemberships)
            .set({ effectiveTo: at, endReason: reason })
            .where(eq(portalGroupMemberships.id, active.id))
        }
        return true
      }),
    )
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
})
