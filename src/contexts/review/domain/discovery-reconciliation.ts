// Review context — when a discovery look may skip the full snapshot.
//
// ADR 0055 decision 5 only asks that a quiet healthy Property is reconciled
// within six hours. Push delivers new reviews in the meantime, so a look that
// finds a COMPLETED reconciliation inside that window has nothing to add and
// enqueues nothing. The rule is pure: it reads no clock; the sweep passes
// `now` and the ladder interval this look would be rescheduled with.

/**
 * A quiet healthy Property is reconciled at least this often (ADR 0055
 * decision 5). Its own constant: it equals the ladder cap
 * (`DISCOVERY_MAX_INTERVAL_MS`) today, but the cap prices a poll interval and
 * this is a guarantee about completed reconciliations.
 */
export const DISCOVERY_RECONCILE_WITHIN_MS = 6 * 60 * 60 * 1000

export type DiscoveryFullReason =
  'skip_disabled' | 'failure_retry' | 'no_reconciliation' | 'due'

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
  now: Date
  /** The ladder interval this look would be rescheduled with. */
  interval: number
}>

/**
 * Decide whether this look runs a full snapshot or skips.
 *
 * Full when skipping is off, a failure is waiting for its retry (so the retry
 * and the clearing of the failure happen exactly as they always did), nothing
 * has been reconciled in this epoch, or the NEXT look would land at or past
 * the six-hour deadline. Otherwise skip, and wake once at the instant the look
 * becomes full: `max(now + interval, lastReconciledAt + 6h - interval)`. With
 * head checks on, each skipped look is followed by a head check and the next
 * look is simply `now + interval`; the same rule makes the look at the deadline
 * full.
 */
export const discoveryLookFor = (input: DiscoveryLookInput): DiscoveryLook => {
  const { lastReconciledAt, hasOutstandingFailure, skipEnabled, now, interval } = input
  if (!skipEnabled) return { kind: 'full', reason: 'skip_disabled' }
  if (hasOutstandingFailure) return { kind: 'full', reason: 'failure_retry' }
  if (lastReconciledAt === null) return { kind: 'full', reason: 'no_reconciliation' }

  const deadline = lastReconciledAt.getTime() + DISCOVERY_RECONCILE_WITHIN_MS
  if (deadline <= now.getTime() + interval) return { kind: 'full', reason: 'due' }

  if (input.headChecks === true) {
    return {
      kind: 'skip',
      nextDueAt: new Date(now.getTime() + interval),
      headCheck: true,
    }
  }
  return {
    kind: 'skip',
    nextDueAt: new Date(Math.max(now.getTime() + interval, deadline - interval)),
  }
}
