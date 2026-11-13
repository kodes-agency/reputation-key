// Replays journaled single-response erasures (withdrawal or operator) in a restored cell.

import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import type {
  BackupErasureLedgerEntry,
  BackupErasureReplayer,
} from '#/shared/db/lifecycle/backup-erasure-ledger'
import {
  guestContactRequests,
  guestResponsePrivateFeedback,
  guestResponses,
} from '#/shared/db/schema/guest.schema'
import { insertOutboxRow, type Tx } from '#/shared/outbox/commit'
import type { PrimaryStaffAttributionSnapshot } from '#/shared/domain/primary-staff-attribution'
import {
  feedbackId,
  organizationId,
  portalId,
  propertyId,
  ratingId,
} from '#/shared/domain/ids'
import { guestFeedbackRetracted, guestRatingRetracted } from '../../domain/events'

function journaledIds(entry: BackupErasureLedgerEntry, kind: string): string[] {
  if (
    entry.context !== 'guest' ||
    entry.subjectClass !== 'privacy_subject' ||
    entry.journalTargets?.kind !== kind
  ) {
    throw new Error('Guest response replayer requires a journaled Guest response erasure')
  }
  return [...entry.journalTargets.ids]
}

type ResponseRow = typeof guestResponses.$inferSelect

function attributionOf(row: ResponseRow): PrimaryStaffAttributionSnapshot | null {
  return row.attributedStaffParticipantId &&
    row.attributedStaffParticipationId &&
    row.attributionResponsibilityId &&
    row.staffAttributionEffectiveFrom
    ? {
        staffParticipantId: row.attributedStaffParticipantId,
        staffParticipationId: row.attributedStaffParticipationId,
        portalResponsibilityId: row.attributionResponsibilityId,
        effectiveFrom: row.staffAttributionEffectiveFrom,
        effectiveTo: row.staffAttributionEffectiveTo,
      }
    : null
}

/**
 * Publish the retractions the original erasure published. A restore brings
 * back the Inbox and Reporting readings built from the response, and their
 * consumers scrub them only when they receive these facts again.
 */
async function publishRetractions(
  tx: Tx,
  rows: ReadonlyArray<ResponseRow>,
  include: Readonly<{ rating: boolean }>,
  occurredAt: Date,
): Promise<number> {
  let published = 0
  for (const row of rows) {
    const scope = {
      organizationId: organizationId(row.organizationId),
      portalId: portalId(row.portalId),
      propertyId: propertyId(row.propertyId),
      occurredAt,
      staffAttribution: attributionOf(row),
    }
    if (include.rating && row.ratingSourceEventId) {
      await insertOutboxRow(
        tx,
        guestRatingRetracted({
          ...scope,
          ratingId: ratingId(row.id),
          supersedesSourceEventId: row.ratingSourceEventId,
        }),
      )
      published += 1
    }
    if (row.feedbackSourceEventId) {
      await insertOutboxRow(
        tx,
        guestFeedbackRetracted({
          ...scope,
          feedbackId: feedbackId(row.id),
          supersedesSourceEventId: row.feedbackSourceEventId,
          responseRevision: row.feedbackSubmissionRevision ?? undefined,
        }),
      )
      published += 1
    }
  }
  return published
}

/**
 * Re-erase the whole responses named by the entry, inside the entry's
 * Organization only. Convergent: a response already deleted is not counted.
 */
