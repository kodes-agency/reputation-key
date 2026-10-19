// What a snapshot run whose confirmation found a different set is recorded as.
//
// `listing_changed` (the sync starts again quietly) or, once the Property's
// runs keep changing, `confirmation_set_changed` (loud). The rule is
// application/snapshot-listing-change.ts; this reads the runs it needs, inside
// the transaction that holds the failing run's lock. Only one run of a
// Property source epoch is active at a time, so the runs before it are final.

import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm'
import { reviewProviderSnapshotRuns } from '#/shared/db/schema/review.schema'
import type { Tx } from '#/shared/outbox/commit'
import type { ReviewProviderSnapshotFailureCode } from '../../application/ports/review-provider-snapshot.repository'
import {
  LISTING_CHANGE_QUIET_RUNS,
  listingChangeFailureCode,
} from '../../application/snapshot-listing-change'

type RunRow = typeof reviewProviderSnapshotRuns.$inferSelect

/**
 * The code a failure asked for as `confirmation_set_changed` is recorded with.
 * Every other code is recorded as asked.
 *
 * Reads at most `LISTING_CHANGE_QUIET_RUNS` of the Property's earlier runs of
 * this source epoch, newest first. A run lost to a cursor store restart is
 * skipped: it ended before it could compare its two listings.
 *
 * The table has no index for failed runs (only for active and completed ones),
 * so this reads the whole table, which holds 30 days of every Property's runs.
 * It runs only when a set has changed, once in a few hundred runs, and the
 * lock it runs under is the failing run's own. If the table grows enough to
 * make that slow, a sidecar index over (organization_id, property_id,
 * source_epoch, started_at) serves it.
 */
export async function recordedFailureCode(
  tx: Tx,
  run: RunRow,
  requested: ReviewProviderSnapshotFailureCode,
): Promise<ReviewProviderSnapshotFailureCode> {
  if (requested !== 'confirmation_set_changed') return requested
  const previous = await tx
    .select({ failureCode: reviewProviderSnapshotRuns.failureCode })
    .from(reviewProviderSnapshotRuns)
    .where(
      and(
        eq(reviewProviderSnapshotRuns.organizationId, run.organizationId),
        eq(reviewProviderSnapshotRuns.propertyId, run.propertyId),
        eq(reviewProviderSnapshotRuns.sourceEpoch, run.sourceEpoch),
        inArray(reviewProviderSnapshotRuns.state, ['completed', 'failed']),
        ne(reviewProviderSnapshotRuns.id, run.id),
        sql`${reviewProviderSnapshotRuns.failureCode} IS DISTINCT FROM 'cursor_lost'`,
      ),
    )
    .orderBy(
      desc(reviewProviderSnapshotRuns.startedAt),
      desc(reviewProviderSnapshotRuns.id),
    )
    .limit(LISTING_CHANGE_QUIET_RUNS)
  return listingChangeFailureCode(
    previous.map((row) => row.failureCode as ReviewProviderSnapshotFailureCode | null),
  )
}
