import { and, eq, desc } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { scanEvents, ratings, feedback } from '#/shared/db/schema/guest.schema'
import type { GuestInteractionRepository } from '../../application/ports/guest-interaction.repository'
import {
  scanEventToRow,
  ratingToRow,
  feedbackToRow,
  scanEventFromRow,
  feedbackFromRow,
  ratingFromRow,
} from '../mappers/guest.mapper'
import { trace } from '#/shared/observability/trace'
import { getLogger } from '#/shared/observability/logger'
import { unbrand } from '#/shared/domain/ids'
import type { FeedbackId, OrganizationId, RatingId } from '#/shared/domain/ids'

const log = getLogger().child({ component: 'guest-interaction-repo' })

export const createGuestInteractionRepository = (
  db: Database,
): GuestInteractionRepository => ({
  recordScan: async (scan) => {
    return trace('guestInteraction.recordScan', async () => {
      const start = Date.now()
      log.debug(
        { organizationId: scan.organizationId as string },
        'guest recordScan start',
      )
      await db.insert(scanEvents).values(scanEventToRow(scan))
      log.debug({ duration: Date.now() - start }, 'guest recordScan complete')
    })
  },

  insertRating: async (rating) => {
    return trace('guestInteraction.insertRating', async () => {
      await db.insert(ratings).values(ratingToRow(rating))
    })
  },

  insertFeedback: async (fb) => {
    return trace('guestInteraction.insertFeedback', async () => {
      await db.insert(feedback).values(feedbackToRow(fb))
    })
  },

  hasRated: async (organizationId, sessionId, portalId) => {
    return trace('guestInteraction.hasRated', async () => {
      const rows = await db
        .select({ id: ratings.id })
        .from(ratings)
        .where(
          and(
            eq(ratings.organizationId, unbrand(organizationId)),
            eq(ratings.sessionId, sessionId),
            eq(ratings.portalId, unbrand(portalId)),
          ),
        )
        .limit(1)
      return rows.length > 0
    })
  },

  getLatestScanBySession: async (organizationId, sessionId) => {
    return trace('guestInteraction.getLatestScanBySession', async () => {
      const start = Date.now()
      log.debug({ sessionId }, 'guest getLatestScanBySession start')
      const [row] = await db
        .select()
        .from(scanEvents)
        .where(
          and(
            eq(scanEvents.organizationId, unbrand(organizationId)),
            eq(scanEvents.sessionId, sessionId),
          ),
        )
        .orderBy(desc(scanEvents.createdAt))
        .limit(1)
      log.debug(
        { sessionId, found: !!row, duration: Date.now() - start },
        'guest getLatestScanBySession complete',
      )
      return row ? scanEventFromRow(row) : null
    })
  },

  findFeedbackById: async (id: FeedbackId, orgId: OrganizationId) => {
    return trace('guestInteraction.findFeedbackById', async () => {
      const [row] = await db
        .select()
        .from(feedback)
        .where(
          and(eq(feedback.id, unbrand(id)), eq(feedback.organizationId, unbrand(orgId))),
        )
        .limit(1)
      return row ? feedbackFromRow(row) : null
    })
  },

  findRatingById: async (id: RatingId, orgId: OrganizationId) => {
    return trace('guestInteraction.findRatingById', async () => {
      const [row] = await db
        .select()
        .from(ratings)
        .where(
          and(eq(ratings.id, unbrand(id)), eq(ratings.organizationId, unbrand(orgId))),
        )
        .limit(1)
      return row ? ratingFromRow(row) : null
    })
  },
})
