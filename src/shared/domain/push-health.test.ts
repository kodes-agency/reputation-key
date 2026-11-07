import { describe, expect, it } from 'vitest'
import {
  LATE_PUBLISHED_AFTER_MS,
  PUSH_MISSED_AFTER_MS,
  accountPushHealth,
  classifyFirstSighting,
  locationPushHealth,
  reconciliationOverdueAfterMs,
  summarizeLedger,
  type FirstSightingFacts,
  type LedgerSighting,
} from './push-health'

const MINUTE = 60_000
const SEEN = new Date('2026-10-21T10:00:00.000Z')
const at = (minutesAfterSeen: number) =>
  new Date(SEEN.getTime() + minutesAfterSeen * MINUTE)

const sighting = (over: Partial<FirstSightingFacts> = {}): FirstSightingFacts => ({
  firstSeenVia: 'snapshot',
  firstSeenAt: SEEN,
  pushAcceptedAt: null,
  sourceCreatedAt: at(-5),
  previousListingAt: null,
  ...over,
})

describe('reconciliation overdue limit', () => {
  it.each([
    [6, 8],
    [12, 14],
    [24, 26],
  ])('gives a %ih window two hours of slack', (window, overdue) => {
    expect(reconciliationOverdueAfterMs(window)).toBe(overdue * 3_600_000)
  })
})

describe('classifyFirstSighting', () => {
  it('waits out the missed window before judging a Review polling found first', () => {
    expect(classifyFirstSighting(sighting(), at(59))).toEqual({
      healthy: false,
      pending: true,
      late: false,
      missed: false,
    })
  })

  it('counts a Review no push covered as missed once the window has passed', () => {
    expect(classifyFirstSighting(sighting(), at(PUSH_MISSED_AFTER_MS / MINUTE))).toEqual({
      healthy: false,
      pending: false,
      late: false,
      missed: true,
    })
  })

  it('treats a push accepted before polling first saw the Review as healthy', () => {
    const result = classifyFirstSighting(sighting({ pushAcceptedAt: at(-2) }), at(500))
    expect(result).toEqual({ healthy: true, pending: false, late: false, missed: false })
  })

  it('treats a push accepted at the very moment of the first sighting as healthy', () => {
    const result = classifyFirstSighting(sighting({ pushAcceptedAt: SEEN }), at(500))
    expect(result.healthy).toBe(true)
  })

  it('is healthy when the Review was first seen by a push read', () => {
    const result = classifyFirstSighting(
      sighting({ firstSeenVia: 'push', pushAcceptedAt: at(-1) }),
      at(500),
    )
    expect(result).toEqual({ healthy: true, pending: false, late: false, missed: false })
  })

  it('is healthy when the Review was first seen by the snapshot a push handed off', () => {
    const result = classifyFirstSighting(
      sighting({ firstSeenVia: 'push_reconcile' }),
      at(500),
    )
    expect(result).toEqual({ healthy: true, pending: false, late: false, missed: false })
  })

  it('is late, not missed, when the push arrived inside the window but after polling', () => {
    const result = classifyFirstSighting(sighting({ pushAcceptedAt: at(30) }), at(500))
    expect(result).toEqual({ healthy: false, pending: false, late: true, missed: false })
  })

  it('stays missed as well as late when the push arrived after the window', () => {
    const result = classifyFirstSighting(sighting({ pushAcceptedAt: at(90) }), at(500))
    expect(result).toEqual({ healthy: false, pending: false, late: true, missed: true })
  })

  it('counts a late push as late at once, without waiting for the window', () => {
    const result = classifyFirstSighting(sighting({ pushAcceptedAt: at(5) }), at(10))
    expect(result).toEqual({ healthy: false, pending: false, late: true, missed: false })
  })

  it('judges a Review found by an on-demand read like one found by polling', () => {
    const result = classifyFirstSighting(sighting({ firstSeenVia: 'demand' }), at(120))
    expect(result.missed).toBe(true)
  })

  describe('a Review Google published late', () => {
    const LATE_PUBLISHED_MINUTES = LATE_PUBLISHED_AFTER_MS / MINUTE

    it.each([-1, 0, 1])(
      'uses the previous listing boundary with a creation offset of %i ms',
      (offset) => {
        const previousListingAt = at(-6 * 60)
        const result = classifyFirstSighting(
          sighting({
            previousListingAt,
            sourceCreatedAt: new Date(previousListingAt.getTime() + offset),
          }),
          at(120),
        )
        expect(result).toEqual({
          healthy: offset < 0,
          pending: false,
          late: false,
          missed: offset >= 0,
        })
      },
    )

    it('keeps a genuinely new Review missed after a long gap between listings', () => {
      const result = classifyFirstSighting(
        sighting({ previousListingAt: at(-36 * 60), sourceCreatedAt: at(-30 * 60) }),
        at(120),
      )
      expect(result.missed).toBe(true)
    })

    it('does not count as a missed push when Google dates it over a day before it was seen', () => {
      const result = classifyFirstSighting(
        sighting({ sourceCreatedAt: at(-(LATE_PUBLISHED_MINUTES + 1)) }),
        at(120),
      )
      expect(result).toEqual({
        healthy: true,
        pending: false,
        late: false,
        missed: false,
      })
    })

    it('is not pending in its first hour either', () => {
      const result = classifyFirstSighting(
        sighting({ sourceCreatedAt: at(-(7 * LATE_PUBLISHED_MINUTES)) }),
        at(10),
      )
      expect(result.pending).toBe(false)
    })

    it('still counts as missed when Google dates it exactly a day before it was seen', () => {
      const result = classifyFirstSighting(
        sighting({ sourceCreatedAt: at(-LATE_PUBLISHED_MINUTES) }),
        at(120),
      )
      expect(result.missed).toBe(true)
    })

    it('still counts as missed when Google gave it no date', () => {
      const result = classifyFirstSighting(sighting({ sourceCreatedAt: null }), at(120))
      expect(result.missed).toBe(true)
    })
  })
})

