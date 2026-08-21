// Review context — Drizzle discovery-activity recorder.
//
// Writes the two ACTIVITY columns the backoff ladder reads
// (domain/discovery-backoff.ts). Both statements are monotonic: they use
// GREATEST / LEAST against the stored value so a replayed snapshot page, a
// redelivered Pub/Sub message, or two workers racing the same property can
// never move a property's recorded liveness backwards or park it.
//
// The row may not exist yet (a property imported but never swept), so both
// are upserts on the (property_id, source) primary key.
//
// Content-free: a property id and timestamps only.

import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { reviewSyncState } from '#/shared/db/schema/review-sync.schema'
import type { ReviewSyncActivityRecorder } from '../../application/ports/review-sync-activity.port'
import { trace } from '#/shared/observability/trace'

/** review_sync_state is keyed (property_id, source); Google is the only source. */
const ACTIVITY_SOURCE = 'google'

export const createReviewSyncActivityRecorder = (
  db: Database,
): ReviewSyncActivityRecorder => ({
  recordNewReviewObserved: async (propertyId, observedAt) =>
    trace('review.syncActivity.recordNewReviewObserved', async () => {
      await db
        .insert(reviewSyncState)
        .values({
          propertyId,
          source: ACTIVITY_SOURCE,
          lastNewReviewAt: observedAt,
          updatedAt: observedAt,
        })
        .onConflictDoUpdate({
          target: [reviewSyncState.propertyId, reviewSyncState.source],
          set: {
            lastNewReviewAt: sql`GREATEST(${reviewSyncState.lastNewReviewAt}, ${observedAt})`,
            updatedAt: observedAt,
          },
        })
    }),

  recordPushObserved: async (propertyId, observedAt, pollNoLaterThan) =>
    trace('review.syncActivity.recordPushObserved', async () => {
      await db
        .insert(reviewSyncState)
        .values({
          propertyId,
          source: ACTIVITY_SOURCE,
          lastNotificationAt: observedAt,
          nextIncrementalAt: pollNoLaterThan,
          updatedAt: observedAt,
        })
        .onConflictDoUpdate({
          target: [reviewSyncState.propertyId, reviewSyncState.source],
          set: {
            lastNotificationAt: sql`GREATEST(${reviewSyncState.lastNotificationAt}, ${observedAt})`,
            // Un-park a property the ladder had pushed hours out. LEAST can
            // only pull the next poll EARLIER, and the caller's bound is
            // already in the future, so this never writes an overdue time.
            nextIncrementalAt: sql`LEAST(COALESCE(${reviewSyncState.nextIncrementalAt}, ${pollNoLaterThan}), ${pollNoLaterThan})`,
            updatedAt: observedAt,
          },
        })
    }),
})
