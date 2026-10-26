import { and, asc, eq, isNull, ne } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  portalApprovedDestinations,
  portalLinks,
  portals,
} from '#/shared/db/schema/portal.schema'
import { portalId, propertyId, unbrand, userId } from '#/shared/domain/ids'
import type { PortalApprovedDestinationState } from '../../domain/approved-destination'
import type {
  FindDestinationApprovalFacts,
  PortalDestinationApprovalPortal,
} from '../../application/portal-destination-approval-facts'
import { trace } from '#/shared/observability/trace'

/** A Property has few Portals; the cap only bounds a runaway row set. */
const MOST_PORTALS_READ = 200

type PortalRow = { id: string; name: string }

const toPortal = (row: PortalRow): PortalDestinationApprovalPortal => ({
  id: portalId(row.id),
  name: row.name,
})

export const createPortalDestinationApprovalFactsReader =
  (db: Database): FindDestinationApprovalFacts =>
  (orgId, destinationId) =>
    trace('portalApprovedDestination.findApprovalNotificationFacts', async () => {
      const [destination] = await db
        .select({
          propertyId: portalApprovedDestinations.propertyId,
          hostname: portalApprovedDestinations.hostname,
          approvalState: portalApprovedDestinations.approvalState,
          requestedBy: portalApprovedDestinations.requestedBy,
        })
        .from(portalApprovedDestinations)
        .where(
          and(
            eq(portalApprovedDestinations.organizationId, unbrand(orgId)),
            eq(portalApprovedDestinations.id, unbrand(destinationId)),
          ),
        )
        .limit(1)
      if (!destination) return null

      // Live: not deleted and not archived, so an admin can open its editor.
      const live = and(
        eq(portals.organizationId, unbrand(orgId)),
        eq(portals.propertyId, destination.propertyId),
        isNull(portals.deletedAt),
        ne(portals.publicationState, 'archived'),
      )
      const usingIt: ReadonlyArray<PortalRow> = await db
        .select({ id: portals.id, name: portals.name })
        .from(portalLinks)
        .innerJoin(
          portals,
          and(
            eq(portals.organizationId, portalLinks.organizationId),
            eq(portals.id, portalLinks.portalId),
          ),
        )
        .where(
          and(
            eq(portalLinks.organizationId, unbrand(orgId)),
            eq(portalLinks.propertyId, destination.propertyId),
            eq(portalLinks.destinationId, unbrand(destinationId)),
            live,
          ),
        )
        .groupBy(portals.id, portals.name, portals.createdAt)
        .orderBy(asc(portals.createdAt), asc(portals.id))
        .limit(MOST_PORTALS_READ)

      const [first, ...others] = usingIt
      const asked: ReadonlyArray<PortalRow> = first
        ? []
        : await db
            .select({ id: portals.id, name: portals.name })
            .from(portals)
            .where(live)
            .orderBy(asc(portals.createdAt), asc(portals.id))
            .limit(1)
      const chosen = first ?? asked[0]

      return {
        propertyId: propertyId(destination.propertyId),
        hostname: destination.hostname,
        approvalState: destination.approvalState as PortalApprovedDestinationState,
        requestedBy: userId(destination.requestedBy),
        portal: chosen ? toPortal(chosen) : null,
        otherPortalCount: others.length,
      }
    })
