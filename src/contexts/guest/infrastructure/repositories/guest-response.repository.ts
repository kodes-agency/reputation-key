import {
  and,
  count,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  sql,
} from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { escapeLikePattern } from '#/shared/db/like-pattern'
import {
  guestResponseExperienceSnapshots,
  guestResponsePrivateFeedback,
  guestResponseSessionBindings,
  guestResponses,
} from '#/shared/db/schema/guest.schema'
import type { GuestResponseRepository } from '../../application/ports/guest-response.repository'
import { guestResponseFromRow } from '../mappers/guest-response.mapper'
import type { Clock } from '#/shared/domain/clock'

export const createGuestResponseRepository = (
  db: Database,
  clock: Clock,
): GuestResponseRepository => {
  return {
    findForSession: async (scope, sessionId, asOf) => {
      const [result] = await db
        .select({
          response: guestResponses,
          binding: guestResponseSessionBindings,
          feedback: guestResponsePrivateFeedback,
          experience: guestResponseExperienceSnapshots,
        })
        .from(guestResponses)
        .innerJoin(
          guestResponseSessionBindings,
          and(
            eq(guestResponseSessionBindings.responseId, guestResponses.id),
            eq(
              guestResponseSessionBindings.organizationId,
              guestResponses.organizationId,
            ),
            eq(guestResponseSessionBindings.sessionId, sessionId),
            gt(guestResponseSessionBindings.expiresAt, asOf),
          ),
        )
        .leftJoin(
          guestResponsePrivateFeedback,
          and(
            eq(guestResponsePrivateFeedback.responseId, guestResponses.id),
            eq(
              guestResponsePrivateFeedback.organizationId,
              guestResponses.organizationId,
            ),
            gt(guestResponsePrivateFeedback.expiresAt, asOf),
          ),
        )
        .leftJoin(
          guestResponseExperienceSnapshots,
          and(
            eq(guestResponseExperienceSnapshots.responseId, guestResponses.id),
            eq(
              guestResponseExperienceSnapshots.organizationId,
              guestResponses.organizationId,
            ),
          ),
        )
        .where(
          and(
            eq(guestResponses.organizationId, scope.organizationId),
            eq(guestResponses.propertyId, scope.propertyId),
            eq(guestResponses.portalId, scope.portalId),
          ),
        )
        .limit(1)
      return result
        ? guestResponseFromRow(
            result.response,
            result.binding,
            result.feedback,
            result.experience,
          )
        : null
    },

    findById: async (scope, responseId) => {
      const asOf = clock()
      const [result] = await db
        .select({
          response: guestResponses,
          feedback: guestResponsePrivateFeedback,
          experience: guestResponseExperienceSnapshots,
        })
        .from(guestResponses)
        .leftJoin(
          guestResponsePrivateFeedback,
          and(
            eq(guestResponsePrivateFeedback.responseId, guestResponses.id),
            eq(
              guestResponsePrivateFeedback.organizationId,
              guestResponses.organizationId,
            ),
            gt(guestResponsePrivateFeedback.expiresAt, asOf),
          ),
        )
        .leftJoin(
          guestResponseExperienceSnapshots,
          and(
            eq(guestResponseExperienceSnapshots.responseId, guestResponses.id),
            eq(
              guestResponseExperienceSnapshots.organizationId,
              guestResponses.organizationId,
            ),
          ),
        )
        .where(
          and(
            eq(guestResponses.organizationId, scope.organizationId),
            eq(guestResponses.propertyId, scope.propertyId),
            eq(guestResponses.portalId, scope.portalId),
            eq(guestResponses.id, responseId),
          ),
        )
        .limit(1)
      return result
        ? guestResponseFromRow(result.response, null, result.feedback, result.experience)
        : null
    },

    // Org-scoped by design (see the port comment): an inbox item knows only its
    // organization and the response id. Selects the two shared fields and
    // nothing else — no session id, no IP hash, no media.
    findSnippetForOrg: async (organizationId, responseId) => {
      const [row] = await db
        .select({
          comment: guestResponsePrivateFeedback.body,
          ratingValue: guestResponses.rating,
          feedbackSubmissionRevision: guestResponses.feedbackSubmissionRevision,
          textConsent: guestResponses.textConsent,
          responseConsent: guestResponses.responseConsent,
          status: guestResponses.status,
        })
        .from(guestResponses)
        .leftJoin(
          guestResponsePrivateFeedback,
          and(
            eq(guestResponsePrivateFeedback.responseId, guestResponses.id),
            eq(
              guestResponsePrivateFeedback.organizationId,
              guestResponses.organizationId,
            ),
            gt(guestResponsePrivateFeedback.expiresAt, clock()),
          ),
        )
        .where(
          and(
            eq(guestResponses.organizationId, organizationId),
            eq(guestResponses.id, responseId),
            isNull(guestResponses.deletedAt),
          ),
        )
        .limit(1)
      if (!row) return null
      // Consent governs what staff may read, exactly as it governs what the
      // metric handlers record: an unconsented field is withheld, not shown.
      return {
        comment: row.textConsent && row.status !== 'moderated' ? row.comment : null,
        ratingValue: row.responseConsent ? row.ratingValue : null,
        feedbackSubmissionRevision: row.feedbackSubmissionRevision,
      }
    },

    findSnippetsForOrg: async (organizationId, responseIds) => {
      if (responseIds.length === 0) return []
      const rows = await db
        .select({
          id: guestResponses.id,
          comment: guestResponsePrivateFeedback.body,
          ratingValue: guestResponses.rating,
          feedbackSubmissionRevision: guestResponses.feedbackSubmissionRevision,
          textConsent: guestResponses.textConsent,
          responseConsent: guestResponses.responseConsent,
          status: guestResponses.status,
        })
        .from(guestResponses)
        .leftJoin(
          guestResponsePrivateFeedback,
          and(
            eq(guestResponsePrivateFeedback.responseId, guestResponses.id),
            eq(
              guestResponsePrivateFeedback.organizationId,
              guestResponses.organizationId,
            ),
            gt(guestResponsePrivateFeedback.expiresAt, clock()),
          ),
        )
        .where(
          and(
            eq(guestResponses.organizationId, organizationId),
            inArray(guestResponses.id, [...responseIds]),
            isNull(guestResponses.deletedAt),
          ),
        )
      return rows.map((row) => ({
        id: row.id,
        comment: row.textConsent && row.status !== 'moderated' ? row.comment : null,
        ratingValue: row.responseConsent ? row.ratingValue : null,
        feedbackSubmissionRevision: row.feedbackSubmissionRevision,
      }))
    },

    findEligibleSnippetIdsForOrg: async (organizationId, filter) => {
      const asOf = clock()
      const conditions = [
        eq(guestResponses.organizationId, organizationId),
        isNull(guestResponses.deletedAt),
      ]
      if (filter.ratingMin !== undefined) {
        conditions.push(
          eq(guestResponses.responseConsent, true),
          gte(guestResponses.rating, filter.ratingMin),
        )
      }
      if (filter.ratingMax !== undefined) {
        conditions.push(
          eq(guestResponses.responseConsent, true),
          lte(guestResponses.rating, filter.ratingMax),
        )
      }
      if (filter.textQuery) {
        const escaped = escapeLikePattern(filter.textQuery)
        conditions.push(
          eq(guestResponses.textConsent, true),
          sql`${guestResponses.status} <> 'moderated'`,
          sql`${guestResponsePrivateFeedback.body} ilike ${'%' + escaped + '%'}`,
        )
      }
      const rows = await db
        .select({ id: guestResponses.id })
        .from(guestResponses)
        .leftJoin(
          guestResponsePrivateFeedback,
          and(
            eq(guestResponsePrivateFeedback.responseId, guestResponses.id),
            eq(
              guestResponsePrivateFeedback.organizationId,
              guestResponses.organizationId,
            ),
            gt(guestResponsePrivateFeedback.expiresAt, asOf),
          ),
        )
        .where(and(...conditions))
      return rows.map((row) => row.id)
    },

    summarizePortalIntegrity: async (scope, startAt, endAt) => {
      const ratingBusinessAt = sql<Date>`COALESCE(
        ${guestResponses.correctedAt}, ${guestResponses.submittedAt}
      )`
      const rows = await db
        .select({
          outcome: guestResponses.integrityOutcome,
          count: count(),
        })
        .from(guestResponses)
        .where(
          and(
            eq(guestResponses.organizationId, scope.organizationId),
            eq(guestResponses.propertyId, scope.propertyId),
            eq(guestResponses.portalId, scope.portalId),
            eq(guestResponses.responseConsent, true),
            isNotNull(guestResponses.rating),
            isNotNull(guestResponses.submittedAt),
            isNull(guestResponses.deletedAt),
            gte(ratingBusinessAt, startAt),
            lt(ratingBusinessAt, endAt),
          ),
        )
        .groupBy(guestResponses.integrityOutcome)
      const summary = {
        accepted: 0,
        filteredAutomatically: 0,
        underReview: 0,
        total: 0,
      }
      for (const row of rows) {
        switch (row.outcome) {
          case 'accepted':
            summary.accepted = row.count
            break
          case 'filtered_automatically':
            summary.filteredAutomatically = row.count
            break
          case 'under_review':
            summary.underReview = row.count
            break
          default:
            throw new Error('Guest response integrity outcome is invalid')
        }
        summary.total += row.count
      }
      return summary
    },

    saveModeration: async (response) => {
      const updatedAt = response.moderatedAt ?? clock()
      const updated = await db
        .update(guestResponses)
        .set({
          status: response.status,
          moderatedAt: response.moderatedAt,
          updatedAt,
        })
        .where(
          and(
            eq(guestResponses.organizationId, response.organizationId),
            eq(guestResponses.propertyId, response.propertyId),
            eq(guestResponses.portalId, response.portalId),
            eq(guestResponses.id, response.id),
            inArray(guestResponses.status, ['submitted', 'corrected', 'moderated']),
            isNull(guestResponses.deletedAt),
          ),
        )
        .returning({ id: guestResponses.id })
      return updated.length > 0
    },
  }
}
