// What a snapshot run's finished main listing says about the stored Reviews.
//
// A run removes a Review that vanished from Google only on the strength of a
// listing that agrees with Google's own total (ADR 0055, note 2026-10-18).
// The comparison and the missing-Review bookkeeping it gates live here, beside
// the repository that calls them.

import { sql } from 'drizzle-orm'
import { domainError } from '#/shared/domain/errors'
import type { Tx } from '#/shared/outbox/commit'
import type { reviewProviderSnapshotRuns } from '#/shared/db/schema/review.schema'
import {
  type SnapshotCountAgreement,
  snapshotCountAgreement,
} from '../../application/snapshot-count-gap'

type RunRow = typeof reviewProviderSnapshotRuns.$inferSelect

/** How the run's main listing compares with the Google total it froze. */
export const listingAgreement = (run: RunRow): SnapshotCountAgreement =>
  run.expectedTotal == null
    ? { kind: 'mismatch' }
    : snapshotCountAgreement({
        expected: run.expectedTotal,
        unique: run.mainUniqueCount,
        pages: run.mainPageCount,
      })

/**
 * The apply step's own hold on the rule. `finishMainScan` records no removal
 * candidate for a run whose listing disagreed with Google's total, and the
 * counts it judged are frozen once the main scan ends, so this cannot fire
 * through the normal flow. Should such a candidate exist all the same, refuse
 * rather than remove: the transaction rolls back, nothing is erased, and the
 * run stays `deleting` until it expires.
 */
export function refuseRemovalWithoutExactListing(
  run: RunRow,
  candidateCount: number,
): void {
  if (candidateCount === 0 || listingAgreement(run).kind === 'exact') return
  throw domainError(
    'snapshot_count_gap_removal_refused',
    'Provider removal refused for a listing that disagreed with the provider total',
  )
}

/**
 * What a complete main listing says is missing. A stored Review absent from
 * it becomes a removal candidate when an earlier run already missed it at
 * least 15 minutes before this one started; every absent Review keeps (or
 * gets) its first miss. Called only for a listing that matches Google's total
 * exactly: a run with a count gap records no miss at all, so no later run can
 * finish a removal on evidence that listing gave.
 */
export async function recordMissingFromListing(tx: Tx, run: RunRow): Promise<void> {
  await tx.execute(sql`
    INSERT INTO review_provider_deletion_candidates
      (run_id, review_id, expected_mapping_state, expected_source_revision, state)
    SELECT ${run.id}, s.review_id, s.state, s.last_source_revision, 'pending'
    FROM review_provider_subjects s
    LEFT JOIN review_provider_snapshot_members m
      ON m.run_id = ${run.id} AND m.review_id = s.review_id AND m.main_seen
    WHERE s.organization_id = ${run.organizationId}
      AND s.property_id = ${run.propertyId}
      AND s.source_epoch = ${run.sourceEpoch}
      AND s.state IN ('linked', 'source_expired')
      AND s.last_observed_at <= ${run.startedAt}
      AND m.review_id IS NULL
      AND s.first_missing_at IS NOT NULL
      AND s.first_missing_snapshot_run_id <> ${run.id}
      AND s.first_missing_at <= ${run.startedAt}::timestamptz - interval '15 minutes'
    ON CONFLICT (run_id, review_id) DO NOTHING
  `)
  await tx.execute(sql`
    UPDATE review_provider_subjects s
    SET first_missing_at = COALESCE(s.first_missing_at, transaction_timestamp()),
        first_missing_snapshot_run_id = COALESCE(s.first_missing_snapshot_run_id, ${run.id}),
        updated_at = transaction_timestamp()
    WHERE s.organization_id = ${run.organizationId}
      AND s.property_id = ${run.propertyId}
      AND s.source_epoch = ${run.sourceEpoch}
      AND s.state IN ('linked', 'source_expired')
      AND s.last_observed_at <= ${run.startedAt}
      AND NOT EXISTS (
        SELECT 1 FROM review_provider_snapshot_members m
        WHERE m.run_id = ${run.id} AND m.review_id = s.review_id AND m.main_seen
      )
  `)
}
