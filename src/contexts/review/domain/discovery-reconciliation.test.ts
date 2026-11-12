// Review context — the rule that lets a discovery look skip a Property whose
// last COMPLETED reconciliation is recent.

import { describe, it, expect } from 'vitest'
import {
  DISCOVERY_LOOK_MAX_GAP_MS,
  HEAD_COVERAGE_FRESH_MS,
} from '#/shared/domain/push-health'
import { DISCOVERY_MAX_INTERVAL_MS } from './discovery-backoff'
import {
  DISCOVERY_RECONCILE_WITHIN_MAX_MS,
  DISCOVERY_RECONCILE_WITHIN_MS,
  FULL_READ_REQUEST_SPACING_MS,
  discoveryLookFor,
  type DiscoveryLook,
} from './discovery-reconciliation'

const NOW = new Date('2026-10-21T12:00:00.000Z')
const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const HOT_MS = 15 * MINUTE_MS
const WARM_MS = HOUR_MS
const COLD_MS = 6 * HOUR_MS

const ago = (ms: number, from: Date = NOW): Date => new Date(from.getTime() - ms)

type LookInput = Parameters<typeof discoveryLookFor>[0]

const look = (over: Partial<LookInput> = {}): DiscoveryLook =>
  discoveryLookFor({
    lastReconciledAt: ago(HOUR_MS),
    hasOutstandingFailure: false,
    skipEnabled: true,
    now: NOW,
    interval: HOT_MS,
    ...over,
  })

describe('DISCOVERY_RECONCILE_WITHIN_MS', () => {
  it('is six hours, the bound ADR 0055 decision 5 puts on a quiet healthy Property', () => {
    // ADR 0055 decision 5: a quiet healthy Property is reconciled within six
    // hours. It is its own constant: it happens to equal the ladder cap today,
    // but the two answer different questions.
    expect(DISCOVERY_RECONCILE_WITHIN_MS).toBe(6 * HOUR_MS)
    expect(DISCOVERY_RECONCILE_WITHIN_MS).toBe(DISCOVERY_MAX_INTERVAL_MS)
  })
})

describe('discoveryLookFor: when the look is full', () => {
  it('is full with reason no_reconciliation when the current epoch has no completed run', () => {
    expect(look({ lastReconciledAt: null })).toEqual({
      kind: 'full',
      reason: 'no_reconciliation',
    })
  })

  it('is full with reason skip_disabled whatever the facts say', () => {
    expect(look({ skipEnabled: false })).toEqual({
      kind: 'full',
      reason: 'skip_disabled',
    })
  })

  it('is full with reason failure_retry when a failure is outstanding, even right after a reconciliation', () => {
    expect(
      look({ hasOutstandingFailure: true, lastReconciledAt: ago(MINUTE_MS) }),
    ).toEqual({
      kind: 'full',
      reason: 'failure_retry',
    })
  })

  it('reports skip_disabled before failure_retry before no_reconciliation', () => {
    expect(
      look({ skipEnabled: false, hasOutstandingFailure: true, lastReconciledAt: null }),
    ).toEqual({ kind: 'full', reason: 'skip_disabled' })
    expect(look({ hasOutstandingFailure: true, lastReconciledAt: null })).toEqual({
      kind: 'full',
      reason: 'failure_retry',
    })
  })

  it('is full with reason due once the next look would land past the six-hour deadline', () => {
    expect(look({ lastReconciledAt: ago(6 * HOUR_MS) })).toEqual({
      kind: 'full',
      reason: 'due',
    })
    expect(look({ lastReconciledAt: ago(7 * HOUR_MS) })).toEqual({
      kind: 'full',
      reason: 'due',
    })
  })

  it('is always full on a cold look: its interval already reaches the deadline', () => {
    for (const age of [0, MINUTE_MS, HOUR_MS, 5 * HOUR_MS]) {
      expect(look({ interval: COLD_MS, lastReconciledAt: ago(age) })).toEqual({
        kind: 'full',
        reason: 'due',
      })
    }
  })

  it('is always full when the operator set a base interval above six hours', () => {
    expect(look({ interval: 8 * HOUR_MS, lastReconciledAt: ago(MINUTE_MS) }).kind).toBe(
      'full',
    )
  })
})

