// The detail as the detail read hands it on (2026-11-01, ADR 0067): the chart (the
// exact average over time, a line for each tenth, the day the goal was set, Google's
// own moves and each week's new reviews), the pace before the goal and the rows of
// "What happened" that carry no per-review value. Today is Wednesday 14 October
// 2026 in Sofia (UTC+3).
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

/** The same read at another moment. */
const readDetailAt = (now: Date) =>
  getRatingGoalDetail(
    { ...dependencies(world), now: () => now },
    { propertyId: PROPERTY },
    actor,
  )

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

describe('the chart’s line', () => {
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

  it('draws no history while RepKey lacks some of Google’s reviews', async () => {
    world.summary = { ...world.summary, all: { count: 280, sum: 1115 } }

    const detail = await readDetail()

    expect(detail?.exactAverageSource).toBe('google')
    expect(detail?.chart?.history).toBeNull()
    expect(detail?.chart?.today).toBeNull()
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
    expect(detail?.planSoFar).toEqual({ prePlan: null })
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

describe('the chart’s days', () => {
  it('names today by the Property’s own calendar', async () => {
    const detail = await readDetail()

    expect(detail?.chart?.todayKey).toBe('2026-10-14')
  })

  it('names today by the Property’s calendar when UTC is still the day before', async () => {
    // 22:30 UTC on 14 Oct is 01:30 on 15 Oct in Sofia.
    const detail = await readDetailAt(new Date('2026-10-14T22:30:00.000Z'))

    expect(detail?.chart?.todayKey).toBe('2026-10-15')
  })

  it('counts the day the goal was set back from today', async () => {
    const detail = await readDetail()

    // Set on Wednesday 23 Sep, three weeks before Wednesday 14 Oct.
    expect(detail?.chart?.setDay).toBe(-21)
  })

  it('counts the day the goal was set on the Property’s calendar, not UTC’s', async () => {
    // 22:30 UTC on 22 Sep is 01:30 on 23 Sep in Sofia: the same day as 09:00 UTC.
    world.goals = [
      { ...world.goals[0]!, createdAt: new Date('2026-09-22T22:30:00.000Z') },
    ]

    const detail = await readDetail()

    expect(detail?.chart?.setDay).toBe(-21)
  })

  it('counts a goal set today as day 0', async () => {
    world.goals = [
      { ...world.goals[0]!, createdAt: new Date('2026-10-14T06:00:00.000Z') },
    ]

    const detail = await readDetail()

    expect(detail?.chart?.setDay).toBe(0)
  })
})

describe('the chart’s weeks', () => {
  it('counts the new reviews of each Monday-to-Sunday week, oldest first, to this week', async () => {
    const detail = await readDetail()

    expect(detail?.chart?.weeks).toEqual([
      { day: -51, count: 0 },
      { day: -44, count: 2 },
      { day: -37, count: 0 },
      { day: -30, count: 0 },
      { day: -23, count: 0 },
      { day: -16, count: 12 },
      { day: -9, count: 10 },
      { day: -2, count: 4 },
    ])
  })

  it('includes a zero for a week without reviews, where the history has no row at all', async () => {
    const detail = await readDetail()

    const weeks = detail?.chart?.weeks ?? []
    // 14 Sep and 21 Sep have no row in the history, yet their bars stand at zero.
    expect(weeks.find((week) => week.day === -30)).toEqual({ day: -30, count: 0 })
    expect(weeks.find((week) => week.day === -23)).toEqual({ day: -23, count: 0 })
    expect(weeks).toHaveLength(8)
  })

  it('starts each week at the first day the line starts at', async () => {
    const detail = await readDetail()

    expect(detail?.chart?.weeks[0]?.day).toBe(detail?.chart?.firstDay)
  })

  it('ends with the week that holds today, whatever day of it today is', async () => {
    // Monday 12 Oct, 15:00 in Sofia: this week has only just begun.
    const monday = new Date('2026-10-12T12:00:00.000Z')

    const detail = await readDetailAt(monday)

    expect(detail?.chart?.weeks.at(-1)).toEqual({ day: 0, count: 4 })
  })

  it('looks back a year at most, with a goal set longer ago than that', async () => {
    world.goals = [{ ...world.goals[0]!, createdAt: new Date(NOW.getTime() - 400 * DAY) }]

    const detail = await readDetail()

    // 52 weeks before this week's Monday (12 Oct 2026) is Monday 13 Oct 2025.
    expect(detail?.chart?.firstDay).toBe(-366)
    expect(detail?.chart?.weeks).toHaveLength(53)
    expect(detail?.chart?.weeks[0]).toEqual({ day: -366, count: 0 })
    // The set itself lies before the chart: the page draws nothing before it.
    expect(detail?.chart?.setDay).toBe(-400)
  })

  it('reads the weekly history from the chart’s start once, whatever the plan did before it', async () => {
    world.goals = [{ ...world.goals[0]!, createdAt: new Date(NOW.getTime() - 400 * DAY) }]
    paceChangedOnFirstOctober()
    // 380 days ago: a Monday before the chart starts.
    world.changes = [
      { ...world.changes[0]!, changedAt: new Date(NOW.getTime() - 380 * DAY) },
    ]

    const detail = await readDetail()

    // That Monday, 00:00 in Sofia.
    const start = new Date('2025-10-12T21:00:00.000Z')
    expect(
      world.evidenceRequests.filter((request) => request.read === 'history'),
    ).toEqual([{ read: 'history', since: start }])
    expect(world.evidenceRequests).toContainEqual({ read: 'shown', since: start })
    expect(detail?.chart?.history?.[0]).toEqual({ day: -366, thousandths: 3910 })
  })
})

describe('the pace before the goal', () => {
  it('compares the last four weeks with the four full weeks before the set', async () => {
    const detail = await readDetail()

    // Two reviews in the four weeks before 21 Sep: about 2 a month.
    expect(detail?.planSoFar).toEqual({ prePlan: { perMonth: 2, trend: 'up' } })
  })

  it('says nothing about before the goal once the chart no longer reaches back to it', async () => {
    world.goals = [{ ...world.goals[0]!, createdAt: new Date(NOW.getTime() - 400 * DAY) }]

    const detail = await readDetail()

    expect(detail?.planSoFar.prePlan).toBeNull()
  })
})

describe('what happened', () => {
  it('lists Google’s moves since the set and what the goal was set with', async () => {
    paceChangedOnFirstOctober()

    const detail = await readDetail()

    expect(detail?.moved).toEqual({
      shownChanges: [{ at: '2026-10-07T08:00:00.000Z', tenths: 40, up: true }],
      setBy: 'manager-1',
      initialTargetTenths: 41,
      initialPaceTenthsPerWeek: 50,
      thisWeek: { count: 0, allStars: null, averageTenths: null },
      lowReviews: [],
      lowSinceSet: 0,
    })
  })
})
