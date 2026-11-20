// Review context — discovery backoff ladder boundaries and quota effect.

import { describe, it, expect } from 'vitest'
import {
  DISCOVERY_COLD_AFTER_MS,
  DISCOVERY_MAX_INTERVAL_MS,
  DISCOVERY_WARM_AFTER_MS,
  discoveryIntervalMs,
  discoveryTierFor,
  lastDiscoveryActivityAt,
  nextDiscoveryDueAt,
  type DiscoveryActivity,
} from './discovery-backoff'

const NOW = new Date('2026-08-21T12:00:00.000Z')
const BASE_MS = 15 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000

const activity = (overrides: Partial<DiscoveryActivity> = {}): DiscoveryActivity => ({
  lastNewReviewAt: null,
  lastNotificationAt: null,
  observedSince: null,
  ...overrides,
})

const ago = (ms: number): Date => new Date(NOW.getTime() - ms)

describe('discoveryTierFor', () => {
  it('is hot while the newest activity is inside the warm boundary', () => {
    expect(discoveryTierFor(activity({ lastNewReviewAt: NOW }), NOW)).toBe('hot')
    expect(
      discoveryTierFor(
        activity({ lastNewReviewAt: ago(DISCOVERY_WARM_AFTER_MS - 1) }),
        NOW,
      ),
    ).toBe('hot')
  })

  it('demotes to warm exactly at the warm boundary and stays warm until the cold boundary', () => {
    expect(
      discoveryTierFor(activity({ lastNewReviewAt: ago(DISCOVERY_WARM_AFTER_MS) }), NOW),
    ).toBe('warm')
    expect(
      discoveryTierFor(
        activity({ lastNewReviewAt: ago(DISCOVERY_COLD_AFTER_MS - 1) }),
        NOW,
      ),
    ).toBe('warm')
  })

  it('demotes to cold exactly at the cold boundary and never colder', () => {
    expect(
      discoveryTierFor(activity({ lastNewReviewAt: ago(DISCOVERY_COLD_AFTER_MS) }), NOW),
    ).toBe('cold')
    expect(
      discoveryTierFor(activity({ lastNewReviewAt: ago(365 * 24 * HOUR_MS) }), NOW),
    ).toBe('cold')
  })

  it('treats a push notification as activity, so a push resets a cold property to hot', () => {
    const longQuiet = ago(30 * 24 * HOUR_MS)
    const cold = activity({ lastNewReviewAt: longQuiet, observedSince: longQuiet })
    expect(discoveryTierFor(cold, NOW)).toBe('cold')

    const pushed = { ...cold, lastNotificationAt: NOW }
    expect(discoveryTierFor(pushed, NOW)).toBe('hot')
    expect(discoveryIntervalMs(pushed, NOW, BASE_MS)).toBe(BASE_MS)
  })

  it('keeps a freshly connected property hot on its observation start alone', () => {
    // No review, no push — but the property row was created minutes ago, so
    // silence carries no information yet.
    expect(discoveryTierFor(activity({ observedSince: ago(5 * 60 * 1000) }), NOW)).toBe(
      'hot',
    )
  })

  it('backs off a long-connected property that has never produced a review', () => {
    expect(
      discoveryTierFor(activity({ observedSince: ago(90 * 24 * HOUR_MS) }), NOW),
    ).toBe('cold')
  })

  it('is cold when there is no activity evidence at all', () => {
    expect(discoveryTierFor(activity(), NOW)).toBe('cold')
  })

  it('treats activity timestamped in the future (clock skew) as just-happened', () => {
    const skewed = activity({ lastNewReviewAt: new Date(NOW.getTime() + HOUR_MS) })
    expect(discoveryTierFor(skewed, NOW)).toBe('hot')
  })
})

describe('lastDiscoveryActivityAt', () => {
  it('returns the newest non-null signal', () => {
    const newest = ago(HOUR_MS)
    expect(
      lastDiscoveryActivityAt(
        activity({
          observedSince: ago(90 * 24 * HOUR_MS),
          lastNewReviewAt: ago(5 * HOUR_MS),
          lastNotificationAt: newest,
        }),
      ),
    ).toEqual(newest)
  })

  it('returns null when nothing is known', () => {
    expect(lastDiscoveryActivityAt(activity())).toBeNull()
  })
})

describe('discoveryIntervalMs', () => {
  it('walks the 15m → 1h → 6h ladder on the default base interval', () => {
    expect(discoveryIntervalMs(activity({ lastNewReviewAt: NOW }), NOW, BASE_MS)).toBe(
      15 * 60 * 1000,
    )
    expect(
      discoveryIntervalMs(
        activity({ lastNewReviewAt: ago(DISCOVERY_WARM_AFTER_MS) }),
        NOW,
        BASE_MS,
      ),
    ).toBe(HOUR_MS)
    expect(
      discoveryIntervalMs(
        activity({ lastNewReviewAt: ago(DISCOVERY_COLD_AFTER_MS) }),
        NOW,
        BASE_MS,
      ),
    ).toBe(6 * HOUR_MS)
  })

  it('caps the cold interval so a quiet property is still polled four times a day', () => {
    // An operator who widens the base to 60 minutes would otherwise get a
    // 24-hour cold interval; the cap holds it at six hours.
    const cold = activity({ lastNewReviewAt: ago(DISCOVERY_COLD_AFTER_MS) })
    expect(discoveryIntervalMs(cold, NOW, HOUR_MS)).toBe(DISCOVERY_MAX_INTERVAL_MS)
  })

  it('never polls more often than the configured base interval', () => {
    const hot = activity({ lastNewReviewAt: NOW })
    expect(discoveryIntervalMs(hot, NOW, 8 * HOUR_MS)).toBe(8 * HOUR_MS)
  })

  it('reduces daily polls for a quiet property by 24x versus the flat interval', () => {
    const dayMs = 24 * HOUR_MS
    const flatPollsPerDay = dayMs / BASE_MS
    const coldPollsPerDay =
      dayMs /
      discoveryIntervalMs(
        activity({ lastNewReviewAt: ago(DISCOVERY_COLD_AFTER_MS) }),
        NOW,
        BASE_MS,
      )

    expect(flatPollsPerDay).toBe(96)
    expect(coldPollsPerDay).toBe(4)
  })
})

describe('nextDiscoveryDueAt', () => {
  it('is always strictly in the future, so it never reads as overdue', () => {
    for (const quietForMs of [0, DISCOVERY_WARM_AFTER_MS, DISCOVERY_COLD_AFTER_MS]) {
      const due = nextDiscoveryDueAt(
        activity({ lastNewReviewAt: ago(quietForMs) }),
        NOW,
        BASE_MS,
      )
      expect(due.getTime()).toBeGreaterThan(NOW.getTime())
    }
  })

  it('places a cold property six hours out on the default base interval', () => {
    expect(
      nextDiscoveryDueAt(
        activity({ lastNewReviewAt: ago(DISCOVERY_COLD_AFTER_MS) }),
        NOW,
        BASE_MS,
      ),
    ).toEqual(new Date(NOW.getTime() + 6 * HOUR_MS))
  })
})
