// The detail's climb as the detail read hands it on (round 5, PLAN-D D-2): the
// chart (the exact average over time, the plan's cone, the likely band, the
// lines and Google's own moves), "Your plan, so far" and the D-2 rows of "What
// moved you". Today is Wednesday 14 October 2026 in Sofia (UTC+3).
import { beforeEach, describe, expect, it } from 'vitest'
import {
  actor,
  activeGoal,
  DAY,
  dependencies,
  exampleWorld,
  NOW,
  PROPERTY,
  type FakeWorld,
} from './use-cases/rating-goal-test-fixtures'
import { getRatingGoalDetail } from './use-cases/rating-goal-reads'

let world: FakeWorld

const readDetail = () =>
  getRatingGoalDetail(dependencies(world), { propertyId: PROPERTY }, actor)

/**
 * Harborline three weeks in: set on Wednesday 23 Sep (its week's Monday is 21
 * Sep, so the chart starts on 24 Aug), 4.1 at 1 a day and 4.5★; Google now
 * shows 4.0 from 289 reviews, the cache holds them all (1,150 stars).
 */
function harborlineThreeWeeksIn() {
  world.snapshot = { ...world.snapshot!, reviewCount: 289, averageRating: 4 }
  world.summary = {
    ...world.summary,
    all: { count: 289, sum: 1150 },
    sinceSet: { count: 28, sum: 129 },
  }
  world.goals = [
    activeGoal({
      targetTenths: 41,
      qualityTenths: 45,
      paceTenthsPerWeek: 70,
      baseline: { reviewCount: 261, googleAverage: 3.9, exactAverage: 3.912 },
      lastEvaluation: { ...activeGoal().lastEvaluation, displayedTenths: 40 },
      createdAt: new Date('2026-09-23T09:00:00.000Z'),
    }),
  ]
  world.history = {
    startAverageThousandths: 3910,
    weeks: [
      { weekStart: '2026-08-31', count: 2, endAverageThousandths: 3912 },
      { weekStart: '2026-09-28', count: 12, endAverageThousandths: 3940 },
      { weekStart: '2026-10-05', count: 10, endAverageThousandths: 3965 },
      { weekStart: '2026-10-12', count: 4, endAverageThousandths: 3979 },
    ],
  }
  world.shown = [
    {
      at: new Date('2026-09-01T08:00:00Z'),
      averageRating: 3.9000000953674316,
      reviewCount: 250,
    },
    { at: new Date('2026-10-07T08:00:00Z'), averageRating: 4, reviewCount: 285 },
  ]
}

/** A pace change from 5 a week to 1 a day on Thursday 1 Oct (its week's Monday is 28 Sep). */
function paceChangedOnFirstOctober() {
  world.changes = [
    {
      id: '60000000-0000-4000-8000-000000000001',
      goalId: activeGoal().id,
      organizationId: activeGoal().organizationId,
      propertyId: PROPERTY,
      changedBy: 'manager-2',
      changedAt: new Date('2026-10-01T09:00:00.000Z'),
      field: 'pace',
      oldValue: '50',
      newValue: '70',
    },
  ]
}

beforeEach(() => {
  world = exampleWorld()
  harborlineThreeWeeksIn()
})

