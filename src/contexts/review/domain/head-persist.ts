// Review context — when a head check that stores also stores Google's numbers.
//
// A head check in `persist` mode reads Google's newest page and writes the
// reviews whose stored copy differs (domain/head-check.ts). It also records
// Google's own total and average as a reputation fact, so Current on Google and
// Goals follow Google between two completed listings. The fact is not a
// listing: it says what Google reports, not that RepKey holds that many reviews
// (`listing_complete = false`, ADR 0055 note of 2026-10-21 (d)).
//
// Pure: it reads no clock; the caller passes the read time.

/**
 * A head fact is written at least this often even when Google's numbers did
 * not move, so the age of Current on Google (and the Goals 24 hour freshness
 * rule) never lapses just because a Property is quiet.
 */
export const HEAD_FACT_HEARTBEAT_MS = 6 * 60 * 60 * 1000

/** The most reviews a fact can hold (`review_google_reputation_snapshot_value_valid`). */
export const HEAD_FACT_MAX_REVIEW_COUNT = 10_000

/** The newest fact of the epoch, of any kind, as far as the decision needs it. */
export type HeadFactNewest = Readonly<{
  reviewCount: number
  averageRating: number | null
  /** When Google's numbers in that fact were read. */
  observedAt: Date
}>

export type HeadFactInput = Readonly<{
  /** When the page was read: after the provider's response, before any store. */
  readAt: Date
  googleTotal: number
  googleAverage: number | null
  /** The epoch has a `listing_complete` fact: a completed listing exists. */
  hasCompletedListing: boolean
  newest: HeadFactNewest | null
}>

export type HeadFactDecision =
  | Readonly<{
      write: true
      reason: 'changed' | 'heartbeat'
      /**
       * When Google’s numbers are stamped as read: the read time, or one
       * millisecond past the newest fact when the read is not later, so two
       * facts of one Property never share an instant (the Current on Google
       * consumer refuses a tie as ambiguous).
       */
      numbersObservedAt: Date
    }>
  | Readonly<{
      write: false
      reason: 'unchanged' | 'no_completed_listing' | 'not_storable'
    }>

/** The table's own rule: zero reviews has no average, otherwise 1..10,000 with 0..5. */
const isStorable = (total: number, average: number | null): boolean => {
  if (!Number.isInteger(total) || total < 0 || total > HEAD_FACT_MAX_REVIEW_COUNT) {
    return false
  }
  if (total === 0) return average === null
  return average !== null && Number.isFinite(average) && average >= 0 && average <= 5
}

const sameAverage = (a: number | null, b: number | null): boolean =>
  a === null || b === null ? a === b : Math.abs(a - b) < 1e-9

/**
 * Whether to store Google's numbers from this head page.
 *
 * Never before the epoch's first completed listing (the gate): until then the
 * epoch has no listing of its own to put Google's numbers beside. Otherwise
 * when Google's total or average differs from the newest fact of ANY kind, or
 * when that fact is six hours old or more (the heartbeat). A count Google
 * reports over the cap, or an average that does not match its count, cannot be
 * stored and is skipped, not clamped.
 */
export const decideHeadFact = (input: HeadFactInput): HeadFactDecision => {
  if (!input.hasCompletedListing) return { write: false, reason: 'no_completed_listing' }
  if (!isStorable(input.googleTotal, input.googleAverage)) {
    return { write: false, reason: 'not_storable' }
  }
  const newest = input.newest
  const changed =
    newest === null ||
    newest.reviewCount !== input.googleTotal ||
    !sameAverage(newest.averageRating, input.googleAverage)
  const quiet =
    newest !== null &&
    input.readAt.getTime() - newest.observedAt.getTime() >= HEAD_FACT_HEARTBEAT_MS
  if (!changed && !quiet) return { write: false, reason: 'unchanged' }
  const earliest = newest === null ? 0 : newest.observedAt.getTime() + 1
  return {
    write: true,
    reason: changed ? 'changed' : 'heartbeat',
    numbersObservedAt: new Date(Math.max(input.readAt.getTime(), earliest)),
  }
}