export const createGuestResponseErasureReplayer = (): BackupErasureReplayer => ({
  context: 'guest',
  subjectClass: 'privacy_subject',
  targetKind: 'guest_response',
  reErase: async (tx: Tx, entry: BackupErasureLedgerEntry): Promise<number> => {
    const ids = journaledIds(entry, 'guest_response')
    const live = await tx
      .select()
      .from(guestResponses)
      .where(
        and(
          eq(guestResponses.organizationId, entry.organizationId),
          inArray(guestResponses.id, ids),
          isNull(guestResponses.deletedAt),
        ),
      )
    const erased = await tx
      .update(guestResponses)
      .set({
        status: 'deleted',
        rating: null,
        categoryId: null,
        responseConsent: false,
        textConsent: false,
        mediaConsent: false,
        ratingSourceEventId: null,
        feedbackSourceEventId: null,
        deletedAt: entry.effectiveErasureAt,
        updatedAt: entry.effectiveErasureAt,
      })
      .where(
        and(
          eq(guestResponses.organizationId, entry.organizationId),
          inArray(guestResponses.id, ids),
          isNull(guestResponses.deletedAt),
        ),
      )
      .returning({ id: guestResponses.id })
    const feedback = await tx
      .delete(guestResponsePrivateFeedback)
      .where(
        and(
          eq(guestResponsePrivateFeedback.organizationId, entry.organizationId),
          inArray(guestResponsePrivateFeedback.responseId, ids),
        ),
      )
      .returning({ id: guestResponsePrivateFeedback.responseId })
    // The reveal audits of the contact go with it through their foreign key.
    const contact = await tx
      .delete(guestContactRequests)
      .where(
        and(
          eq(guestContactRequests.organizationId, entry.organizationId),
          inArray(guestContactRequests.responseId, ids),
        ),
      )
      .returning({ id: guestContactRequests.id })
    await publishRetractions(tx, live, { rating: true }, entry.effectiveErasureAt)
    return erased.length + feedback.length + contact.length
  },
})

/** Re-erase the private feedback of the named responses; the rating stays. */
export const createGuestFeedbackErasureReplayer = (): BackupErasureReplayer => ({
  context: 'guest',
  subjectClass: 'privacy_subject',
  targetKind: 'guest_feedback',
  reErase: async (tx: Tx, entry: BackupErasureLedgerEntry): Promise<number> => {
    const ids = journaledIds(entry, 'guest_feedback')
    const pending = await tx
      .select()
      .from(guestResponses)
      .where(
        and(
          eq(guestResponses.organizationId, entry.organizationId),
          inArray(guestResponses.id, ids),
          sql`${guestResponses.feedbackSourceEventId} is not null`,
          isNull(guestResponses.feedbackWithdrawnAt),
        ),
      )
    const feedback = await tx
      .delete(guestResponsePrivateFeedback)
      .where(
        and(
          eq(guestResponsePrivateFeedback.organizationId, entry.organizationId),
          inArray(guestResponsePrivateFeedback.responseId, ids),
        ),
      )
      .returning({ id: guestResponsePrivateFeedback.responseId })
    const flagged = await tx
      .update(guestResponses)
      .set({
        textConsent: false,
        feedbackSourceEventId: null,
        feedbackWithdrawnAt: entry.effectiveErasureAt,
      })
      .where(
        and(
          eq(guestResponses.organizationId, entry.organizationId),
          inArray(guestResponses.id, ids),
          sql`${guestResponses.feedbackSourceEventId} is not null`,
          isNull(guestResponses.feedbackWithdrawnAt),
        ),
      )
      .returning({ id: guestResponses.id })
    await publishRetractions(tx, pending, { rating: false }, entry.effectiveErasureAt)
    return feedback.length + flagged.length
  },
})

/** Re-withdraw the named contact requests: the sealed details go, the audit stays. */
export const createGuestContactRequestErasureReplayer = (): BackupErasureReplayer => ({
  context: 'guest',
  subjectClass: 'privacy_subject',
  targetKind: 'guest_contact_request',
  reErase: async (tx: Tx, entry: BackupErasureLedgerEntry): Promise<number> => {
    const ids = journaledIds(entry, 'guest_contact_request')
    const withdrawn = await tx
      .update(guestContactRequests)
      .set({
        status: 'withdrawn',
        consentGranted: false,
        encryptedContact: null,
        withdrawnAt: entry.effectiveErasureAt,
        purgedAt: null,
        updatedAt: entry.effectiveErasureAt,
      })
      .where(
        and(
          eq(guestContactRequests.organizationId, entry.organizationId),
          inArray(guestContactRequests.id, ids),
          eq(guestContactRequests.status, 'active'),
        ),
      )
      .returning({ id: guestContactRequests.id })
    return withdrawn.length
  },
})