describe('discoveryLookFor: when the look is skipped', () => {
  it('skips a hot Property reconciled an hour ago', () => {
    expect(look({ interval: HOT_MS, lastReconciledAt: ago(HOUR_MS) }).kind).toBe('skip')
  })

  it('skips a warm Property reconciled an hour ago', () => {
    expect(look({ interval: WARM_MS, lastReconciledAt: ago(HOUR_MS) }).kind).toBe('skip')
  })

  it('wakes a hot Property once, at the moment its look becomes full', () => {
    const reconciled = ago(HOUR_MS)
    expect(look({ interval: HOT_MS, lastReconciledAt: reconciled })).toEqual({
      kind: 'skip',
      nextDueAt: new Date(reconciled.getTime() + 6 * HOUR_MS - HOT_MS),
    })
  })

  it('wakes a warm Property once, at the moment its look becomes full', () => {
    const reconciled = ago(HOUR_MS)
    expect(look({ interval: WARM_MS, lastReconciledAt: reconciled })).toEqual({
      kind: 'skip',
      nextDueAt: new Date(reconciled.getTime() + 6 * HOUR_MS - WARM_MS),
    })
  })

  it('never wakes sooner than the ladder interval when the deadline is close', () => {
    // 5h50m ago: the deadline is 10 min away, but the ladder interval is 15
    // min, so the wake-up is now + interval (L + 6h - interval is already past).
    // Reconciled 5h40m ago the deadline is 20 min off: still a skip, still now + 15m.
    const reconciled = ago(5 * HOUR_MS + 40 * MINUTE_MS)
    expect(look({ interval: HOT_MS, lastReconciledAt: reconciled })).toEqual({
      kind: 'skip',
      nextDueAt: new Date(NOW.getTime() + HOT_MS),
    })
  })

  it('treats a fact dated in the future (clock skew) as a recent reconciliation', () => {
    const reconciled = new Date(NOW.getTime() + 10 * MINUTE_MS)
    expect(look({ lastReconciledAt: reconciled }).kind).toBe('skip')
  })
})

describe('discoveryLookFor: the boundary', () => {
  it('is full exactly at L + 6h - interval', () => {
    // now + interval == L + 6h
    const reconciled = ago(6 * HOUR_MS - HOT_MS)
    expect(look({ interval: HOT_MS, lastReconciledAt: reconciled })).toEqual({
      kind: 'full',
      reason: 'due',
    })
  })

  it('is a skip one millisecond before L + 6h - interval', () => {
    const reconciled = ago(6 * HOUR_MS - HOT_MS - 1)
    expect(look({ interval: HOT_MS, lastReconciledAt: reconciled }).kind).toBe('skip')
  })

  it('is full one millisecond after the boundary', () => {
    const reconciled = ago(6 * HOUR_MS - HOT_MS + 1)
    expect(look({ interval: HOT_MS, lastReconciledAt: reconciled }).kind).toBe('full')
  })
})

describe('discoveryLookFor: the wake-up it schedules', () => {
  it.each([
    ['hot', HOT_MS, 0],
    ['hot', HOT_MS, 3 * HOUR_MS],
    ['hot', HOT_MS, 5 * HOUR_MS],
    ['hot', HOT_MS, 5 * HOUR_MS + 40 * MINUTE_MS],
    ['warm', WARM_MS, 0],
    ['warm', WARM_MS, 2 * HOUR_MS],
    ['warm', WARM_MS, 4 * HOUR_MS],
    ['warm', WARM_MS, 4 * HOUR_MS + 59 * MINUTE_MS],
  ])(
    'is in the future, and the look at that instant is full when nothing changed (%s, reconciled %i ms ago)',
    (_tier, interval, age) => {
      const reconciled = ago(age)
      const first = look({ interval, lastReconciledAt: reconciled })
      if (first.kind !== 'skip') throw new Error('expected a skip')

      expect(first.nextDueAt.getTime()).toBeGreaterThanOrEqual(NOW.getTime() + interval)

      expect(
        discoveryLookFor({
          lastReconciledAt: reconciled,
          hasOutstandingFailure: false,
          skipEnabled: true,
          now: first.nextDueAt,
          interval,
        }),
      ).toEqual({ kind: 'full', reason: 'due' })
    },
  )

  it('is a single wake-up for a hot Property reconciled an hour ago, not one every 15 minutes', () => {
    const reconciled = ago(HOUR_MS)
    const first = look({ interval: HOT_MS, lastReconciledAt: reconciled })
    if (first.kind !== 'skip') throw new Error('expected a skip')
    // 4h45m after the reconciliation, 3h45m from now.
    expect(first.nextDueAt.getTime() - NOW.getTime()).toBe(5 * HOUR_MS - HOT_MS)
  })
})

