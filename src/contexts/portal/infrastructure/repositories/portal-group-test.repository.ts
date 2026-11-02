import { and, eq, isNull, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { baseWhere } from '#/shared/db/base-where'
import { portalGroups, portals } from '#/shared/db/schema/portal.schema'
import { portalGroupMemberships } from '#/shared/db/schema/people-access.schema'
import {
  unbrand,
  propertyId,
  type OrganizationId,
  type PortalGroupId,
  type PortalId,
} from '#/shared/domain/ids'
import { trace } from '#/shared/observability/trace'
import { portalError } from '../../domain/errors'
import { beginMembership } from '../portal-group-writes'
import { createPortalGroupRepository } from './portal-group.repository'

/** Fixture membership writes still exercise the production staff-target fence. */
export const createPortalGroupTestRepository = (db: Database) => ({
  ...createPortalGroupRepository(db),
  seedMembership: async (
    orgId: OrganizationId,
    groupId: PortalGroupId,
    pid: PortalId,
    at: Date,
    createdBy: string,
  ) => {
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
        await beginMembership(tx, {
          organizationId: orgId,
          propertyId: propertyId(ownership.groupPropertyId),
          portalId: pid,
          portalGroupId: groupId,
          at,
          createdBy,
        })
      })
    })
  },
})
