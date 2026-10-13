// The publication attempt a Google reply observation may attribute, as the
// observation decision reads it (domain/google-reply-observation.ts). Read
// inside the observation store's transaction, under its Review-scoped lock.

import { and, desc, eq, lt } from 'drizzle-orm'
import { replyPublicationAttempts, type replies } from '#/shared/db/schema/review.schema'
import { replyId } from '#/shared/domain/ids'
import type { Tx } from '#/shared/outbox/commit'
import {
  isOpenAttemptOutcome,
  type GoogleReplyPublicationCandidate,
} from '../domain/google-reply-observation'

type InternalReplyRow = typeof replies.$inferSelect
type PublicationAttemptRow = typeof replyPublicationAttempts.$inferSelect

/**
 * The digest of the text RepKey last confirmed on Google for the Reply, in a
 * cycle before this attempt's: what an edit-and-republish is written over.
 * Attempts are append-only evidence, so this holds whatever has become of the
 * observation head since (a guest edit and a source-epoch carry both record
 * the same reply again without naming the Reply it was confirmed for). Read
 * only for an attempt still in flight; the decision asks nothing of it
 * otherwise.
 */
async function readEarlierConfirmedDigest(
  tx: Tx,
  attempt: PublicationAttemptRow,
): Promise<string | null> {
  if (!isOpenAttemptOutcome(attempt.outcome)) return null
  const rows = await tx
    .select({ digest: replyPublicationAttempts.expectedReplyDigest })
    .from(replyPublicationAttempts)
    .where(
      and(
        eq(replyPublicationAttempts.organizationId, attempt.organizationId),
        eq(replyPublicationAttempts.replyId, attempt.replyId),
        lt(replyPublicationAttempts.publicationCycle, attempt.publicationCycle),
        eq(replyPublicationAttempts.outcome, 'confirmed'),
      ),
    )
    .orderBy(
      desc(replyPublicationAttempts.publicationCycle),
      desc(replyPublicationAttempts.attemptNumber),
    )
    .limit(1)
  return rows[0]?.digest ?? null
}

/** Null when the Review has no internal Reply, or the Reply no attempt. */
export async function readPublicationCandidate(
  tx: Tx,
  internal: InternalReplyRow | undefined,
  attempt: PublicationAttemptRow | undefined,
): Promise<GoogleReplyPublicationCandidate | null> {
  if (!internal || !attempt) return null
  return {
    replyId: replyId(internal.id),
    publicationCycle: attempt.publicationCycle,
    attemptNumber: attempt.attemptNumber,
    sourceEpoch: attempt.sourceEpoch,
    materialReviewRevision: attempt.materialReviewRevision,
    expectedReplyDigest: attempt.expectedReplyDigest,
    // Lets the decision recognise a whitespace-reformatted echo; it is ignored
    // unless it digests to the attempt's digest.
    expectedReplyText: internal.text,
    earlierConfirmedDigest: await readEarlierConfirmedDigest(tx, attempt),
    outcome: attempt.outcome as GoogleReplyPublicationCandidate['outcome'],
  }
}
