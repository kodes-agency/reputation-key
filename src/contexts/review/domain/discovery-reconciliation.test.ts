// Review context — the rule that lets a discovery look skip a Property whose
// last COMPLETED reconciliation is recent.

import { describe, it, expect } from 'vitest'
import { DISCOVERY_MAX_INTERVAL_MS } from './discovery-backoff'
import {
  DISCOVERY_RECONCILE_WITHIN_MS,
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
