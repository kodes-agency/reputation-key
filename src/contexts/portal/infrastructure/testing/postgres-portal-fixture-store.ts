// Test-only Portal state seeding/mutation. Production code must use
// PortalCommandStore for every authoritative mutation and durable fact.

import { and, eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { portalResponsibleManagers, portals } from '#/shared/db/schema/portal.schema'
import type { Portal } from '../../domain/types'
import { portalToRow } from '../mappers/portal.mapper'
import {
  unbrand,
  type OrganizationId,
  type PortalId,
  type UserId,
} from '#/shared/domain/ids'

export function createPostgresPortalFixtureStore(db: Database) {
  return {
    insert: async (
      organizationId: OrganizationId,
      portal: Portal,
      initialResponsibleManagerId: UserId | null = null,
    ): Promise<void> => {
      await db.insert(portals).values(portalToRow(portal))
      if (initialResponsibleManagerId) {
        await db.insert(portalResponsibleManagers).values({
          organizationId: unbrand(organizationId),
          propertyId: unbrand(portal.propertyId),
          portalId: unbrand(portal.id),
          userId: unbrand(initialResponsibleManagerId),
          effectiveFrom: portal.createdAt,
          createdBy: unbrand(initialResponsibleManagerId),
        })
      }
    },
    update: async (
      organizationId: OrganizationId,
      portalId: PortalId,
      patch: Readonly<Partial<Portal>>,
    ): Promise<void> => {
      await db
        .update(portals)
        .set(patch)
        .where(
          and(
            eq(portals.organizationId, unbrand(organizationId)),
            eq(portals.id, unbrand(portalId)),
          ),
        )
    },
    softDelete: async (
      organizationId: OrganizationId,
      portalId: PortalId,
      at = new Date(),
    ): Promise<void> => {
      await db
        .update(portals)
        .set({ deletedAt: at, updatedAt: at })
        .where(
          and(
            eq(portals.organizationId, unbrand(organizationId)),
            eq(portals.id, unbrand(portalId)),
          ),
        )
    },
  } as const
}
