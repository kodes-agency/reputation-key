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
  guestResponseMedia,
  guestResponsePrivateFeedback,
  guestResponseSessionBindings,
  guestResponses,
} from '#/shared/db/schema/guest.schema'
import type { GuestResponseRepository } from '../../application/ports/guest-response.repository'
import type {
  GuestMedia,
  GuestMediaContentType,
  GuestMediaStatus,
} from '../../domain/guest-media'
import { guestResponseFromRow } from '../mappers/guest-response.mapper'
import type { Clock } from '#/shared/domain/clock'

type MediaRow = typeof guestResponseMedia.$inferSelect

function mediaFromRow(row: MediaRow): GuestMedia {
  return {
    id: row.id,
    organizationId: row.organizationId,
    propertyId: row.propertyId,
    portalId: row.portalId,
    responseId: row.responseId,
    sessionId: row.sessionId,
    objectKey: row.objectKey,
    contentType: row.contentType as GuestMediaContentType,
    declaredSizeBytes: row.declaredSizeBytes,
    status: row.status as GuestMediaStatus,
    expiresAt: row.expiresAt,
    confirmedAt: row.confirmedAt,
    processingLease: row.processingLease,
    processingStartedAt: row.processingStartedAt,
    publicUrl: row.publicUrl,
    readyAt: row.readyAt,
    deletedAt: row.deletedAt,
  }
}

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

    saveModeration: async (response) =>
      db.transaction(async (tx) => {
        const updatedAt = response.moderatedAt ?? clock()
        const updated = await tx
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
        if (updated.length === 0) return false
        await tx
          .update(guestResponseMedia)
          .set({
            status: 'quarantined',
            processingLease: null,
            publicUrl: null,
            readyAt: null,
            updatedAt,
          })
          .where(
            and(
              eq(guestResponseMedia.organizationId, response.organizationId),
              eq(guestResponseMedia.propertyId, response.propertyId),
              eq(guestResponseMedia.portalId, response.portalId),
              eq(guestResponseMedia.responseId, response.id),
              inArray(guestResponseMedia.status, ['issued', 'processing', 'ready']),
            ),
          )
        return true
      }),

    insertMedia: async (media) => {
      const inserted = await db
        .insert(guestResponseMedia)
        .values({
          id: media.id,
          organizationId: media.organizationId,
          propertyId: media.propertyId,
          portalId: media.portalId,
          responseId: media.responseId,
          sessionId: media.sessionId,
          objectKey: media.objectKey,
          contentType: media.contentType,
          declaredSizeBytes: media.declaredSizeBytes,
          status: media.status,
          expiresAt: media.expiresAt,
        })
        .onConflictDoNothing()
        .returning({ id: guestResponseMedia.id })
      return inserted.length === 1
    },

    findMediaForSession: async (scope, sessionId, mediaId) => {
      const [row] = await db
        .select({ media: guestResponseMedia })
        .from(guestResponseMedia)
        .innerJoin(
          guestResponseSessionBindings,
          and(
            eq(guestResponseSessionBindings.responseId, guestResponseMedia.responseId),
            eq(
              guestResponseSessionBindings.organizationId,
              guestResponseMedia.organizationId,
            ),
            eq(guestResponseSessionBindings.sessionId, sessionId),
            gt(guestResponseSessionBindings.expiresAt, clock()),
          ),
        )
        .where(
          and(
            eq(guestResponseMedia.organizationId, scope.organizationId),
            eq(guestResponseMedia.propertyId, scope.propertyId),
            eq(guestResponseMedia.portalId, scope.portalId),
            eq(guestResponseMedia.sessionId, sessionId),
            eq(guestResponseMedia.id, mediaId),
          ),
        )
        .limit(1)
      return row ? mediaFromRow(row.media) : null
    },

    claimMedia: async (media, lease, now) =>
      db.transaction(async (tx) => {
        const [response] = await tx
          .select({
            status: guestResponses.status,
            mediaConsent: guestResponses.mediaConsent,
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
              eq(guestResponseSessionBindings.sessionId, media.sessionId),
              gt(guestResponseSessionBindings.expiresAt, now),
            ),
          )
          .where(
            and(
              eq(guestResponses.organizationId, media.organizationId),
              eq(guestResponses.id, media.responseId),
            ),
          )
          .for('update')
        if (
          !response ||
          !response.mediaConsent ||
          !['submitted', 'corrected'].includes(response.status)
        ) {
          return false
        }
        const claimed = await tx
          .update(guestResponseMedia)
          .set({
            status: 'processing',
            confirmedAt: now,
            processingLease: lease,
            processingStartedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(guestResponseMedia.organizationId, media.organizationId),
              eq(guestResponseMedia.id, media.id),
              eq(guestResponseMedia.sessionId, media.sessionId),
              eq(guestResponseMedia.objectKey, media.objectKey),
              eq(guestResponseMedia.status, 'issued'),
            ),
          )
          .returning({ id: guestResponseMedia.id })
        return claimed.length === 1
      }),

    completeMedia: async (media, lease, publicUrl, now) =>
      db.transaction(async (tx) => {
        const [response] = await tx
          .select({
            status: guestResponses.status,
            mediaConsent: guestResponses.mediaConsent,
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
              eq(guestResponseSessionBindings.sessionId, media.sessionId),
              gt(guestResponseSessionBindings.expiresAt, now),
            ),
          )
          .where(
            and(
              eq(guestResponses.organizationId, media.organizationId),
              eq(guestResponses.id, media.responseId),
            ),
          )
          .for('update')
        if (
          !response ||
          !response.mediaConsent ||
          !['submitted', 'corrected'].includes(response.status)
        ) {
          return false
        }
        const completed = await tx
          .update(guestResponseMedia)
          .set({
            status: 'ready',
            processingLease: null,
            publicUrl,
            readyAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(guestResponseMedia.organizationId, media.organizationId),
              eq(guestResponseMedia.id, media.id),
              eq(guestResponseMedia.sessionId, media.sessionId),
              eq(guestResponseMedia.objectKey, media.objectKey),
              eq(guestResponseMedia.status, 'processing'),
              eq(guestResponseMedia.processingLease, lease),
            ),
          )
          .returning({ id: guestResponseMedia.id })
        return completed.length === 1
      }),

    queueMediaPurge: async (media, now) => {
      await db
        .update(guestResponseMedia)
        .set({
          status: 'purge_pending',
          processingLease: null,
          publicUrl: null,
          readyAt: null,
          deletedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(guestResponseMedia.organizationId, media.organizationId),
            eq(guestResponseMedia.id, media.id),
          ),
        )
    },

    markMediaDeleted: async (scope, objectKey, now) => {
      await db
        .update(guestResponseMedia)
        .set({ status: 'deleted', deletedAt: now, updatedAt: now })
        .where(
          and(
            eq(guestResponseMedia.organizationId, scope.organizationId),
            eq(guestResponseMedia.propertyId, scope.propertyId),
            eq(guestResponseMedia.portalId, scope.portalId),
            eq(guestResponseMedia.objectKey, objectKey),
            eq(guestResponseMedia.status, 'purge_pending'),
          ),
        )
    },
  }
}
