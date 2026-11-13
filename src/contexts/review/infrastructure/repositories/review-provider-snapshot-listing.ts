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
 * How many completed runs a Review stays out of the removal candidates after a
 * direct read found it on Google although the listing left it out: about a
 * week at the default six-hour window. Each such read ends its run as a
 * listing that moved, so without the hold a Review Google keeps out of its
 * listing would cost a wasted listing and a reviews.get every other run.
 * Should it be deleted meanwhile, it is removed once the hold ends.
 */
export const UNLISTED_REVIEW_HOLD_RUNS = 28

/**
 * The last thing that saw this mapping's Review was a run's direct read that
 * found it after that run's listing left it out (the candidate it observed),
 * not a listing. A later listing of it moves `last_seen_snapshot_run_id` on.
 */
export const foundUnlistedByLastRun = sql`
  EXISTS (
    SELECT 1 FROM review_provider_deletion_candidates found
    WHERE found.run_id = s.last_seen_snapshot_run_id
      AND found.review_id = s.review_id
      AND found.state = 'observed'
  )`

/** A hold counted from the runs themselves: completed runs of the epoch that
 * started after the run that found the Review, never below zero. */
export const legacyHoldRunsLeft = sql`
  GREATEST(${UNLISTED_REVIEW_HOLD_RUNS} - (
    SELECT count(*) FROM review_provider_snapshot_runs later
    JOIN review_provider_snapshot_runs found_run
      ON found_run.id = s.last_seen_snapshot_run_id
    WHERE later.organization_id = s.organization_id
      AND later.property_id = s.property_id
      AND later.source_epoch = s.source_epoch
      AND later.state = 'completed'
      AND later.started_at > found_run.started_at
  )::int, 0)`

/**
 * The completed runs this mapping's hold still has to wait, or NULL when the
 * last thing that saw its Review was a listing (or nothing found it unlisted).
 * The count lives on the mapping (`unlisted_hold_runs_left`) because retention
 * deletes old runs, and with them the run that found the Review and the
 * candidate it observed. A hold without the count (one begun before the
 * count existed) is read from that run while the run is kept, and the
 * retention sweep writes the count before it deletes the run.
 */
const holdRunsLeft = sql`
  CASE
    WHEN s.unlisted_hold_runs_left IS NOT NULL THEN s.unlisted_hold_runs_left
    WHEN ${foundUnlistedByLastRun} THEN ${legacyHoldRunsLeft}
  END`

/**
 * Whether a direct read already found this Review left out of an earlier run's
 * listing, and no listing has seen it since: Google keeps returning it but not
 * listing it, which is worth an alert once the hold has run out.
 */
export async function foundUnlistedBefore(
  tx: Tx,
  run: RunRow,
  reviewId: string,
): Promise<boolean> {
  const rows = await tx.execute(sql`
    SELECT 1 FROM review_provider_subjects s
    WHERE s.organization_id = ${run.organizationId}
      AND s.property_id = ${run.propertyId}
      AND s.source_epoch = ${run.sourceEpoch}
      AND s.review_id = ${reviewId}
      AND s.last_seen_snapshot_run_id IS DISTINCT FROM ${run.id}
      AND (${holdRunsLeft}) IS NOT NULL
  `)
  return rows.rows.length > 0
}

/**
 * This run's direct read found a pending candidate on Google although the
 * run's listing left it out, and has just made the run the mapping's last
 * sighting: the candidate is kept as observed and the hold begins. False when
 * the candidate is no longer pending.
 */
export async function holdFoundUnlisted(
  tx: Tx,
  run: RunRow,
  reviewId: string,
): Promise<boolean> {
  const observed = await tx.execute(sql`
    UPDATE review_provider_deletion_candidates
    SET state = 'observed', updated_at = transaction_timestamp()
    WHERE run_id = ${run.id} AND review_id = ${reviewId} AND state = 'pending'
  `)
  if (observed.rowCount !== 1) return false
  await tx.execute(sql`
    UPDATE review_provider_subjects
    SET unlisted_hold_runs_left = ${UNLISTED_REVIEW_HOLD_RUNS},
        updated_at = transaction_timestamp()
    WHERE organization_id = ${run.organizationId}
      AND property_id = ${run.propertyId}
      AND source_epoch = ${run.sourceEpoch}
      AND review_id = ${reviewId}
      AND last_seen_snapshot_run_id = ${run.id}
  `)
  return true
}

/**
 * Count the completing run against every hold in its Property source epoch.
 * Only one run of an epoch is active at a time, so every run that completes
 * after a hold began started after the run that began it.
 */
export async function countRunAgainstHolds(tx: Tx, run: RunRow): Promise<void> {
  await tx.execute(sql`
    UPDATE review_provider_subjects
    SET unlisted_hold_runs_left = unlisted_hold_runs_left - 1,
        updated_at = transaction_timestamp()
    WHERE organization_id = ${run.organizationId}
      AND property_id = ${run.propertyId}
      AND source_epoch = ${run.sourceEpoch}
      AND unlisted_hold_runs_left > 0
      AND last_seen_snapshot_run_id IS DISTINCT FROM ${run.id}
  `)
}