describe('the climb chart', () => {
  it('reads the history and Google’s number from the chart’s first Monday', async () => {
    await readDetail()

    // Monday 24 Aug, 00:00 in Sofia.
    const start = new Date('2026-08-23T21:00:00.000Z')
    expect(world.evidenceRequests).toEqual(
      expect.arrayContaining([
        { read: 'history', since: start },
        { read: 'shown', since: start },
      ]),
    )
  })

  it('draws the exact average at each Monday, flat through a week without reviews, then today', async () => {
    const detail = await readDetail()

    expect(detail?.chart?.firstDay).toBe(-51)
    expect(detail?.chart?.history).toEqual([
      { day: -51, thousandths: 3910 },
      { day: -44, thousandths: 3910 },
      { day: -37, thousandths: 3912 },
      { day: -30, thousandths: 3912 },
      { day: -23, thousandths: 3912 },
      { day: -16, thousandths: 3912 },
      { day: -9, thousandths: 3940 },
      { day: -2, thousandths: 3965 },
      // Today: 1,150 / 289 = 3.9792.
      { day: 0, thousandths: 3979 },
    ])
    expect(detail?.chart?.today).toBe(3979)
  })

  it('starts the plan’s cone at the set, from the stored baseline', async () => {
    const detail = await readDetail()

    expect(detail?.chart?.anchor).toEqual({
      day: -21,
      kind: 'set',
      paceTenthsPerWeek: 70,
      qualityTenths: 45,
    })
    expect(detail?.chart?.plan[0]).toEqual({ day: -21, low: 3912, high: 3912 })
    // Half a year from the set, weekly.
    expect(detail?.chart?.plan).toHaveLength(27)
  })

  it('starts the cone at the Monday of the latest plan change, from the history there', async () => {
    paceChangedOnFirstOctober()

    const detail = await readDetail()

    expect(detail?.chart?.anchor).toEqual({
      day: -16,
      kind: 'changed',
      paceTenthsPerWeek: 70,
      qualityTenths: 45,
    })
    expect(detail?.chart?.plan[0]).toEqual({ day: -16, low: 3912, high: 3912 })
  })

  it('starts the cone from where last week ended when the plan changed this Monday morning', async () => {
    // Monday 12 Oct, 15:00 in Sofia; the pace changed at 09:00 that morning.
    const monday = new Date('2026-10-12T12:00:00.000Z')
    paceChangedOnFirstOctober()
    world.changes = [
      { ...world.changes[0]!, changedAt: new Date('2026-10-12T06:00:00.000Z') },
    ]

    const detail = await getRatingGoalDetail(
      { ...dependencies(world), now: () => monday },
      { propertyId: PROPERTY },
      actor,
    )

    // The week to 11 Oct ended at 3.965; today's 4 reviews are not in the start.
    expect(detail?.chart?.anchor).toMatchObject({ day: 0, kind: 'changed' })
    expect(detail?.chart?.plan[0]).toEqual({ day: 0, low: 3965, high: 3965 })
  })

  it('reads the history from a plan change older than the chart, and clips its cone at the chart’s start', async () => {
    world.goals = [{ ...world.goals[0]!, createdAt: new Date(NOW.getTime() - 400 * DAY) }]
    paceChangedOnFirstOctober()
    // Monday 29 Sep 2025, 15:00 in Sofia: 380 days ago.
    world.changes = [
      { ...world.changes[0]!, changedAt: new Date(NOW.getTime() - 380 * DAY) },
    ]

    const detail = await readDetail()

    // That Monday, 00:00 in Sofia; Google's number still from the chart's start.
    expect(world.evidenceRequests).toEqual(
      expect.arrayContaining([
        { read: 'history', since: new Date('2025-09-28T21:00:00.000Z') },
        { read: 'shown', since: new Date('2025-10-12T21:00:00.000Z') },
      ]),
    )
    expect(detail?.chart?.firstDay).toBe(-366)
    expect(detail?.chart?.history?.[0]).toEqual({ day: -366, thousandths: 3910 })
    expect(detail?.chart?.anchor).toMatchObject({ day: -380, kind: 'changed' })
    expect(detail?.chart?.plan[0]?.day).toBe(-366)
  })

  it('draws the likely band from today with the card’s own arrival, to the goal’s line', async () => {
    const detail = await readDetail()

    // The card's arrival: 40 reviews at the blended 4.57★ and 1 a day, slow end 54.4 days.
    expect(detail?.forecast).toMatchObject({ kind: 'days' })
    expect(detail?.chart?.likely[0]).toEqual({ day: 0, low: 3979, high: 3979 })
    expect(detail?.chart?.likely.at(-1)).toEqual({ day: 182, low: 4050, high: 4050 })
  })

  it('draws a line for each tenth from below the start to above the goal', async () => {
    const detail = await readDetail()

    expect(detail?.chart?.thresholds).toEqual([
      { tenths: 38, thousandths: 3750 },
      { tenths: 39, thousandths: 3850 },
      { tenths: 40, thousandths: 3950 },
      { tenths: 41, thousandths: 4050 },
      { tenths: 42, thousandths: 4150 },
    ])
  })

  it('marks the day Google’s own number moved, not the number in force at the start', async () => {
    const detail = await readDetail()

    expect(detail?.chart?.shownChanges).toEqual([{ day: -7, tenths: 40, up: true }])
  })

  it('draws no history while RepKey lacks some of Google’s reviews, and no cone from a change then', async () => {
    world.summary = { ...world.summary, all: { count: 280, sum: 1115 } }
    paceChangedOnFirstOctober()

    const detail = await readDetail()

    expect(detail?.exactAverageSource).toBe('google')
    expect(detail?.chart?.history).toBeNull()
    expect(detail?.chart?.today).toBeNull()
    expect(detail?.chart?.plan).toEqual([])
  })

  it('still draws the set’s cone from the baseline under Google’s figure', async () => {
    world.summary = { ...world.summary, all: { count: 280, sum: 1115 } }

    const detail = await readDetail()

    expect(detail?.chart?.plan[0]).toEqual({ day: -21, low: 3912, high: 3912 })
  })

  it('has no chart for a goal to keep a number', async () => {
    world.goals = [
      activeGoal({
        mode: 'keep',
        targetTenths: 40,
        qualityTenths: null,
        paceTenthsPerWeek: null,
      }),
    ]

    const detail = await readDetail()

    expect(detail?.chart).toBeNull()
    expect(detail?.planSoFar).toEqual({ prePlan: null, reachedTenths: null })
  })

  it('draws and lists Google’s moves from the set only, so every dot has its row', async () => {
    world.shown = [
      world.shown[0]!,
      // Between the chart's start and the set (23 Sep).
      { at: new Date('2026-09-10T08:00:00Z'), averageRating: 4, reviewCount: 255 },
      { at: new Date('2026-09-15T08:00:00Z'), averageRating: 3.9, reviewCount: 256 },
      world.shown[1]!,
    ]

    const detail = await readDetail()

    expect(detail?.chart?.shownChanges).toEqual([{ day: -7, tenths: 40, up: true }])
    expect(detail?.moved.shownChanges).toEqual([
      { at: '2026-10-07T08:00:00.000Z', tenths: 40, up: true },
    ])
  })
})

