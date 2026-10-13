// Injectable clock — the single source of "now" for domain-correctness paths.
// Threaded from the composition root into every adapter/repo/use-case/job that
// reads time for correctness (SLA cutoffs, expiry, streaks, period boundaries).
//
// Per ADR 0017: bare `new Date()` / `Date.now()` is forbidden in correctness
// paths. Framework/observability timestamps (request tracing, cache TTL) may
// stay on wall-clock.
//
// The composition root constructs one prod instance: `() => new Date()`.
// Tests and simulations inject a controllable clock to fast-forward time.

/** A clock returns the current instant. `() => Date` matches the existing
 *  convention already used by badge evaluation, health-check, and the
 *  review/goal jobs. */
export type Clock = () => Date

/** The smallest step a `Date` can tell apart. */
const SMALLEST_CLOCK_STEP_MS = 1

/**
 * `now`, or the instant just after `earlier` when the clock has not moved past
 * it. For a write that has to be stamped later than the one it follows: an
 * interval cannot end at the instant it began.
 */
export function strictlyAfter(earlier: Date, now: Date): Date {
  return now.getTime() > earlier.getTime()
    ? now
    : new Date(earlier.getTime() + SMALLEST_CLOCK_STEP_MS)
}
