// Portal context — link resolver Drizzle repository implementation
// Implements LinkResolverPort for resolving link details (used by guest context).

import { and, eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  portalApprovedDestinations,
  portalLinks,
  portals,
} from '#/shared/db/schema/portal.schema'
import type { LinkResolverPort } from '../../application/ports/link-resolver.port'
import { organizationId, portalId, propertyId } from '#/shared/domain/ids'
import { trace } from '#/shared/observability/trace'

export const createLinkResolverPort = (db: Database): LinkResolverPort => ({
  // PUBLIC API — no organizationId scoping by design.
  // These resolvers serve unauthenticated guest requests where the
  // link/portal ID acts as a capability token (unguessable UUID).
  resolveLinkById: async (linkId) => {
    return trace('portalLink.resolveLinkById', async () => {
      const result = await db
        .select({
          id: portalLinks.id,
          url: portalLinks.url,
          destinationUri: portalApprovedDestinations.normalizedUri,
          destinationApprovalState: portalApprovedDestinations.approvalState,
          organizationId: portalLinks.organizationId,
          portalId: portalLinks.portalId,
          propertyId: portals.propertyId,
        })
        .from(portalLinks)
        .innerJoin(portals, eq(portalLinks.portalId, portals.id))
        .leftJoin(
          portalApprovedDestinations,
          and(
            eq(portalApprovedDestinations.organizationId, portalLinks.organizationId),
            eq(portalApprovedDestinations.propertyId, portalLinks.propertyId),
            eq(portalApprovedDestinations.id, portalLinks.destinationId),
          ),
        )
        .where(eq(portalLinks.id, linkId))
        .limit(1)

      if (result.length === 0) {
        return null
      }

      const row = result[0]
      const resolvedUrl =
        row.destinationApprovalState === 'approved' ? row.destinationUri : row.url
      if (!resolvedUrl) return null
      return {
        id: row.id,
        url: resolvedUrl,
        organizationId: organizationId(row.organizationId),
        portalId: portalId(row.portalId),
        propertyId: propertyId(row.propertyId),
      }
    })
  },
})
