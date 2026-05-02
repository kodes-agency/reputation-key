import { and, eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { scanEvents, ratings, feedback } from '#/shared/db/schema/guest.schema'
import type { GuestInteractionRepository } from '../../application/ports/guest-interaction.repository'
import { scanEventToRow, ratingToRow, feedbackToRow } from '../mappers/guest.mapper'

export const createGuestInteractionRepository = (
  db: Database,
): GuestInteractionRepository => ({
  recordScan: async (scan) => {
    await db.insert(scanEvents).values(scanEventToRow(scan))
  },

  insertRating: async (rating) => {
    await db.insert(ratings).values(ratingToRow(rating))
  },

  insertFeedback: async (fb) => {
    await db.insert(feedback).values(feedbackToRow(fb))
  },

  hasRated: async (organizationId, sessionId, portalId) => {
    const rows = await db
      .select({ id: ratings.id })
      .from(ratings)
      .where(
        and(
          eq(ratings.organizationId, organizationId as unknown as string),
          eq(ratings.sessionId, sessionId),
          eq(ratings.portalId, portalId as unknown as string),
        ),
      )
      .limit(1)
    return rows.length > 0
  },
})
