// Review context — what a head check reads and records.
//
// A head check reads Google's newest page and compares it with RepKey's stored
// copies (domain/head-check.ts). In dark mode it writes nothing about reviews;
// the one write is a row in the bounded sync-run history so the comparison can
// be queried for the history's 30-day retention.
//
// Content-free: counts, timestamps and closed codes. The Property is named only
// to key the history row.

import type { HeadComparison, HeadStoredCopy } from '../../domain/head-check'

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

export type ReviewHeadRunRecord = Readonly<{
  propertyId: string
  sourceEpoch: number
  startedAt: Date
  completedAt: Date
  outcome: ReviewHeadCheckOutcome
  /** Present exactly when the outcome is `compared`. */
  comparison: HeadComparison | null
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
  /** One `head_dark` row in the bounded sync-run history. */
  recordRun(run: ReviewHeadRunRecord): Promise<void>
}>
