// Review context — when a discovery look may skip the full snapshot.
//
// ADR 0055 decision 5 only asks that a quiet healthy Property is reconciled
// within six hours. Push delivers new reviews in the meantime, so a look that
// finds a COMPLETED reconciliation inside that window has nothing to add and
// enqueues nothing. The rule is pure: it reads no clock; the sweep passes
// `now` and the ladder interval this look would be rescheduled with.
//
// A window wider than a day (REVIEW_RECONCILE_WITHIN_HOURS, up to fourteen
// days) is safe only while head checks keep Google's newest page stored: a
// Property whose newest page no persisting head check stored recently is
// listed in full once its last listing is a day old. At a day or less the
// cover changes nothing. A requested full read (the content refresh, or a head
// check that found its whole page changed) runs once, when the last listing is
// six hours old, so requests never cost more than one listing per six hours.

import {
  HEAD_COVERAGE_FRESH_MS,
  RECONCILE_WITHIN_HOURS_MAX,
  UNCOVERED_RECONCILE_WITHIN_MS,
} from '#/shared/domain/push-health'

const HOUR_MS = 60 * 60 * 1000

/**
 * A quiet healthy Property is reconciled at least this often (ADR 0055
 * decision 5). Its own constant: it equals the ladder cap
 * (`DISCOVERY_MAX_INTERVAL_MS`) today, but the cap prices a poll interval and
 * this is a guarantee about completed reconciliations.
 */
export const DISCOVERY_RECONCILE_WITHIN_MS = 6 * HOUR_MS

/** No configured window stretches a Property's listings further apart than this. */
export const DISCOVERY_RECONCILE_WITHIN_MAX_MS = RECONCILE_WITHIN_HOURS_MAX * HOUR_MS

/** A requested full read waits until the last completed listing is this old. */
export const FULL_READ_REQUEST_SPACING_MS = 6 * HOUR_MS

export type DiscoveryFullReason =
  | 'skip_disabled'
  | 'failure_retry'
  | 'no_reconciliation'
  | 'due'
  /** A full read was requested after the last listing, which is now six hours old. */
  | 'requested'
  /** The window is over a day, no head check covers the newest page, and the listing is a day old. */
  | 'uncovered'

export type DiscoveryLook =
  | Readonly<{ kind: 'full'; reason: DiscoveryFullReason }>
  /**
   * `headCheck` is present (true) only when head checks are on: the skipped
   * look is then followed by a one-call check of Google's newest page.
   */
  | Readonly<{ kind: 'skip'; nextDueAt: Date; headCheck?: true }>

export type DiscoveryLookInput = Readonly<{
  /** Latest completed reconciliation of the Property's CURRENT source epoch. */
  lastReconciledAt: Date | null
  /** A coded failure is recorded and has not been cleared by a completed run. */
  hasOutstandingFailure: boolean
  skipEnabled: boolean
  /**
   * A skipped look is covered by a head check, and the next look is the ladder
   * interval away. Defaults to off, which is the single wake-up described below.
   */
  headChecks?: boolean
  /**
   * How recent a completed reconciliation must be for the look to skip
   * (`REVIEW_RECONCILE_WITHIN_HOURS`). Defaults to `DISCOVERY_RECONCILE_WITHIN_MS`
   * and is never wider than `DISCOVERY_RECONCILE_WITHIN_MAX_MS`.
   */
  reconcileWithinMs?: number
  /** When a persisting head check last stored all of Google's newest page. */
  headCoveredAt?: Date | null
  /** When a full read was last requested ahead of the window. */
  fullReadRequestedAt?: Date | null
  now: Date
  /** The ladder interval this look would be rescheduled with. */
  interval: number
}>

/** When a pending request may run: six hours after the listing it postdates. */
const requestDueAt = (
  input: DiscoveryLookInput,
  lastReconciledAt: number,
): number | null => {
  const requestedAt = input.fullReadRequestedAt?.getTime() ?? null
  if (requestedAt === null || requestedAt <= lastReconciledAt) return null
  return lastReconciledAt + FULL_READ_REQUEST_SPACING_MS
}

/**
 * The earlier deadline an uncovered Property gets when the window is wider than
 * a day; null when the window is a day or less or a head check covers it.
 */
const uncoveredDeadline = (
  input: DiscoveryLookInput,
  lastReconciledAt: number,
  withinMs: number,
): number | null => {
  if (withinMs <= UNCOVERED_RECONCILE_WITHIN_MS) return null
  const coveredAt = input.headCoveredAt?.getTime() ?? null
  if (coveredAt !== null && coveredAt > input.now.getTime() - HEAD_COVERAGE_FRESH_MS) {
    return null
  }
  return lastReconciledAt + UNCOVERED_RECONCILE_WITHIN_MS
}

/**
 * Decide whether this look runs a full snapshot or skips.
 *
 * Full when skipping is off, a failure is waiting for its retry (so the retry
 * and the clearing of the failure happen exactly as they always did), nothing
 * has been reconciled in this epoch, the NEXT look would land at or past the
 * window's deadline, a request postdating the last listing has waited six
 * hours since it, or (window over a day only) no head check covers the newest
 * page and the next look would land a day or more after the last listing.
 * Otherwise skip, and wake once at the instant the look becomes full:
 * `max(now + interval, earliest deadline - interval)`, or the instant a pending
 * request may run. With head checks on, each skipped look is followed by a
 * head check and the next look is simply `now + interval`; the same rules make
 * the look at the deadline full.
 */
export const discoveryLookFor = (input: DiscoveryLookInput): DiscoveryLook => {
  const { lastReconciledAt, hasOutstandingFailure, skipEnabled, now, interval } = input
  if (!skipEnabled) return { kind: 'full', reason: 'skip_disabled' }
  if (hasOutstandingFailure) return { kind: 'full', reason: 'failure_retry' }
  if (lastReconciledAt === null) return { kind: 'full', reason: 'no_reconciliation' }

  const reconciledAt = lastReconciledAt.getTime()
  const withinMs = Math.min(
    input.reconcileWithinMs ?? DISCOVERY_RECONCILE_WITHIN_MS,
    DISCOVERY_RECONCILE_WITHIN_MAX_MS,
  )
  const nextLookAt = now.getTime() + interval
  const deadline = reconciledAt + withinMs
  if (deadline <= nextLookAt) return { kind: 'full', reason: 'due' }

  const requestAt = requestDueAt(input, reconciledAt)
  if (requestAt !== null && requestAt <= now.getTime()) {
    return { kind: 'full', reason: 'requested' }
  }

  const uncoveredAt = uncoveredDeadline(input, reconciledAt, withinMs)
  if (uncoveredAt !== null && uncoveredAt <= nextLookAt) {
    return { kind: 'full', reason: 'uncovered' }
  }

  if (input.headChecks === true) {
    return { kind: 'skip', nextDueAt: new Date(nextLookAt), headCheck: true }
  }
  const wakeAt = Math.min(
    Math.min(deadline, uncoveredAt ?? Infinity) - interval,
    requestAt ?? Infinity,
  )
  return { kind: 'skip', nextDueAt: new Date(Math.max(nextLookAt, wakeAt)) }
}
