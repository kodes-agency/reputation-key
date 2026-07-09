import { and, eq, desc, gte } from 'drizzle-orm'
import { guestError } from '../../domain/errors'
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
    if (!rating.organizationId)
      throw guestError('forbidden', 'organizationId is required')
    return trace('guestInteraction.insertRating', async () => {
      try {
        await db.insert(ratings).values(ratingToRow(rating))
      } catch (err) {
        const isPg23505 =
          err instanceof Error &&
          'code' in err &&
          (err as { code: string }).code === '23505'
        if (isPg23505) {
          throw guestError('duplicate_rating', 'You have already rated this portal')
        }
        throw err
      }
    })
  },
  insertFeedback: async (fb) => {
    if (!fb.organizationId) throw guestError('forbidden', 'organizationId is required')
    return trace('guestInteraction.insertFeedback', async () => {
      try {
        await db.insert(feedback).values(feedbackToRow(fb))
      } catch (err) {
        const isPg23505 =
          err instanceof Error &&
          'code' in err &&
          (err as { code: string }).code === '23505'
        if (isPg23505) {
          throw guestError(
            'duplicate_feedback',
            'You have already submitted feedback for this portal',
          )
        }
        throw err
      }
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

  hasRatedByIpWithin: async (organizationId, ipHash, portalId, withinSeconds) => {
    return trace('guestInteraction.hasRatedByIpWithin', async () => {
      const since = new Date(Date.now() - withinSeconds * 1000)
      const rows = await db
        .select({ id: ratings.id })
        .from(ratings)
        .where(
          and(
            eq(ratings.organizationId, unbrand(organizationId)),
            eq(ratings.ipHash, ipHash),
            eq(ratings.portalId, unbrand(portalId)),
            gte(ratings.createdAt, since),
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
