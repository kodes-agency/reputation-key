// Review context — new-review discovery repository port.
//
// The refresh sweep (BQC-1.5) can only ever revisit reviews ALREADY stored,
// so a connected property with no stored review — or one whose newest review
// is nowhere near its 30-day content TTL — is never polled again after the
// import one-shot. This port is the discovery side of that gap: it selects
// CONNECTED, ACTIVE properties whose next poll is due and records the
// per-property due time so a slow or failing property cannot starve the rest.
//
// Content-free: identifiers, timestamps, and an error class only.

import type { DiscoveryActivity } from '../../domain/discovery-backoff'
import type { PreviousSnapshotFailure } from '../../domain/snapshot-failure-backoff'
import type { ReviewProviderSnapshotFailureCode } from './review-provider-snapshot.repository'

export type ReviewDiscoveryCandidate = Readonly<{
  propertyId: string
  organizationId: string
  connectionId: string
  /** Canonical GBP resource name: `accounts/{account}/locations/{location}`. */
  locationName: string
  /**
   * Durable activity evidence for the backoff ladder. The sweep computes this
   * property's own next-due time from it, so a quiet property backs off
   * without the sweep needing a second round-trip per candidate.
   */
  activity: DiscoveryActivity
  /**
   * When this property's newest COMPLETED reconciliation was evaluated: the
   * latest `review_google_reputation_snapshot_facts.evaluated_at` for its
   * CURRENT source epoch, or null when the epoch has none yet (a new or
   * relinked property). Only the timestamp is read, never fact content.
   */
  lastReconciledAt: Date | null
  /**
   * A coded failure is recorded for this property (`review_sync_state.error_class`
   * is set) and no completed run has cleared it. Such a look is never skipped:
   * it is the failure's retry.
   */
  hasOutstandingFailure: boolean
}>

/** What one `pullLooksForward` call did, by Property: content-free counts. */
export type PullLooksForwardResult = Readonly<{
  /** Next look moved up to `now`: it will run at the next discovery sweep. */
  pulledForward: number
  /** A completed reconciliation inside the window already covers the Property. */
  skippedRecent: number
  /** A failure is waiting for its backoff retry date; the look is not moved. */
  skippedBackoff: number
}>

export type ReviewDiscoveryRepository = Readonly<{
  /**
   * Keyset-paged batch of Google-connected, active, non-deleted properties
   * whose discovery poll is due at `due` (never polled, or next-due elapsed)
   * and which have NO in-flight GBP import.
   *
   * Polling a property mid-import is pure waste: the import enqueues its own
   * sync when it completes, and a concurrent sweep sync races the import's
   * snapshot for the same source epoch.
   *
   * Ordered by property id ASC; `cursor` is the last id of the previous
   * batch (exclusive). The strict `id > cursor` predicate never skips or
   * repeats as the cursor advances.
   */
  findDuePropertiesBatch(
    due: Date,
    cursor: string | null,
    limit: number,
  ): Promise<readonly ReviewDiscoveryCandidate[]>

  /** A sync job was accepted for this property: push the next poll to `nextDueAt`. */
  markDiscoveryScheduled(propertyId: string, now: Date, nextDueAt: Date): Promise<void>

  /**
   * A look found a completed reconciliation inside the window and enqueued
   * nothing: push the next look to `nextDueAt`. Writes ONLY the due time (and
   * `updated_at`): nothing was synced, so the success stamp and any failure
   * state are left as they were.
   */
  markDiscoverySkipped(propertyId: string, now: Date, nextDueAt: Date): Promise<void>

  /**
   * Discovery enqueue or provider execution failed for this property: record
   * the bounded failure class, the time of the failure and the retry date, and
   * defer the next poll to `nextDueAt`. The retry date and the next poll are
   * written together, so the sweep never pulls a failure ahead of its backoff.
   */
  markDiscoveryDeferred(
    propertyId: string,
    now: Date,
    nextDueAt: Date,
    errorClass: ReviewProviderSnapshotFailureCode | 'enqueue_failed',
  ): Promise<void>

  /**
   * The Property's recorded failure: its class, when it was recorded and the
   * retry date written with it. Null when the Property has no sync state row.
   * The snapshot job derives the wait of the next failure from it
   * (domain/snapshot-failure-backoff.ts).
   */
  findFailureState(propertyId: string): Promise<PreviousSnapshotFailure | null>

  /** A provider snapshot completed: clear its durable failure state. */
  markSyncSucceeded(propertyId: string): Promise<void>

  /**
   * The content refresh sweep found reviews of these Properties about to
   * expire. For each one whose newest completed reconciliation (current source
   * epoch) is not newer than `reconciledSince`, move its next look up to
   * `now` so the normal discovery sweep runs it, with its spread, skip rule
   * and failure backoff. Enqueues nothing itself.
   *
   * A Property with a recent reconciliation is left alone: that listing
   * already refreshed every review Google lists, so one that still expires
   * was not listed. A Property whose failure retry date is still ahead is left
   * alone too. A Property with no state row, or one already due, needs no move.
   */
  pullLooksForward(
    propertyIds: readonly string[],
    now: Date,
    reconciledSince: Date,
  ): Promise<PullLooksForwardResult>
}>
