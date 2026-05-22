import { and, eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { scanEvents, ratings, feedback } from '#/shared/db/schema/guest.schema'
import type { GuestInteractionRepository } from '../../application/ports/guest-interaction.repository'
import { scanEventToRow, ratingToRow, feedbackToRow } from '../mappers/guest.mapper'
import { trace } from '#/shared/observability/trace'
import { unbrand } from '#/shared/domain/ids'

export const createGuestInteractionRepository = (
  db: Database,
): GuestInteractionRepository => ({
  recordScan: async (scan) => {
    return trace('guestInteraction.recordScan', async () => {
      await db.insert(scanEvents).values(scanEventToRow(scan))
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
})
