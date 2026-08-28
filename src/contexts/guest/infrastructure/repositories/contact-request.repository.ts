import { and, asc, eq, gt, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  guestContactRequestPurgeCheckpoints,
  guestContactRequestRevealAudits,
  guestContactRequests,
  guestResponseExperienceSnapshots,
  guestResponsePrivateFeedback,
  guestResponses,
} from '#/shared/db/schema/guest.schema'
import { portalPublicationSnapshots } from '#/shared/db/schema/portal.schema'
import type { ContactRequestEncryptionPort } from '../../application/ports/contact-request-encryption.port'
import type { ContactRequestRepository } from '../../application/ports/contact-request.repository'

const PURGE_AUTHORITY = 'guest-contact-30d-v1'

const purgeExpiredContactRequests = (
  db: Database,
  input: Parameters<ContactRequestRepository['purgeExpired']>[0],
) =>
  db.transaction(async (tx) => {
    await tx
      .insert(guestContactRequestPurgeCheckpoints)
      .values({ authority: PURGE_AUTHORITY })
      .onConflictDoNothing()
    const [checkpoint] = await tx
      .select()
      .from(guestContactRequestPurgeCheckpoints)
      .where(eq(guestContactRequestPurgeCheckpoints.authority, PURGE_AUTHORITY))
      .for('update')
      .limit(1)
    if (!checkpoint) throw new Error('Contact Request purge authority unavailable')

    const expired = await tx
      .select({
        id: guestContactRequests.id,
        expiresAt: guestContactRequests.expiresAt,
      })
      .from(guestContactRequests)
      .where(
        and(
          eq(guestContactRequests.status, 'active'),
          lte(guestContactRequests.expiresAt, input.through),
        ),
      )
      .orderBy(asc(guestContactRequests.expiresAt), asc(guestContactRequests.id))
      .limit(input.batchSize)
      .for('update')

    if (expired.length > 0) {
      await tx
        .update(guestContactRequests)
        .set({
          status: 'expired',
          consentGranted: false,
          encryptedContact: null,
          withdrawnAt: null,
          purgedAt: input.through,
          updatedAt: input.through,
        })
        .where(
          and(
            inArray(
              guestContactRequests.id,
              expired.map((row) => row.id),
            ),
            eq(guestContactRequests.status, 'active'),
          ),
        )
      const last = expired.at(-1)!
      await tx
        .update(guestContactRequestPurgeCheckpoints)
        .set({
          cursorExpiresAt: last.expiresAt,
          cursorId: last.id,
          processedCount: sql`${guestContactRequestPurgeCheckpoints.processedCount} + ${expired.length}`,
          updatedAt: input.through,
        })
        .where(eq(guestContactRequestPurgeCheckpoints.authority, PURGE_AUTHORITY))
      return {
        processed: expired.length,
        checkpoint: { expiresAt: last.expiresAt, id: last.id },
        completedThrough: checkpoint.completedThrough,
      }
    }

    const completedThrough =
      checkpoint.completedThrough && checkpoint.completedThrough > input.through
        ? checkpoint.completedThrough
        : input.through
    await tx
      .update(guestContactRequestPurgeCheckpoints)
      .set({ completedThrough, updatedAt: input.through })
      .where(eq(guestContactRequestPurgeCheckpoints.authority, PURGE_AUTHORITY))
    return {
      processed: 0,
      checkpoint:
        checkpoint.cursorExpiresAt && checkpoint.cursorId
          ? { expiresAt: checkpoint.cursorExpiresAt, id: checkpoint.cursorId }
          : null,
      completedThrough,
    }
  })

/** Retention-only factory: cleanup never requires loading plaintext key material. */
export const createContactRequestRetentionRepository = (
  db: Database,
): Pick<ContactRequestRepository, 'purgeExpired'> => ({
  purgeExpired: (input) => purgeExpiredContactRequests(db, input),
})

