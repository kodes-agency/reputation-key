// What a snapshot run whose listing moved under it is recorded as.
//
// `listing_changed` (the sync starts again quietly) or, once the Property's
// runs keep changing, the code that says what moved (loud): a different set
// between the two scans, a different Google total or average from one page to
// the next, or one review on two main-scan pages. The rule is
// application/snapshot-listing-change.ts; this reads the runs it needs, inside
// the transaction that holds the failing run's lock. Only one run of a
// Property source epoch is active at a time, so the runs before it are final.

import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm'
import { reviewProviderSnapshotRuns } from '#/shared/db/schema/review.schema'
import type { Tx } from '#/shared/outbox/commit'
import type { ReviewProviderSnapshotFailureCode } from '../../application/ports/review-provider-snapshot.repository'
import {
  LISTING_CHANGE_QUIET_RUNS,
  isListingMove,
  listingChangeFailureCode,
  storedFailureCode,
  type SnapshotFailureRequest,
} from '../../application/snapshot-listing-change'

type RunRow = typeof reviewProviderSnapshotRuns.$inferSelect

/**
 * The code a failure is recorded with. One that asked for a listing move
 * (`isListingMove`) is recorded as `listing_changed` until the Property's runs
 * keep moving; every other failure is recorded as asked.
 *
 * Reads at most `LISTING_CHANGE_QUIET_RUNS` of the Property's earlier runs of
 * this source epoch, newest first. A run lost to a cursor store restart is
 * skipped: it ended before it could compare its two listings.
 *
 * The table has no index for failed runs (only for active and completed ones),
 * so this reads the whole table, which holds 30 days of every Property's runs.
 * It runs only when a listing has moved, once in a few hundred runs, and the
 * lock it runs under is the failing run's own. If the table grows enough to
 * make that slow, a sidecar index over (organization_id, property_id,
 * source_epoch, started_at) serves it.
 */
export async function recordedFailureCode(
  tx: Tx,
  run: RunRow,
  requested: SnapshotFailureRequest,
): Promise<ReviewProviderSnapshotFailureCode> {
  if (!isListingMove(requested)) return storedFailureCode(requested)
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
    requested,
    previous.map((row) => row.failureCode as ReviewProviderSnapshotFailureCode | null),
  )
}
