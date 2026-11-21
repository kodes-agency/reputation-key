// Review context — "a completed run has listed this epoch's history", as SQL.
//
// Read inside the terminal transaction of a snapshot run
// (`endsFirstHistoryImport`) and when the history cutoff is read for the
// writer (`readHistoryCutoffRow`). Kept apart from the repository so the
// repository does not grow past its file-length baseline.

import { sql } from 'drizzle-orm'

/**
 * "A completed run has listed this epoch's history": the verified reputation
 * fact of a run that evaluated at or after the epoch's cutoff.
 *
 * Only a fact that PROVES a listing counts (`listing_complete`). A head check
 * that stores (ADR 0055, note of 2026-10-21 (d)) writes facts from one read of
 * Google's newest page; they carry Google's own count and average but list
 * nothing, so they must never close the first import.
 *
 * The cutoff is written by `transaction_timestamp()` and keeps PostgreSQL's
 * microseconds. `evaluated_at` does NOT: `recordVerifiedSnapshotFact` reads
 * that instant into a JavaScript Date, which is milliseconds, and writes it
 * back truncated. Two instants inside the same millisecond therefore compare
 * BACKWARDS — a cutoff at .06308 and a completion at .063080 stored as .063.
 * An import admitted and completed in the same millisecond then looked
 * unlisted forever, so its Inbox items stayed history and, with the import
 * summary, every later completed poll re-announced it. Comparing at the
 * precision both values actually carry is the honest fix.
 */
export const historyListedSince = sql`EXISTS (
  SELECT 1
  FROM review_google_reputation_snapshot_facts listing
  WHERE listing.organization_id = epoch.organization_id
    AND listing.property_id = epoch.property_id
    AND listing.source_epoch = epoch.source_epoch
    AND listing.listing_complete
    AND listing.evaluated_at >= date_trunc('milliseconds', epoch.cutoff_at)
)`
