// Guest context — the limiter budgets a guest request spends.
//
// The network-and-Portal layer holds one public address, and a venue on guest
// Wi-Fi is one address for every guest in the room. These pin the numbers so a
// venue-sized burst never meets a budget sized for one person, and so the
// session layer, which holds one device, stays exactly as small as it was.

import { describe, expect, it } from 'vitest'
import {
  QUALIFIED_SCAN_BUDGET,
  rateLimitBudgetFor,
  type GuestRateLimitAction,
} from './guest-rate-limit-budgets'

const HOUR = 60 * 60
const DAY = 24 * HOUR

const ACTIONS: ReadonlyArray<GuestRateLimitAction> = [
  'submit',
  'correct',
  'feedback',
  'feedback_withdraw',
  'response_withdraw',
  'new_response',
  'google',
  'secondary',
]

describe('network-and-Portal budgets', () => {
  it.each([
    ['submit', 60, HOUR],
    ['correct', 60, HOUR],
    ['feedback', 60, HOUR],
    ['feedback_withdraw', 60, HOUR],
    ['response_withdraw', 60, HOUR],
    ['new_response', 60, DAY],
    ['google', 300, HOUR],
    ['secondary', 300, HOUR],
  ] as const)('gives %s %i requests per %i seconds', (action, maxRequests, window) => {
    expect(rateLimitBudgetFor(action).networkPortal).toEqual({
      maxRequests,
      windowSeconds: window,
    })
  })

  it('leaves no action on a budget a busy venue would meet', () => {
    // Sixty ratings an hour is a lobby full of guests; five was one table.
    for (const action of ACTIONS) {
      expect(
        rateLimitBudgetFor(action).networkPortal.maxRequests,
        action,
      ).toBeGreaterThanOrEqual(60)
    }
  })

  it('keeps every action bounded: a client that drops its cookie still meets a cap', () => {
    for (const action of ACTIONS) {
      const { networkPortal } = rateLimitBudgetFor(action)
      expect(Number.isFinite(networkPortal.maxRequests), action).toBe(true)
      expect(networkPortal.windowSeconds, action).toBeLessThanOrEqual(DAY)
    }
  })

  it('takes the new scan budget on both the Redis layer and its durable twin', () => {
    // guest-scans.ts hands this one window to both, so they cannot disagree.
    expect(QUALIFIED_SCAN_BUDGET.networkPortal).toEqual({
      maxRequests: 300,
      windowSeconds: HOUR,
    })
  })
})

describe('session budgets', () => {
  // One signed session takes one response, so these hold one device and did not
  // move when the network layer was sized for a venue.
  it.each([
    ['submit', 2, HOUR],
    ['new_response', 2, DAY],
    ['correct', 3, HOUR],
    ['feedback', 3, HOUR],
    ['feedback_withdraw', 3, HOUR],
    ['response_withdraw', 3, HOUR],
    ['google', 3, DAY],
    ['secondary', 3, DAY],
  ] as const)('keeps %s at %i requests per %i seconds', (action, maxRequests, window) => {
    expect(rateLimitBudgetFor(action).session).toEqual({
      maxRequests,
      windowSeconds: window,
    })
  })

  it('keeps the scan beacon at 3 per hour per session', () => {
    expect(QUALIFIED_SCAN_BUDGET.session).toEqual({ maxRequests: 3, windowSeconds: HOUR })
  })

  it('never lets a session spend more than the venue it sits in', () => {
    for (const action of ACTIONS) {
      const { session, networkPortal } = rateLimitBudgetFor(action)
      expect(session.maxRequests, action).toBeLessThan(networkPortal.maxRequests)
    }
  })
})
