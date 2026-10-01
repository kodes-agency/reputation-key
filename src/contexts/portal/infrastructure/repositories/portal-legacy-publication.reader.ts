// Portal context — the live Portals still on a v1 or v2 page.
//
// Selection is by the OPEN activation's snapshot, never by the Portal's newest
// snapshot or its history: a Portal serves exactly one version at a time, and
// only a Published, undeleted Portal has one. A draft, disabled, archived or
// deleted Portal is not in the join however old its last snapshot is.

import { and, asc, eq, gt, inArray, isNull, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { portals } from '#/shared/db/schema/portal.schema'
import {
  portalPublicationActivations,
  portalPublicationSnapshots,
} from '#/shared/db/schema/portal-publication.schema'
import { organizationId, portalId, propertyId, unbrand } from '#/shared/domain/ids'
import { trace } from '#/shared/observability/trace'
import type {
  LegacyLivePortal,
  PortalLegacyPublicationReader,
} from '../../application/ports/portal-legacy-publication.reader'

const MAX_PAGE = 500

export function createPortalLegacyPublicationReader(
  db: Database,
): PortalLegacyPublicationReader {
  return {
    listLiveLegacyPortals: (input) =>
      trace('portalLegacyPublication.listLiveLegacyPortals', async () => {
        const storedSchemaVersion = sql<string>`${portalPublicationSnapshots.configuration}->>'schemaVersion'`
        const rows = await db
          .select({
            organizationId: portals.organizationId,
            propertyId: portals.propertyId,
            portalId: portals.id,
            liveVersion: portalPublicationSnapshots.version,
            liveSchemaVersion: storedSchemaVersion,
          })
          .from(portals)
          .innerJoin(
            portalPublicationActivations,
            and(
              eq(portalPublicationActivations.organizationId, portals.organizationId),
              eq(portalPublicationActivations.propertyId, portals.propertyId),
              eq(portalPublicationActivations.portalId, portals.id),
              isNull(portalPublicationActivations.deactivatedAt),
            ),
          )
          .innerJoin(
            portalPublicationSnapshots,
            and(
              eq(
                portalPublicationSnapshots.organizationId,
                portalPublicationActivations.organizationId,
              ),
              eq(
                portalPublicationSnapshots.propertyId,
                portalPublicationActivations.propertyId,
              ),
              eq(
                portalPublicationSnapshots.portalId,
                portalPublicationActivations.portalId,
              ),
              eq(portalPublicationSnapshots.id, portalPublicationActivations.snapshotId),
            ),
          )
          .where(
            and(
              eq(portals.organizationId, unbrand(input.organizationId)),
              eq(portals.publicationState, 'published'),
              isNull(portals.deletedAt),
              input.propertyId === undefined
                ? undefined
                : eq(portals.propertyId, unbrand(input.propertyId)),
              input.afterPortalId === null
                ? undefined
                : gt(portals.id, unbrand(input.afterPortalId)),
              inArray(storedSchemaVersion, ['1', '2']),
            ),
          )
          .orderBy(asc(portals.id))
          .limit(Math.min(MAX_PAGE, Math.max(1, input.limit)))
        return rows.map((row): LegacyLivePortal => ({
          organizationId: organizationId(row.organizationId),
          propertyId: propertyId(row.propertyId),
          portalId: portalId(row.portalId),
          liveVersion: row.liveVersion,
          liveSchemaVersion: row.liveSchemaVersion === '1' ? 1 : 2,
        }))
      }),
  }
}