describe('your plan, so far', () => {
  it('compares the last four weeks with the four full weeks before the set', async () => {
    const detail = await readDetail()

    // Two reviews in the four weeks before 21 Sep: about 2 a month; 28 since.
    expect(detail?.planSoFar).toEqual({
      prePlan: { perMonth: 2, trend: 'up' },
      reachedTenths: 40,
    })
  })

  it('says nothing about before the goal once the chart no longer reaches back to it', async () => {
    world.goals = [{ ...world.goals[0]!, createdAt: new Date(NOW.getTime() - 400 * DAY) }]

    const detail = await readDetail()

    expect(detail?.planSoFar.prePlan).toBeNull()
  })

  it('reaches no tenth while Google shows what it showed at the set', async () => {
    world.snapshot = { ...world.snapshot!, averageRating: 3.9000000953674316 }

    const detail = await readDetail()

    expect(detail?.planSoFar.reachedTenths).toBeNull()
  })
})

describe('what moved you', () => {
  it('lists Google’s moves since the set and what the goal was set with', async () => {
    paceChangedOnFirstOctober()

    const detail = await readDetail()

    expect(detail?.moved).toEqual({
      shownChanges: [{ at: '2026-10-07T08:00:00.000Z', tenths: 40, up: true }],
      setBy: 'manager-1',
      initialTargetTenths: 41,
      initialPaceTenthsPerWeek: 50,
    })
  })
})