describe('discoveryLookFor: with head checks on', () => {
  it('wakes at now + the ladder interval instead of one wake-up near the deadline', () => {
    // A cold look is full right after a reconciliation: six hours is the deadline.
    for (const interval of [HOT_MS, WARM_MS]) {
      expect(
        look({ lastReconciledAt: ago(MINUTE_MS), interval, headChecks: true }),
      ).toEqual({
        kind: 'skip',
        nextDueAt: new Date(NOW.getTime() + interval),
        headCheck: true,
      })
    }
  })

  it('still wakes at the single wake-up when head checks are off, byte for byte', () => {
    const skipped = look({ lastReconciledAt: ago(HOUR_MS), headChecks: false })

    expect(skipped).toEqual({
      kind: 'skip',
      nextDueAt: new Date(ago(HOUR_MS).getTime() + 6 * HOUR_MS - HOT_MS),
    })
    expect('headCheck' in skipped).toBe(false)
    expect(look({ lastReconciledAt: ago(HOUR_MS) })).toEqual(skipped)
  })

  it('does not change which looks are full', () => {
    const cases: ReadonlyArray<Partial<LookInput>> = [
      { lastReconciledAt: null },
      { skipEnabled: false },
      { hasOutstandingFailure: true },
      { lastReconciledAt: ago(6 * HOUR_MS) },
      { lastReconciledAt: ago(6 * HOUR_MS - HOT_MS) },
    ]
    for (const over of cases) {
      expect(look({ ...over, headChecks: true })).toEqual(look(over))
    }
  })

  it('goes full the look the next wake-up would reach the deadline', () => {
    // A look at 5h46m after the reconciliation: now + 15 min is 6h01m.
    expect(
      look({ lastReconciledAt: ago(5 * HOUR_MS + 46 * MINUTE_MS), headChecks: true }),
    ).toEqual({ kind: 'full', reason: 'due' })
  })
})

describe('discoveryLookFor: a configured reconciliation window', () => {
  const DAY_MS = 24 * HOUR_MS

  it.each([HOT_MS, WARM_MS, COLD_MS])(
    'keeps head checks before the daily deadline and goes full at its boundary (interval %i)',
    (interval) => {
      const input = {
        interval,
        headChecks: true,
        reconcileWithinMs: DAY_MS,
        lastReconciledAt: ago(DAY_MS - interval - 1),
      }
      expect(look(input)).toEqual({
        kind: 'skip',
        headCheck: true,
        nextDueAt: new Date(NOW.getTime() + interval),
      })
      expect(look({ ...input, lastReconciledAt: ago(DAY_MS - interval) })).toEqual({
        kind: 'full',
        reason: 'due',
      })
      expect(look({ ...input, lastReconciledAt: ago(DAY_MS - interval + 1) }).kind).toBe(
        'full',
      )
    },
  )

  it('skips a Property reconciled ten hours ago when the window is twenty-four hours', () => {
    expect(
      look({
        lastReconciledAt: ago(10 * HOUR_MS),
        interval: COLD_MS,
        headChecks: true,
        reconcileWithinMs: DAY_MS,
      }),
    ).toEqual({
      kind: 'skip',
      nextDueAt: new Date(NOW.getTime() + COLD_MS),
      headCheck: true,
    })
  })

  it('looks fully at the window’s deadline, wherever the window is set', () => {
    expect(
      look({
        lastReconciledAt: ago(DAY_MS - HOT_MS),
        interval: HOT_MS,
        reconcileWithinMs: DAY_MS,
      }),
    ).toEqual({ kind: 'full', reason: 'due' })
  })

  it('keeps the six hour window when none is configured', () => {
    expect(look({ lastReconciledAt: ago(10 * HOUR_MS), interval: COLD_MS })).toEqual({
      kind: 'full',
      reason: 'due',
    })
  })

  it('places the single wake-up against the configured window when no head check follows', () => {
    const deadline = NOW.getTime() - HOUR_MS + DAY_MS
    expect(
      look({
        lastReconciledAt: ago(HOUR_MS),
        interval: HOT_MS,
        reconcileWithinMs: DAY_MS,
      }),
    ).toEqual({ kind: 'skip', nextDueAt: new Date(deadline - HOT_MS) })
  })
})

