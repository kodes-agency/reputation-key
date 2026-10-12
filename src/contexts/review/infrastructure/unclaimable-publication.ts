// A publication cycle the publish worker finds it may not claim.
//
// The claim (reply-command-store.ts, markPublicationSending) decides under its
// locks whether the cycle may still be sent. Three answers end the cycle
// instead of leaving it for the reconciliation sweep: the manager it names has
// lost current authority, its Property is no longer active at its source
// epoch, or it holds AI-assisted text the last gate refuses
// (reply-write-guards.ts, `aiTextMayBeClaimed`).
//
// The first two are policy stops: the cycle is cancelled, the Reply returns to
// draft with its text, and a manager submits it again when the Property or the
// authority allows.
//
// The third is a withdrawal. Unedited AI text that may no longer be published
// is what the AI draft purge (src/shared/db/ai/ai-draft-purge.ts) removes: the
// transaction that changes an input runs it, and so does the next sync that
// sees the Review once the ten minutes are over. The claim only got there
// first. So it leaves exactly what the purge would have left, an empty draft
// that claims no AI authorship with its authorization and attempts kept, and
// records the purge's cause, `ai_draft_withdrawn`. A draft that kept its AI
// text under a "returned to draft" notice would be emptied by the next sync
// with nobody told.

import { purgeAiDraftsForReview } from '#/shared/db/ai/ai-draft-purge'
import { insertOutboxRow, type Tx } from '#/shared/outbox/commit'
import type { Reply } from '../domain/types'
import {
  reviewReplyPublicationCancelled,
  type ReviewReplyPublicationCancelled,
} from '../domain/events'
import { cancelledPublication } from '../domain/reply-command-preconditions'
import { replyAuthor } from '../domain/reply-author'
import type { PublicationAttemptStart } from '../application/ports/reply-command-store.port'
import { guardedPublicationUpdate, updateCurrentAttempt } from './reply-write-guards'

/** Why the claim ends the cycle instead of taking it. */
export type UnclaimableCause = Extract<
  ReviewReplyPublicationCancelled['cause'],
  'policy' | 'ai_draft_withdrawn'
>

/**
 * Move a cycle the claim may not take to cancelled, and commit the durable
 * cancellation fact, when the row is still the unclaimed cycle this claim
 * read. For `ai_draft_withdrawn` the Reply's AI text goes with it. Resolves
 * null, the claim's own answer for a cycle it did not take.
 */
export async function cancelUnclaimablePublication(
  tx: Tx,
  reply: Reply,
  attempt: Pick<PublicationAttemptStart, 'propertyId'>,
  at: Date,
  cause: UnclaimableCause,
): Promise<null> {
  const cancellation = cancelledPublication(reply)
  if (!cancellation) return null
  // Only the cycle this claim read as unclaimed: a row another worker has
  // since claimed is that worker's to settle.
  const cancelled = await guardedPublicationUpdate(
    tx,
    reply,
    'approved',
    ['authorized'],
    {
      ...cancellation,
      updatedAt: at,
    },
  )
  if (!cancelled) return null
  if (cancelled.publicationAttempts > 0) {
    await updateCurrentAttempt(tx, cancelled, {
      outcome: 'superseded',
      confirmedObservationRevision: null,
      updatedAt: at,
    })
  }
  await insertOutboxRow(
    tx,
    reviewReplyPublicationCancelled({
      replyId: cancelled.id,
      reviewId: cancelled.reviewId,
      propertyId: attempt.propertyId,
      organizationId: cancelled.organizationId,
      authorId: replyAuthor(cancelled),
      cause,
      occurredAt: at,
    }),
  )
  if (cause === 'ai_draft_withdrawn') {
    // The row is now one the purge empties (a draft after a cancelled cycle).
    // It records no second fact: the one above told the people waiting.
    await purgeAiDraftsForReview(tx, {
      organizationId: cancelled.organizationId,
      reviewId: cancelled.reviewId,
    })
  }
  return null
}
