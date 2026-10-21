// Review context — Drizzle writer for the push health ledger
// (`review_first_sightings`, migration 0066).
//
// `insertFirstSighting` runs inside the Review command store's transaction, so
// the row commits with the Review's first insert and a replayed snapshot page
// can neither lose it nor write a second one. `markPushArrived` pairs a later
// push with a row polling wrote first.
//
// Content-free: UUIDs, an enum and instants. Every statement carries the
// Organization, so one tenant's Review id can never stamp another's row.

import { and, eq, isNull, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { reviewFirstSightings } from '#/shared/db/schema/review-sync.schema'
import type { Tx } from '#/shared/outbox/commit'
import { PUSH_PAIRING_WINDOW_MS } from '#/shared/domain/push-health'
import { trace } from '#/shared/observability/trace'
import type { ReviewFirstSighting } from '../../application/ports/review-command-store.port'
import type { ReviewFirstSightingRecorder } from '../../application/ports/review-first-sighting-recorder.port'

/**
 * Record how and when a live Review was first seen. A conflicting row (two
 * writers racing the same first insert) keeps its first sighting; only a push
 * acceptance it was still missing is filled in.
 */
export async function insertFirstSighting(
  tx: Tx,
  review: Readonly<{
    organizationId: string
    propertyId: string
    id: string
    sourceEpoch: number
  }>,
  firstSeenAt: Date,
  sighting: ReviewFirstSighting,
): Promise<void> {
  await tx
    .insert(reviewFirstSightings)
    .values({
      organizationId: review.organizationId,
      propertyId: review.propertyId,
      reviewId: review.id,
      sourceEpoch: review.sourceEpoch,
      firstSeenAt,
      firstSeenVia: sighting.seenVia,
      pushAcceptedAt: sighting.pushAcceptedAt,
    })
    .onConflictDoUpdate({
      target: [
        reviewFirstSightings.organizationId,
        reviewFirstSightings.propertyId,
        reviewFirstSightings.reviewId,
      ],
      set: {
        pushAcceptedAt: sql`COALESCE(${reviewFirstSightings.pushAcceptedAt}, EXCLUDED.push_accepted_at)`,
      },
    })
}

export const createReviewFirstSightingRecorder = (
  db: Database,
): ReviewFirstSightingRecorder => ({
  markPushArrived: async ({ organizationId, propertyId, reviewId, acceptedAt }) =>
    trace('review.firstSighting.markPushArrived', async () => {
      await db
        .update(reviewFirstSightings)
        .set({ pushAcceptedAt: acceptedAt })
        .where(
          and(
            eq(reviewFirstSightings.organizationId, organizationId),
            eq(reviewFirstSightings.propertyId, propertyId),
            eq(reviewFirstSightings.reviewId, reviewId),
            isNull(reviewFirstSightings.pushAcceptedAt),
            // Only a push near the first sighting can be its arrival: a later
            // edit notification must not hide a miss as a late push.
            sql`${acceptedAt.toISOString()}::timestamptz <= ${reviewFirstSightings.firstSeenAt} + ${PUSH_PAIRING_WINDOW_MS} * interval '1 millisecond'`,
          ),
        )
    }),
})