describe('discoveryLookFor: head cover and requested full reads', () => {
  const DAY_MS = 24 * HOUR_MS
  const WEEK_MS = 7 * DAY_MS

  it('agrees with the ladder and the alert on how long cover lasts', () => {
    expect(DISCOVERY_LOOK_MAX_GAP_MS).toBe(DISCOVERY_MAX_INTERVAL_MS)
    expect(HEAD_COVERAGE_FRESH_MS).toBeGreaterThan(DISCOVERY_MAX_INTERVAL_MS)
    expect(DISCOVERY_RECONCILE_WITHIN_MAX_MS).toBe(336 * HOUR_MS)
  })

  it('makes every decision the same at a window of a day or less, whatever the cover', () => {
    const covers = [undefined, null, ago(MINUTE_MS), ago(8 * HOUR_MS), ago(WEEK_MS)]
    for (const reconcileWithinMs of [6 * HOUR_MS, 12 * HOUR_MS, DAY_MS]) {
      for (const interval of [HOT_MS, WARM_MS, COLD_MS]) {
        for (let age = 0; age <= 26 * HOUR_MS; age += 10 * MINUTE_MS) {
          for (const headChecks of [false, true]) {
            const base = {
              reconcileWithinMs,
              interval,
              headChecks,
              lastReconciledAt: ago(age),
            }
            const expected = look(base)
            for (const headCoveredAt of covers) {
              expect(look({ ...base, headCoveredAt })).toEqual(expected)
            }
          }
        }
      }
    }
  })

  it('lets a covered Property skip for the whole week', () => {
    for (let age = 0; age < WEEK_MS - COLD_MS; age += HOUR_MS) {
      expect(
        look({
          reconcileWithinMs: WEEK_MS,
          interval: COLD_MS,
          headChecks: true,
          lastReconciledAt: ago(age),
          headCoveredAt: ago(6 * HOUR_MS),
        }),
      ).toEqual({
        kind: 'skip',
        headCheck: true,
        nextDueAt: new Date(NOW.getTime() + COLD_MS),
      })
    }
    expect(
      look({
        reconcileWithinMs: WEEK_MS,
        interval: COLD_MS,
        headChecks: true,
        lastReconciledAt: ago(WEEK_MS - COLD_MS),
        headCoveredAt: ago(HOUR_MS),
      }),
    ).toEqual({ kind: 'full', reason: 'due' })
  })

  it('reads a Property in full once its listing is a day old when its cover has lapsed', () => {
    const base = {
      reconcileWithinMs: WEEK_MS,
      interval: HOT_MS,
      headChecks: true,
      headCoveredAt: ago(HEAD_COVERAGE_FRESH_MS),
    }
    expect(look({ ...base, lastReconciledAt: ago(DAY_MS - HOT_MS - 1) }).kind).toBe(
      'skip',
    )
    expect(look({ ...base, lastReconciledAt: ago(DAY_MS - HOT_MS) })).toEqual({
      kind: 'full',
      reason: 'uncovered',
    })
    expect(look({ ...base, lastReconciledAt: ago(3 * DAY_MS) })).toEqual({
      kind: 'full',
      reason: 'uncovered',
    })
    // Never covered at all, and no head checks running.
    expect(
      look({
        reconcileWithinMs: WEEK_MS,
        interval: HOT_MS,
        lastReconciledAt: ago(DAY_MS),
      }),
    ).toEqual({ kind: 'full', reason: 'uncovered' })
  })

  it('wakes an uncovered Property without head checks once, a day after its listing', () => {
    const reconciled = ago(HOUR_MS)
    const first = look({
      reconcileWithinMs: WEEK_MS,
      interval: HOT_MS,
      lastReconciledAt: reconciled,
    })
    expect(first).toEqual({
      kind: 'skip',
      nextDueAt: new Date(reconciled.getTime() + DAY_MS - HOT_MS),
    })
    if (first.kind !== 'skip') throw new Error('expected a skip')
    expect(
      discoveryLookFor({
        reconcileWithinMs: WEEK_MS,
        lastReconciledAt: reconciled,
        hasOutstandingFailure: false,
        skipEnabled: true,
        now: first.nextDueAt,
        interval: HOT_MS,
      }),
    ).toEqual({ kind: 'full', reason: 'uncovered' })
  })

  it('keeps a quiet Property at a weekly window covered by a head check every six hours', () => {
    const start = NOW.getTime()
    let at = start
    let coveredAt: Date | null = new Date(start)
    let fullReads = 0
    let lastReconciledAt = new Date(start)
    while (at < start + 3 * WEEK_MS) {
      const decision = discoveryLookFor({
        reconcileWithinMs: WEEK_MS,
        lastReconciledAt,
        hasOutstandingFailure: false,
        skipEnabled: true,
        headChecks: true,
        headCoveredAt: coveredAt,
        now: new Date(at),
        interval: COLD_MS,
      })
      if (decision.kind === 'full') {
        expect(decision.reason).toBe('due')
        fullReads++
        lastReconciledAt = new Date(at)
        at += COLD_MS
        continue
      }
      expect(decision.nextDueAt.getTime() - at).toBe(COLD_MS)
      // The head job starts inside the ten-minute spread and stores the page.
      coveredAt = new Date(at + 10 * MINUTE_MS)
      at = decision.nextDueAt.getTime()
    }
    // One full read a week, not one a day.
    expect(fullReads).toBe(3)
  })

  it('honours a request once the listing is six hours old, and only once', () => {
    const reconciled = ago(5 * HOUR_MS)
    const base = {
      reconcileWithinMs: WEEK_MS,
      interval: HOT_MS,
      headChecks: true,
      headCoveredAt: ago(MINUTE_MS),
      fullReadRequestedAt: ago(HOUR_MS),
    }
    expect(look({ ...base, lastReconciledAt: reconciled }).kind).toBe('skip')
    expect(
      look({ ...base, lastReconciledAt: ago(FULL_READ_REQUEST_SPACING_MS) }),
    ).toEqual({
      kind: 'full',
      reason: 'requested',
    })
    // The listing it brought completes after the request: the request is spent.
    expect(look({ ...base, lastReconciledAt: ago(30 * MINUTE_MS) }).kind).toBe('skip')
    expect(
      look({
        ...base,
        lastReconciledAt: ago(30 * MINUTE_MS),
        now: new Date(NOW.getTime() + 6 * HOUR_MS),
      }).kind,
    ).toBe('skip')
  })

  it('never runs two requested reads within six hours of a listing, however often asked', () => {
    let lastReconciledAt = ago(DAY_MS)
    let fullReads = 0
    for (let at = NOW.getTime(); at < NOW.getTime() + 2 * DAY_MS; at += HOT_MS) {
      const decision = discoveryLookFor({
        reconcileWithinMs: WEEK_MS,
        lastReconciledAt,
        hasOutstandingFailure: false,
        skipEnabled: true,
        headChecks: true,
        headCoveredAt: new Date(at - MINUTE_MS),
        // Asked again on every look.
        fullReadRequestedAt: new Date(at - 1),
        now: new Date(at),
        interval: HOT_MS,
      })
      if (decision.kind === 'full') {
        expect(at - lastReconciledAt.getTime()).toBeGreaterThanOrEqual(
          FULL_READ_REQUEST_SPACING_MS,
        )
        fullReads++
        lastReconciledAt = new Date(at)
      }
    }
    expect(fullReads).toBe(8)
  })

  it('wakes a skipped look without head checks when a pending request may run', () => {
    const reconciled = ago(2 * HOUR_MS)
    expect(
      look({
        reconcileWithinMs: DAY_MS,
        interval: HOT_MS,
        lastReconciledAt: reconciled,
        fullReadRequestedAt: ago(HOUR_MS),
      }),
    ).toEqual({
      kind: 'skip',
      nextDueAt: new Date(reconciled.getTime() + FULL_READ_REQUEST_SPACING_MS),
    })
  })

  it('ignores a request older than the last listing', () => {
    expect(
      look({
        lastReconciledAt: ago(10 * HOUR_MS),
        reconcileWithinMs: DAY_MS,
        interval: HOT_MS,
        headChecks: true,
        fullReadRequestedAt: ago(11 * HOUR_MS),
      }).kind,
    ).toBe('skip')
  })

  it('reports due before requested before uncovered', () => {
    const requested = { fullReadRequestedAt: ago(MINUTE_MS) }
    expect(
      look({ ...requested, reconcileWithinMs: DAY_MS, lastReconciledAt: ago(DAY_MS) }),
    ).toEqual({ kind: 'full', reason: 'due' })
    expect(
      look({
        ...requested,
        reconcileWithinMs: WEEK_MS,
        lastReconciledAt: ago(2 * DAY_MS),
      }),
    ).toEqual({ kind: 'full', reason: 'requested' })
  })

  it('never lets a listing grow older than fourteen days, whatever the window', () => {
    const covered = { headChecks: true, headCoveredAt: ago(MINUTE_MS), interval: HOT_MS }
    const cap = 336 * HOUR_MS
    for (const reconcileWithinMs of [cap, cap + HOUR_MS, 30 * DAY_MS, Infinity]) {
      expect(
        look({ ...covered, reconcileWithinMs, lastReconciledAt: ago(cap - HOT_MS - 1) })
          .kind,
      ).toBe('skip')
      expect(
        look({ ...covered, reconcileWithinMs, lastReconciledAt: ago(cap - HOT_MS) }),
      ).toEqual({ kind: 'full', reason: 'due' })
    }
  })
})
