// Review context — what a head check reads and records.
//
// A head check reads Google's newest page and compares it with RepKey's stored
// copies (domain/head-check.ts). In dark mode it writes nothing about reviews;
// the one write is a row in the bounded sync-run history so the comparison can
// be queried for the history's 30-day retention. In persist mode (ADR 0055,
// note of 2026-10-21 (d)) it also stores the reviews that differ, through the
// ordinary observation writer, and Google's own count and average as a fact
// that is not a completed listing (`recordHeadFact`).
//
// Content-free: counts, timestamps and closed codes. The Property is named only
// to key the history row.

import type { HeadComparison, HeadStoredCopy } from '../../domain/head-check'
import type { HeadFactNewest } from '../../domain/head-persist'

/** How one head check ended. A closed list: logs and history rows carry these. */
export type ReviewHeadCheckOutcome =
  /** Google's page was read, was in order, and was compared. */
  | 'compared'
  /** Google's page was not newest-updated first, so nothing was compared. */
  | 'order_violation'
  /** The Property has a recorded failure; the full retry handles it. */
  | 'skipped_outstanding_failure'
  | 'rate_limited'
  | 'provider_unavailable'
  /** Google answered 404 or 400 for the location. */
  | 'provider_rejected'
  | 'authorization_changed'
  | 'malformed_response'
  /** This process has no Google provider. */
  | 'no_provider'
  /** Anything else, including a failed read of the stored copies. */
  | 'error'

export type ReviewHeadBaseline = Readonly<{
  /** Stored copies of the requested reviews that exist for the Property. */
  copies: readonly HeadStoredCopy[]
  /** Reviews the Property holds live content for in its current source epoch. */
  storedLiveCount: number
  /** Mean rating of those reviews; null when there are none. */
  storedAverageRating: number | null
}>

/** `review_sync_runs.mode` of a head check: `head_dark` stores nothing, `head` stores. */
export type ReviewHeadRunMode = 'head_dark' | 'head'

/** What a persisting check did with a page it compared. Counts and closed codes. */
export type ReviewHeadPersistence = Readonly<{
  outcome:
    /** The reviews that differ were written (some may have failed: see `failed`). */
    | 'stored'
    /** A snapshot run is active for the Property: the check compared and stored nothing. */
    | 'skipped_snapshot_active'
    /** The epoch has no completed listing yet. */
    | 'skipped_no_listing'
    /** The Property's source epoch moved after the page was read. */
    | 'skipped_epoch_moved'
    /** A read or write the check needed failed before it stored anything. */
    | 'unavailable'
  /** Reviews written that Google showed and RepKey did not hold. */
  storedNew: number
  /** Reviews written that RepKey already held (an edit, a reply, a refresh). */
  storedOther: number
  /** Reviews whose write failed; the next look retries them. */
  failed: number
  /** Google's count and average were stored as a head fact. */
  factWritten: boolean
}>

export type ReviewHeadRunRecord = Readonly<{
  propertyId: string
  sourceEpoch: number
  startedAt: Date
  completedAt: Date
  /** Defaults to `head_dark`. */
  mode?: ReviewHeadRunMode
  outcome: ReviewHeadCheckOutcome
  /** Present exactly when the outcome is `compared`. */
  comparison: HeadComparison | null
  /** Present only for a check that ran in persist mode and compared a page. */
  persistence?: ReviewHeadPersistence | null
}>

/** Where a persisting check stands before it writes anything. */
export type ReviewHeadPersistState = Readonly<{
  /** The epoch has a fact that proves a completed listing (`listing_complete`). */
  hasCompletedListing: boolean
  /** A snapshot run of the epoch is scanning, confirming or deleting. */
  snapshotActive: boolean
  /** The newest fact of ANY kind for the epoch, by when Google's numbers were read. */
  newestFact: HeadFactNewest | null
}>

export type ReviewHeadFactInput = Readonly<{
  organizationId: string
  propertyId: string
  sourceEpoch: number
  /** A fresh identifier for the fact: a head fact has no snapshot run. */
  factId: string
  reviewCount: number
  averageRating: number | null
  /** When Google's numbers were read. */
  numbersObservedAt: Date
}>

export type ReviewHeadCheckRepository = Readonly<{
  /** A coded failure is recorded for the Property and no completed run cleared it. */
  hasOutstandingFailure(propertyId: string): Promise<boolean>
  readBaseline(
    input: Readonly<{
      organizationId: string
      propertyId: string
      sourceEpoch: number
      externalIds: readonly string[]
    }>,
  ): Promise<ReviewHeadBaseline>
  /** Persist mode: the gate, the active-run check and the newest fact, read together. */
  readPersistState(
    input: Readonly<{
      organizationId: string
      propertyId: string
      sourceEpoch: number
      now: Date
    }>,
  ): Promise<ReviewHeadPersistState>
  /**
   * Persist mode: store Google's count and average as a head fact
   * (`listing_complete = false`) and publish the same verified-snapshot event a
   * completed run publishes, in one transaction.
   */
  recordHeadFact(input: ReviewHeadFactInput): Promise<void>
  /** One row in the bounded sync-run history, `head_dark` or `head`. */
  recordRun(run: ReviewHeadRunRecord): Promise<void>
}>
