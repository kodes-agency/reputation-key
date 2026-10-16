// When a reading waits for Google (PLAN-R4 D24): Google's numbers are not
// current, show no tenth, give no exact average, or the review cache holds no
// review at all. The last is the wait the recent mix used to stand for: the mix
// is missing exactly when the cache is empty, so the truth table is unchanged.

import { describe, expect, it } from 'vitest'
import {
  dependencies,
  exampleWorld,
  NOW,
  PROPERTY,
  type FakeWorld,
} from './use-cases/rating-goal-test-fixtures'
import { readRatingGoalInputs, setupEligibility } from './rating-goal-reading'

const HOUR = 60 * 60 * 1000
const ORG = 'org-rating-goal'

type Snapshot = FakeWorld['snapshot']
type Summary = FakeWorld['summary']

const SNAPSHOTS: Readonly<Record<string, Snapshot>> = {
  current: {
    reviewCount: 812,
    averageRating: 4.300000190734863,
    verifiedAt: new Date(NOW.getTime() - HOUR),
  },
  stale: {
    reviewCount: 812,
    averageRating: 4.300000190734863,
    verifiedAt: new Date(NOW.getTime() - 25 * HOUR),
  },
  'no average': {
    reviewCount: 0,
    averageRating: null,
    verifiedAt: new Date(NOW.getTime() - HOUR),
  },
  none: null,
}

const NONE = { count: 0, sum: 0 }
const CACHES: Readonly<Record<string, Omit<Summary, 'counts' | 'sinceSet'>>> = {
  empty: { all: NONE, mixWindow: NONE, mostRecent: NONE },
  'three old reviews': {
    all: { count: 3, sum: 12 },
    mixWindow: NONE,
    mostRecent: { count: 3, sum: 12 },
  },
  complete: {
    all: { count: 812, sum: 3500 },
    mixWindow: { count: 30, sum: 141 },
    mostRecent: { count: 25, sum: 118 },
  },
}

async function readingOf(
  snapshot: Snapshot,
  cache: (typeof CACHES)[string],
  bound = true,
) {
  const world = exampleWorld()
  world.snapshot = snapshot
  world.summary = { ...world.summary, ...cache }
  world.facts = { ...world.facts!, googleBindingActive: bound }
  const reading = await readRatingGoalInputs(dependencies(world), ORG, PROPERTY, NOW)
  return reading!
}

describe('when a reading waits for Google', () => {
  it('waits exactly where it waited on the recent mix', async () => {
    for (const snapshot of Object.values(SNAPSHOTS)) {
      for (const cache of Object.values(CACHES)) {
        for (const bound of [true, false]) {
          const reading = await readingOf(snapshot, cache, bound)
          const before =
            !reading.googleCurrent ||
            reading.google?.displayedTenths == null ||
            reading.exact === null ||
            reading.mix === null

          expect(reading.waiting).toBe(before)
        }
      }
    }
  })

  it('waits while the review cache holds no review, though Google shows a tenth', async () => {
    const reading = await readingOf(
      { reviewCount: 30, averageRating: 4.2, verifiedAt: new Date(NOW.getTime() - HOUR) },
      CACHES.empty!,
    )

    expect(reading).toMatchObject({ googleCurrent: true, waiting: true })
    expect(reading.exact).toMatchObject({ source: 'google' })
    expect(setupEligibility(reading)).toEqual({
      eligible: false,
      reason: 'waiting_for_google',
    })
  })

  it('relies on a partly filled cache, as before', async () => {
    const reading = await readingOf(SNAPSHOTS.current!, CACHES['three old reviews']!)

    expect(reading.waiting).toBe(false)
    expect(reading.reviewsLast90Days).toBe(0)
  })

  it('counts the reviews of the last 90 days', async () => {
    const reading = await readingOf(SNAPSHOTS.current!, CACHES.complete!)

    expect(reading).toMatchObject({ waiting: false, reviewsLast90Days: 30 })
  })
})
