import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { ratings, feedback } from '#/shared/db/schema/guest.schema'
import type { GuestInteractionRepository } from '../../application/ports/guest-interaction.repository'
import { escapeLikePattern } from '#/shared/db/like-pattern'
import { trace } from '#/shared/observability/trace'
import { unbrand } from '#/shared/domain/ids'
import type { FeedbackId } from '#/shared/domain/ids'

export const createGuestInteractionRepository = (
  db: Database,
): GuestInteractionRepository => ({
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
})
