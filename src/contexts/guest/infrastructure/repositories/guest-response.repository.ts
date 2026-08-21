import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { guestResponseMedia, guestResponses } from '#/shared/db/schema/guest.schema'
import type { GuestResponseRepository } from '../../application/ports/guest-response.repository'
import type {
  GuestMedia,
  GuestMediaContentType,
  GuestMediaStatus,
} from '../../domain/guest-media'
import type { GuestResponse, GuestResponseStatus } from '../../domain/guest-response'

type ResponseRow = typeof guestResponses.$inferSelect
type MediaRow = typeof guestResponseMedia.$inferSelect

function responseFromRow(row: ResponseRow): GuestResponse {
  return {
    id: row.id,
    organizationId: row.organizationId,
    propertyId: row.propertyId,
    portalId: row.portalId,
    sessionId: row.sessionId,
    status: row.status as GuestResponseStatus,
    rating: row.rating,
    category: row.categoryId,
    text: row.responseText,
    responseConsent: row.responseConsent,
    textConsent: row.textConsent,
    mediaConsent: row.mediaConsent,
    contactConsent: false,
    contactDetails: null,
    correctionCount: row.correctionCount === 1 ? 1 : 0,
    submittedAt: row.submittedAt,
    correctedAt: row.correctedAt,
    moderatedAt: row.moderatedAt,
    deletedAt: row.deletedAt,
    retentionDeadline: row.retentionDeadline,
    schemaVersion: 1,
  }
}

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

export function createGuestResponseRepository(db: Database): GuestResponseRepository {
  return {
    findForSession: async (scope, sessionId) => {
      const [row] = await db
        .select()
        .from(guestResponses)
        .where(
          and(
            eq(guestResponses.organizationId, scope.organizationId),
            eq(guestResponses.propertyId, scope.propertyId),
            eq(guestResponses.portalId, scope.portalId),
            eq(guestResponses.sessionId, sessionId),
          ),
        )
        .limit(1)
      return row ? responseFromRow(row) : null
    },

    findById: async (scope, responseId) => {
      const [row] = await db
        .select()
        .from(guestResponses)
        .where(
          and(
            eq(guestResponses.organizationId, scope.organizationId),
            eq(guestResponses.propertyId, scope.propertyId),
            eq(guestResponses.portalId, scope.portalId),
            eq(guestResponses.id, responseId),
          ),
        )
        .limit(1)
      return row ? responseFromRow(row) : null
    },

    // Org-scoped by design (see the port comment): an inbox item knows only its
    // organization and the response id. Selects the two shared fields and
    // nothing else — no session id, no IP hash, no media.
    findSnippetForOrg: async (organizationId, responseId) => {
      const [row] = await db
        .select({
          comment: guestResponses.responseText,
          ratingValue: guestResponses.rating,
          textConsent: guestResponses.textConsent,
          responseConsent: guestResponses.responseConsent,
        })
        .from(guestResponses)
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
        comment: row.textConsent ? row.comment : null,
        ratingValue: row.responseConsent ? row.ratingValue : null,
      }
    },

    insertSubmitted: async (response) => {
      const inserted = await db
        .insert(guestResponses)
        .values({
          id: response.id,
          organizationId: response.organizationId,
          propertyId: response.propertyId,
          portalId: response.portalId,
          sessionId: response.sessionId,
          status: response.status,
          rating: response.rating,
          categoryId: response.category,
          responseText: response.text,
          responseConsent: response.responseConsent,
          textConsent: response.textConsent,
          mediaConsent: response.mediaConsent,
          correctionCount: response.correctionCount,
          submittedAt: response.submittedAt,
          correctedAt: response.correctedAt,
          moderatedAt: response.moderatedAt,
          retentionDeadline: response.retentionDeadline,
          deletedAt: response.deletedAt,
          updatedAt: response.submittedAt ?? new Date(),
        })
        .onConflictDoNothing()
        .returning({ id: guestResponses.id })
      return inserted.length === 1
    },

    saveCorrection: async (response) => {
      const updated = await db
        .update(guestResponses)
        .set({
          status: response.status,
          rating: response.rating,
          categoryId: response.category,
          responseText: response.text,
          responseConsent: response.responseConsent,
          textConsent: response.textConsent,
          mediaConsent: response.mediaConsent,
          correctionCount: response.correctionCount,
          correctedAt: response.correctedAt,
          updatedAt: response.correctedAt ?? new Date(),
        })
        .where(
          and(
            eq(guestResponses.organizationId, response.organizationId),
            eq(guestResponses.propertyId, response.propertyId),
            eq(guestResponses.portalId, response.portalId),
            eq(guestResponses.sessionId, response.sessionId),
            eq(guestResponses.id, response.id),
            eq(guestResponses.status, 'submitted'),
            eq(guestResponses.correctionCount, 0),
            isNull(guestResponses.deletedAt),
          ),
        )
        .returning({ id: guestResponses.id })
      return updated.length === 1
    },

    saveModeration: async (response) =>
      db.transaction(async (tx) => {
        const updated = await tx
          .update(guestResponses)
          .set({
            status: response.status,
            moderatedAt: response.moderatedAt,
            updatedAt: response.moderatedAt ?? new Date(),
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
            updatedAt: response.moderatedAt ?? new Date(),
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

    deleteAndQueueMediaPurge: async (response) =>
      db.transaction(async (tx) => {
        const deleted = await tx
          .update(guestResponses)
          .set({
            status: 'deleted',
            rating: null,
            categoryId: null,
            responseText: null,
            responseConsent: false,
            textConsent: false,
            mediaConsent: false,
            deletedAt: response.deletedAt,
            updatedAt: response.deletedAt ?? new Date(),
          })
          .where(
            and(
              eq(guestResponses.organizationId, response.organizationId),
              eq(guestResponses.propertyId, response.propertyId),
              eq(guestResponses.portalId, response.portalId),
              eq(guestResponses.sessionId, response.sessionId),
              eq(guestResponses.id, response.id),
            ),
          )
          .returning({ id: guestResponses.id })
        if (deleted.length === 0) return []
        const media = await tx
          .update(guestResponseMedia)
          .set({
            status: 'purge_pending',
            processingLease: null,
            publicUrl: null,
            readyAt: null,
            deletedAt: response.deletedAt,
            updatedAt: response.deletedAt ?? new Date(),
          })
          .where(
            and(
              eq(guestResponseMedia.organizationId, response.organizationId),
              eq(guestResponseMedia.responseId, response.id),
              inArray(guestResponseMedia.status, ['issued', 'processing', 'ready']),
            ),
          )
          .returning({ objectKey: guestResponseMedia.objectKey })
        return media.map((item) => item.objectKey)
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
        .select()
        .from(guestResponseMedia)
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
      return row ? mediaFromRow(row) : null
    },

    claimMedia: async (media, lease, now) =>
      db.transaction(async (tx) => {
        const [response] = await tx
          .select({
            status: guestResponses.status,
            mediaConsent: guestResponses.mediaConsent,
          })
          .from(guestResponses)
          .where(
            and(
              eq(guestResponses.organizationId, media.organizationId),
              eq(guestResponses.id, media.responseId),
              eq(guestResponses.sessionId, media.sessionId),
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
          .where(
            and(
              eq(guestResponses.organizationId, media.organizationId),
              eq(guestResponses.id, media.responseId),
              eq(guestResponses.sessionId, media.sessionId),
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
