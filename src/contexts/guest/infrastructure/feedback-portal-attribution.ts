import { and, eq, isNull } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  feedback as legacyFeedback,
  guestResponses,
} from '#/shared/db/schema/guest.schema'
import {
  portalId,
  unbrand,
  type FeedbackId,
  type OrganizationId,
  type PortalId,
} from '#/shared/domain/ids'

export type FeedbackPortalAttributionLookup = (
  organizationId: OrganizationId,
  feedbackId: FeedbackId,
) => Promise<PortalId | null>

/**
 * Guest-owned, content-free attribution for Inbox notification routing.
 * Canonical responses win; legacy feedback remains readable during cutover.
 */
export const createFeedbackPortalAttributionLookup =
  (db: Database): FeedbackPortalAttributionLookup =>
  async (organizationId, sourceId) => {
    const canonical = await db
      .select({ portalId: guestResponses.portalId })
      .from(guestResponses)
      .where(
        and(
          eq(guestResponses.organizationId, unbrand(organizationId)),
          eq(guestResponses.id, unbrand(sourceId)),
          isNull(guestResponses.deletedAt),
        ),
      )
      .limit(1)
    if (canonical[0]) return portalId(canonical[0].portalId)

    const legacy = await db
      .select({ portalId: legacyFeedback.portalId })
      .from(legacyFeedback)
      .where(
        and(
          eq(legacyFeedback.organizationId, unbrand(organizationId)),
          eq(legacyFeedback.id, unbrand(sourceId)),
        ),
      )
      .limit(1)
    return legacy[0] ? portalId(legacy[0].portalId) : null
  }
