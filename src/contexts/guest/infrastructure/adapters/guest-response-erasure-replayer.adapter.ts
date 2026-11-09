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
import type { Tx } from '#/shared/outbox/commit'

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
    return feedback.length + flagged.length
  },
})
