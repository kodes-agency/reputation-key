// Review context — how long a failed snapshot run waits before its retry (pure).
//
// A snapshot run that ends in a coded, non-restart failure used to be retried
// at the hot interval (15 minutes) every time. On the largest Property one
// attempt is a full double listing, about 150 Google calls, so a failure that
// repeats (a count gap beyond tolerance, a listing that keeps moving) spent
// that quota 96 times a day. The wait now grows with consecutive failures:
//
//   first failure   -> the base interval        (15 minutes)
//   second          -> x4                        (1 hour)
//   third           -> x4                        (4 hours)
//   fourth and on   -> capped                    (6 hours)
//
// The cap keeps a run attempted at least every six hours, so the 24 hour
// freshness rule Goals relies on still holds. A completed run clears the
// failure (`markSyncSucceeded`), which restarts the ladder at the base.
//
// A location over the review or page cap fails identically on every run until
// the cap or the location changes, so it keeps its own 24 hour wait.
//
// No column holds the previous wait; it is derived from the two that exist:
// the retry date written with the previous failure minus the time of that
// failure (`review_sync_state.error_retry_at` - `last_terminal_error_at`).
//
// The rule reads no clock: the caller passes `now`.

/**
 * How long a location over the review or page cap waits before the discovery
 * sweep looks at it again. The cap is a constant a release may raise, and the
 * owner may remove reviews on Google, so it is re-read daily rather than never.
 */
export const LOCATION_TOO_LARGE_RETRY_MS = 24 * 60 * 60 * 1000

/** The longest a repeated failure waits, so a run is attempted at least this often. */
export const SNAPSHOT_FAILURE_MAX_RETRY_MS = 6 * 60 * 60 * 1000

/** Each consecutive failure waits this many times the one before it. */
const SNAPSHOT_FAILURE_BACKOFF_FACTOR = 4

/** What `review_sync_state` holds about the previous failure of a Property. */
export type PreviousSnapshotFailure = Readonly<{
  /** `error_class`: null when no failure is outstanding. */
  errorClass: string | null
  /** `last_terminal_error_at`: when the previous failure was recorded. */
  failedAt: Date | null
  /** `error_retry_at`: the retry date written with the previous failure. */
  retryAt: Date | null
}>

export type SnapshotFailureRetryInput = Readonly<{
  /** The Property's stored failure state, or null when it has no row. */
  previous: PreviousSnapshotFailure | null
  now: Date
  /** The hot interval: the wait after a first failure. */
  baseIntervalMs: number
  /** The failure is `location_too_large`. */
  locationTooLarge: boolean
}>

/** The wait the previous failure was dated with, or null when it cannot be told. */
function previousWaitMs(previous: PreviousSnapshotFailure): number | null {
  if (previous.failedAt === null || previous.retryAt === null) return null
  const waitMs = previous.retryAt.getTime() - previous.failedAt.getTime()
  return waitMs > 0 ? waitMs : null
}

/**
 * The wait before the retry of a failed snapshot run, in milliseconds.
 *
 * A failure that lands before the previous failure's retry came due is the
 * queue retrying the same job (a snapshot failure fails the job, and a job has
 * three attempts), not a new consecutive failure: it keeps the previous wait
 * instead of climbing the ladder once per attempt.
 */
export const snapshotFailureRetryMs = (input: SnapshotFailureRetryInput): number => {
  const { previous, now, baseIntervalMs, locationTooLarge } = input
  if (locationTooLarge) return LOCATION_TOO_LARGE_RETRY_MS
  if (previous === null || previous.errorClass === null) return baseIntervalMs

  // A failure recorded before its time was stored has an unknown wait: assume
  // the base, so this one waits the second rung.
  const waitedMs = Math.min(
    Math.max(previousWaitMs(previous) ?? baseIntervalMs, baseIntervalMs),
    SNAPSHOT_FAILURE_MAX_RETRY_MS,
  )
  const queueRetry =
    previous.retryAt !== null && now.getTime() < previous.retryAt.getTime()
  const nextMs = queueRetry ? waitedMs : waitedMs * SNAPSHOT_FAILURE_BACKOFF_FACTOR
  // A base above the cap (a long discovery interval) is the floor: a repeated
  // failure never waits less than the first one did.
  return Math.max(baseIntervalMs, Math.min(nextMs, SNAPSHOT_FAILURE_MAX_RETRY_MS))
}
