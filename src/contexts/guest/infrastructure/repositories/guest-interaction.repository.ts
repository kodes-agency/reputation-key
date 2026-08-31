import { and, eq, desc, gte, inArray, lte, sql } from 'drizzle-orm'
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
import { escapeLikePattern } from '#/shared/db/like-pattern'
import { trace } from '#/shared/observability/trace'
import { unbrand } from '#/shared/domain/ids'
import type { FeedbackId, OrganizationId, RatingId } from '#/shared/domain/ids'
import type { LoggerPort } from '#/shared/domain/logger.port'

export const createGuestInteractionRepository = (
  db: Database,
  runtime: Readonly<{
    logger: Pick<LoggerPort, 'child'>
    monotonicNow: () => number
  }>,
): GuestInteractionRepository => {
  const log = runtime.logger.child({ component: 'guest-interaction-repo' })

  return {
    recordScan: async (scan) => {
      return trace('guestInteraction.recordScan', async () => {
        const start = runtime.monotonicNow()
        log.debug('guest recordScan start')
        await db.insert(scanEvents).values(scanEventToRow(scan))
        log.debug(
          { duration: runtime.monotonicNow() - start },
          'guest recordScan complete',
        )
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

    getLatestScanBySession: async (organizationId, sessionId) => {
      return trace('guestInteraction.getLatestScanBySession', async () => {
        const start = runtime.monotonicNow()
        log.debug('guest getLatestScanBySession start')
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
          { found: !!row, duration: runtime.monotonicNow() - start },
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
            and(
              eq(feedback.id, unbrand(id)),
              eq(feedback.organizationId, unbrand(orgId)),
            ),
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

    findFeedbackSnippetsByIds: async (ids, orgId) => {
      if (ids.length === 0) return []
      return trace('guestInteraction.findFeedbackSnippetsByIds', async () => {
        const rows = await db
          .select({
            id: feedback.id,
            comment: feedback.comment,
            ratingValue: ratings.value,
          })
          .from(feedback)
          .leftJoin(
            ratings,
            and(
              eq(ratings.organizationId, feedback.organizationId),
              eq(ratings.id, feedback.ratingId),
            ),
          )
          .where(
            and(
              eq(feedback.organizationId, unbrand(orgId)),
              inArray(
                feedback.id,
                ids.map((id) => unbrand(id)),
              ),
            ),
          )
        return rows.map((row) => ({
          id: row.id as FeedbackId,
          comment: row.comment,
          ratingValue: row.ratingValue,
        }))
      })
    },

    findEligibleFeedbackIds: async (orgId, filter) => {
      return trace('guestInteraction.findEligibleFeedbackIds', async () => {
        const conditions = [eq(feedback.organizationId, unbrand(orgId))]
        if (filter.ratingMin !== undefined)
          conditions.push(gte(ratings.value, filter.ratingMin))
        if (filter.ratingMax !== undefined)
          conditions.push(lte(ratings.value, filter.ratingMax))
        if (filter.textQuery) {
          const escaped = escapeLikePattern(filter.textQuery)
          conditions.push(sql`${feedback.comment} ilike ${'%' + escaped + '%'}`)
        }
        const rows = await db
          .select({ id: feedback.id })
          .from(feedback)
          .leftJoin(
            ratings,
            and(
              eq(ratings.organizationId, feedback.organizationId),
              eq(ratings.id, feedback.ratingId),
            ),
          )
          .where(and(...conditions))
        return rows.map((row) => row.id as FeedbackId)
      })
    },
  }
}