/**
 * What a complete main listing says is missing. A stored Review absent from
 * it becomes a removal candidate when an earlier run already missed it at
 * least 15 minutes before this one started, unless a direct read found it
 * left out of a listing fewer than {@link UNLISTED_REVIEW_HOLD_RUNS} completed
 * runs ago; every absent Review keeps (or gets) its first miss. Called only
 * for a listing that matches Google's total exactly: a run with a count gap
 * records no miss at all, so no later run can finish a removal on evidence
 * that listing gave.
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
      AND COALESCE((${holdRunsLeft}), 0) = 0
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

/**
 * A completed run asks the discovery sweep for the next full read when a
 * stored Review has a first miss this run's listing cannot confirm (the miss
 * is less than 15 minutes older than the run's start), so the listing that can
 * confirm it comes six hours after this one rather than a whole
 * reconciliation window later (Google's first page never shows a deletion).
 * The ask follows the miss, not the run that recorded it, and not any other
 * request: a run that recorded a first miss and then failed leaves the asking
 * to the run that completes after it, whatever else was requested between. A
 * later listing that misses the same Review again does not ask twice, because
 * the miss is by then old enough for that listing to confirm. Called by the
 * transaction that completes the run, so the request carries the same instant
 * as the run's verified fact; the sweep counts a request made no earlier than
 * the last listing and runs it once that listing is six hours old. Writes
 * nothing for a Property the sweep has never looked at.
 */
async function requestFullReadAfterFirstMiss(tx: Tx, run: RunRow): Promise<void> {
  await tx.execute(sql`
    UPDATE review_sync_state st
    SET full_read_requested_at = GREATEST(st.full_read_requested_at, transaction_timestamp()),
        updated_at = transaction_timestamp()
    WHERE st.property_id = ${run.propertyId}
      AND st.source = 'google'
      AND EXISTS (
        SELECT 1 FROM review_provider_subjects s
        WHERE s.organization_id = ${run.organizationId}
          AND s.property_id = ${run.propertyId}
          AND s.source_epoch = ${run.sourceEpoch}
          AND s.state IN ('linked', 'source_expired')
          AND s.first_missing_at IS NOT NULL
          AND s.first_missing_at > ${run.startedAt}::timestamptz - interval '15 minutes'
      )
  `)
}

/**
 * A completed run whose Google total is no lower than the Reviews the Property
 * now holds live clears a drop in Google's total that head checks stamped: the
 * listing either removed the deleted Review or found nothing missing. Without
 * this, a Property whose looks are all full listings (no head check to see the
 * counts level) would keep an old stamp. Writes only when a stamp exists.
 */
async function clearCountDropAfterListing(tx: Tx, run: RunRow): Promise<void> {
  if (run.expectedTotal == null) return
  await tx.execute(sql`
    UPDATE review_sync_state
    SET count_drop_seen_at = NULL,
        count_drop_checked_at = NULL,
        updated_at = transaction_timestamp()
    WHERE property_id = ${run.propertyId}
      AND source = 'google'
      AND count_drop_seen_at IS NOT NULL
      AND ${run.expectedTotal} >= (
        SELECT count(*) FROM reviews r
        JOIN review_source_contents c
          ON c.review_id = r.id
         AND c.organization_id = r.organization_id
         AND c.property_id = r.property_id
        WHERE r.organization_id = ${run.organizationId}
          AND r.property_id = ${run.propertyId}
          AND r.platform = 'google'
          AND r.source_epoch = ${run.sourceEpoch}
          AND r.source_content_state = 'active'
      )
  `)
}

/** What the transaction that completes a run does for discovery after its listing. */
export async function followCompletedListing(tx: Tx, run: RunRow): Promise<void> {
  await requestFullReadAfterFirstMiss(tx, run)
  await clearCountDropAfterListing(tx, run)
}

/**
 * Whether a pending candidate's mapping was moved to a newer revision than the
 * candidate was found under, by a head check or a push after the run began:
 * the Review was edited on Google after the listing that missed it, so the
 * candidate is stale and nothing may be removed on it.
 */
export async function candidateEditedSinceListing(
  tx: Tx,
  run: RunRow,
  candidate: Readonly<{ reviewId: string; expectedSourceRevision: number }>,
): Promise<boolean> {
  const rows = await tx.execute(sql`
    SELECT 1
    FROM review_provider_deletion_candidates c
    JOIN review_provider_subjects s
      ON s.organization_id = ${run.organizationId}
      AND s.property_id = ${run.propertyId}
      AND s.source_epoch = ${run.sourceEpoch}
      AND s.review_id = c.review_id
    WHERE c.run_id = ${run.id}
      AND c.review_id = ${candidate.reviewId}
      AND c.expected_source_revision = ${candidate.expectedSourceRevision}
      AND c.state = 'pending'
      AND s.state = 'linked'
      AND s.last_source_revision > c.expected_source_revision
      AND s.last_observed_at > ${run.startedAt}
  `)
  return rows.rows.length > 0
}