describe('locationPushHealth', () => {
  it.each([
    [0, 'healthy'],
    [1, 'suspect'],
    [4, 'suspect'],
  ] as const)('reports %i missed in seven days as %s', (missed, expected) => {
    expect(locationPushHealth(missed)).toBe(expected)
  })
})

describe('accountPushHealth', () => {
  it.each([
    [0, 'ok'],
    [1, 'ok'],
    [2, 'dark'],
    [9, 'dark'],
  ] as const)('reports %i missed across the account as %s', (missed, expected) => {
    expect(accountPushHealth(missed)).toBe(expected)
  })
})

describe('summarizeLedger', () => {
  const NOW = new Date('2026-10-21T12:00:00.000Z')
  const ago = (minutes: number) => new Date(NOW.getTime() - minutes * MINUTE)
  const found = (
    locationKey: string,
    minutesAgo: number,
    over: Partial<LedgerSighting> = {},
  ): LedgerSighting => ({
    firstSeenVia: 'snapshot',
    firstSeenAt: ago(minutesAgo),
    pushAcceptedAt: null,
    sourceCreatedAt: ago(minutesAgo + 5),
    previousListingAt: null,
    locationKey,
    accountKey: over.accountKey ?? 'account-1',
    ...over,
  })

  it('counts nothing for an empty ledger', () => {
    expect(summarizeLedger([], NOW)).toEqual({
      pending: 0,
      missed24h: 0,
      late24h: 0,
      latePublished24h: 0,
      locationsSuspect: 0,
      accountsDark: 0,
    })
  })

  it('excludes a batch released after the previous listing, including Reviews under a day old', () => {
    const summary = summarizeLedger(
      [19 * 60, 23.6 * 60, 2 * 24 * 60, 3 * 24 * 60, 3.5 * 24 * 60, 4 * 24 * 60].map(
        (ageAtSighting) =>
          found('a', 120, {
            sourceCreatedAt: ago(120 + ageAtSighting),
            previousListingAt: ago(120 + 6 * 60),
          }),
      ),
      NOW,
    )

    expect(summary).toEqual({
      pending: 0,
      missed24h: 0,
      late24h: 0,
      latePublished24h: 6,
      locationsSuspect: 0,
      accountsDark: 0,
    })
  })

  it('counts a Review Google published late apart, and holds no location or account against it', () => {
    const weekBefore = (minutesAgo: number) => ago(minutesAgo + 7 * 24 * 60)
    const summary = summarizeLedger(
      [
        found('a', 180, { sourceCreatedAt: weekBefore(180) }),
        found('b', 180, { sourceCreatedAt: weekBefore(180) }),
        found('a', 2 * 24 * 60, { sourceCreatedAt: weekBefore(2 * 24 * 60) }),
      ],
      NOW,
    )

    expect(summary).toEqual({
      pending: 0,
      missed24h: 0,
      late24h: 0,
      latePublished24h: 2,
      locationsSuspect: 0,
      accountsDark: 0,
    })
  })

  it('counts the last day by outcome and leaves older Reviews to the seven-day health', () => {
    const summary = summarizeLedger(
      [
        found('a', 10),
        found('a', 180),
        found('a', 180, { pushAcceptedAt: ago(170) }),
        found('a', 2 * 24 * 60),
      ],
      NOW,
    )

    expect(summary).toMatchObject({ pending: 1, missed24h: 1, late24h: 1 })
  })

  it('makes a location suspect after one miss and an account dark after two across it', () => {
    const summary = summarizeLedger(
      [
        found('a', 180, { accountKey: 'account-1' }),
        found('b', 180, { accountKey: 'account-1' }),
        found('c', 180, { accountKey: 'account-2' }),
      ],
      NOW,
    )

    expect(summary).toMatchObject({ locationsSuspect: 3, accountsDark: 1 })
  })

  it('does not make an account dark for one missed push', () => {
    expect(summarizeLedger([found('a', 180)], NOW)).toMatchObject({
      locationsSuspect: 1,
      accountsDark: 0,
    })
  })

  it('does not count a Review whose push covered it', () => {
    const summary = summarizeLedger(
      [found('a', 180, { firstSeenVia: 'push_reconcile' })],
      NOW,
    )

    expect(summary).toMatchObject({ missed24h: 0, locationsSuspect: 0 })
  })
})
