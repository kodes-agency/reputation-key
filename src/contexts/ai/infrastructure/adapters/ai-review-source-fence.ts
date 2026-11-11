import { and, eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { reviews, reviewSourceContents } from '#/shared/db/schema'

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]

/**
 * The review's source as it stands now, share-locked: its epoch, revision and
 * sequence, the digest and size of the canonical source an operation read, when
 * its content expires and where its reply state is. A provider call is admitted,
 * and its result written, only if this still matches what the operation was
 * claimed on.
 */
export async function readCurrentReviewSource(
  tx: Transaction,
  input: Readonly<{ organizationId: string; propertyId: string; reviewId: string }>,
) {
  const [source] = await tx
    .select({
      sourceEpoch: reviews.sourceEpoch,
      sourceRevision: reviews.sourceRevision,
      analysisSequence: reviews.analysisSequence,
      sourceDigest: reviewSourceContents.aiSourceDigest,
      sourceByteCount: reviewSourceContents.aiSourceByteLength,
      contentExpiresAt: reviewSourceContents.contentExpiresAt,
      replyStateRevision: reviews.replyStateRevision,
    })
    .from(reviews)
    .innerJoin(
      reviewSourceContents,
      and(
        eq(reviewSourceContents.reviewId, reviews.id),
        eq(reviewSourceContents.organizationId, reviews.organizationId),
        eq(reviewSourceContents.propertyId, reviews.propertyId),
      ),
    )
    .where(
      and(
        eq(reviews.organizationId, input.organizationId),
        eq(reviews.propertyId, input.propertyId),
        eq(reviews.id, input.reviewId),
      ),
    )
    .limit(1)
    .for('share', { of: reviews })
  return source
}

type CurrentReviewSource = NonNullable<
  Awaited<ReturnType<typeof readCurrentReviewSource>>
>

/**
 * Whether the review's source is still the one the operation read: the same
 * epoch and revision, the same canonical source by digest and size, and content
 * that had not expired at `at`. The contract's own fence (the analysis
 * sequence, the reply state) is checked by the caller.
 */
export function sourceHoldsOperation(
  source: CurrentReviewSource,
  operation: Readonly<{ sourceDigest: string | null; sourceByteCount: number | null }>,
  input: Readonly<{ sourceEpoch: number; sourceRevision: number }>,
  at: Date,
): boolean {
  return (
    source.sourceEpoch === input.sourceEpoch &&
    source.sourceRevision === input.sourceRevision &&
    source.sourceDigest === operation.sourceDigest &&
    source.sourceByteCount === operation.sourceByteCount &&
    source.contentExpiresAt !== null &&
    source.contentExpiresAt > at
  )
}