export const createContactRequestRepository = (
  db: Database,
  encryption: ContactRequestEncryptionPort,
): ContactRequestRepository => ({
  create: async (input) => {
    const sealed = encryption.seal(
      {
        email: input.email,
        ...(input.name === undefined ? {} : { name: input.name }),
      },
      {
        ...input.scope,
        contactRequestId: input.id,
        responseId: input.responseId,
      },
    )
    return db.transaction(async (tx) => {
      const [response] = await tx
        .select({
          id: guestResponses.id,
          publicationSnapshotId: portalPublicationSnapshots.id,
          publicationVersion: portalPublicationSnapshots.version,
          publicationDigest: portalPublicationSnapshots.configurationDigest,
          contactRequestEnabled: portalPublicationSnapshots.contactRequestEnabled,
          noticeId: portalPublicationSnapshots.contactNoticeId,
          noticeVersion: portalPublicationSnapshots.contactNoticeVersion,
          noticeDigest: portalPublicationSnapshots.contactNoticeDigest,
          noticeLocale: portalPublicationSnapshots.contactNoticeLocale,
          retentionPolicyVersion:
            portalPublicationSnapshots.contactRetentionPolicyVersion,
        })
        .from(guestResponses)
        .innerJoin(
          guestResponsePrivateFeedback,
          and(
            eq(guestResponsePrivateFeedback.responseId, guestResponses.id),
            eq(
              guestResponsePrivateFeedback.organizationId,
              guestResponses.organizationId,
            ),
            eq(guestResponsePrivateFeedback.propertyId, guestResponses.propertyId),
            eq(guestResponsePrivateFeedback.portalId, guestResponses.portalId),
          ),
        )
        .innerJoin(
          guestResponseExperienceSnapshots,
          and(
            eq(guestResponseExperienceSnapshots.responseId, guestResponses.id),
            eq(
              guestResponseExperienceSnapshots.organizationId,
              guestResponses.organizationId,
            ),
            eq(guestResponseExperienceSnapshots.propertyId, guestResponses.propertyId),
            eq(guestResponseExperienceSnapshots.portalId, guestResponses.portalId),
          ),
        )
        .innerJoin(
          portalPublicationSnapshots,
          and(
            eq(
              portalPublicationSnapshots.organizationId,
              guestResponseExperienceSnapshots.organizationId,
            ),
            eq(
              portalPublicationSnapshots.propertyId,
              guestResponseExperienceSnapshots.propertyId,
            ),
            eq(
              portalPublicationSnapshots.portalId,
              guestResponseExperienceSnapshots.portalId,
            ),
            eq(
              portalPublicationSnapshots.id,
              guestResponseExperienceSnapshots.publicationSnapshotId,
            ),
            eq(
              portalPublicationSnapshots.version,
              guestResponseExperienceSnapshots.publicationVersion,
            ),
            eq(
              portalPublicationSnapshots.configurationDigest,
              guestResponseExperienceSnapshots.publicationDigest,
            ),
          ),
        )
        .where(
          and(
            eq(guestResponses.id, input.responseId),
            eq(guestResponses.organizationId, input.scope.organizationId),
            eq(guestResponses.propertyId, input.scope.propertyId),
            eq(guestResponses.portalId, input.scope.portalId),
            inArray(guestResponses.status, ['submitted', 'corrected']),
            eq(guestResponses.textConsent, true),
            isNotNull(guestResponses.feedbackSubmittedAt),
            isNull(guestResponses.feedbackWithdrawnAt),
            isNotNull(guestResponses.feedbackSourceEventId),
            gt(guestResponsePrivateFeedback.expiresAt, input.submittedAt),
            isNull(guestResponses.deletedAt),
          ),
        )
        .for('update')
        .limit(1)
      if (!response) return { outcome: 'source_unavailable' as const }
      if (!response.contactRequestEnabled) {
        return { outcome: 'contact_disabled' as const }
      }
      if (
        !response.noticeId ||
        !response.noticeVersion ||
        !response.noticeDigest ||
        !response.noticeLocale
      ) {
        return { outcome: 'source_unavailable' as const }
      }

      const inserted = await tx
        .insert(guestContactRequests)
        .values({
          id: input.id,
          organizationId: input.scope.organizationId,
          propertyId: input.scope.propertyId,
          portalId: input.scope.portalId,
          responseId: input.responseId,
          publicationSnapshotId: response.publicationSnapshotId,
          publicationVersion: response.publicationVersion,
          publicationDigest: response.publicationDigest,
          contactRequestEnabled: true,
          noticeId: response.noticeId,
          noticeVersion: response.noticeVersion,
          noticeDigest: response.noticeDigest,
          noticeLocale: response.noticeLocale,
          retentionPolicyVersion: response.retentionPolicyVersion,
          purpose: input.purpose,
          consentGranted: input.consent,
          encryptedContact: sealed.ciphertext,
          encryptionKeyId: sealed.keyId,
          status: 'active',
          submittedAt: input.submittedAt,
          expiresAt: input.expiresAt,
          createdAt: input.submittedAt,
          updatedAt: input.submittedAt,
        })
        .onConflictDoNothing()
        .returning({ id: guestContactRequests.id })
      return {
        outcome: inserted[0] ? ('created' as const) : ('duplicate' as const),
      }
    })
  },

  findMasked: async (input) =>
    db.transaction(async (tx) => {
      if (input.authorization.checkedAt.getTime() !== input.asOf.getTime()) {
        return null
      }
      // Intentionally does not select encryptedContact or encryptionKeyId.
      const [row] = await tx
        .select({
          id: guestContactRequests.id,
          organizationId: guestContactRequests.organizationId,
          propertyId: guestContactRequests.propertyId,
          portalId: guestContactRequests.portalId,
          responseId: guestContactRequests.responseId,
          purpose: guestContactRequests.purpose,
          submittedAt: guestContactRequests.submittedAt,
          expiresAt: guestContactRequests.expiresAt,
        })
        .from(guestContactRequests)
        .where(
          and(
            eq(guestContactRequests.id, input.contactRequestId),
            eq(guestContactRequests.organizationId, input.scope.organizationId),
            eq(guestContactRequests.propertyId, input.scope.propertyId),
            eq(guestContactRequests.portalId, input.scope.portalId),
            eq(guestContactRequests.status, 'active'),
            eq(guestContactRequests.consentGranted, true),
            gt(guestContactRequests.expiresAt, input.asOf),
          ),
        )
        .for('share')
        .limit(1)
      if (!row) return null
      return {
        id: row.id,
        scope: {
          organizationId: row.organizationId,
          propertyId: row.propertyId,
          portalId: row.portalId,
        },
        responseId: row.responseId,
        purpose: row.purpose as 'manager_follow_up',
        maskedContact: '••••••••' as const,
        submittedAt: row.submittedAt,
        expiresAt: row.expiresAt,
      }
    }),

  reveal: async (input) =>
    db.transaction(async (tx) => {
      if (input.authorization.checkedAt.getTime() !== input.at.getTime()) {
        return { outcome: 'not_authorized' as const }
      }
      const [request] = await tx
        .select({
          encryptedContact: guestContactRequests.encryptedContact,
          encryptionKeyId: guestContactRequests.encryptionKeyId,
          responseId: guestContactRequests.responseId,
        })
        .from(guestContactRequests)
        .where(
          and(
            eq(guestContactRequests.id, input.contactRequestId),
            eq(guestContactRequests.organizationId, input.scope.organizationId),
            eq(guestContactRequests.propertyId, input.scope.propertyId),
            eq(guestContactRequests.portalId, input.scope.portalId),
            eq(guestContactRequests.status, 'active'),
            eq(guestContactRequests.consentGranted, true),
            gt(guestContactRequests.expiresAt, input.at),
          ),
        )
        .for('update')
        .limit(1)
      if (!request) {
        const [exists] = await tx
          .select({ id: guestContactRequests.id })
          .from(guestContactRequests)
          .where(
            and(
              eq(guestContactRequests.id, input.contactRequestId),
              eq(guestContactRequests.organizationId, input.scope.organizationId),
              eq(guestContactRequests.propertyId, input.scope.propertyId),
              eq(guestContactRequests.portalId, input.scope.portalId),
            ),
          )
          .limit(1)
        return { outcome: exists ? ('unavailable' as const) : ('not_found' as const) }
      }

      if (!request.encryptedContact || !request.encryptionKeyId) {
        return { outcome: 'unavailable' as const }
      }

      const contact = encryption.open(
        {
          keyId: request.encryptionKeyId,
          ciphertext: request.encryptedContact,
        },
        {
          ...input.scope,
          contactRequestId: input.contactRequestId,
          responseId: request.responseId,
        },
      )
      await tx.insert(guestContactRequestRevealAudits).values({
        id: input.auditId,
        contactRequestId: input.contactRequestId,
        organizationId: input.scope.organizationId,
        propertyId: input.scope.propertyId,
        portalId: input.scope.portalId,
        actorId: input.authorization.actorId,
        accessPurpose: input.accessPurpose,
        authorityBasis: input.authorization.basis,
        revealedAt: input.at,
        createdAt: input.at,
      })
      return { outcome: 'revealed' as const, ...contact }
    }),

  withdraw: async (input) =>
    db.transaction(async (tx) => {
      const [request] = await tx
        .select({ status: guestContactRequests.status })
        .from(guestContactRequests)
        .where(
          and(
            eq(guestContactRequests.id, input.contactRequestId),
            eq(guestContactRequests.organizationId, input.scope.organizationId),
            eq(guestContactRequests.propertyId, input.scope.propertyId),
            eq(guestContactRequests.portalId, input.scope.portalId),
            eq(guestContactRequests.responseId, input.responseId),
          ),
        )
        .for('update')
        .limit(1)
      if (!request) return { outcome: 'not_found' as const }
      if (request.status !== 'active') return { outcome: 'unavailable' as const }
      const updated = await tx
        .update(guestContactRequests)
        .set({
          status: 'withdrawn',
          consentGranted: false,
          encryptedContact: null,
          withdrawnAt: input.at,
          purgedAt: null,
          updatedAt: input.at,
        })
        .where(
          and(
            eq(guestContactRequests.id, input.contactRequestId),
            eq(guestContactRequests.organizationId, input.scope.organizationId),
            eq(guestContactRequests.propertyId, input.scope.propertyId),
            eq(guestContactRequests.portalId, input.scope.portalId),
            eq(guestContactRequests.status, 'active'),
          ),
        )
        .returning({ id: guestContactRequests.id })
      return {
        outcome: updated[0] ? ('withdrawn' as const) : ('unavailable' as const),
      }
    }),

  purgeExpired: (input) => purgeExpiredContactRequests(db, input),
})
