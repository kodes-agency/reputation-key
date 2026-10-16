import { describe, expect, it } from 'vitest'
import type {
  RatingGoalSetupChoices,
  RatingGoalSetupInputs,
  RatingGoalSetupPlanView,
} from './dto/rating-goal-setup.types'
import { NO_SETUP_CHOICES, workOutRatingGoal } from './rating-goal-setup-plan'

const inputs = (
  overrides: Partial<RatingGoalSetupInputs> & Pick<RatingGoalSetupInputs, 'reviewCount'>,
  sum: number,
): RatingGoalSetupInputs => ({
  displayedTenths: 39,
  exact: { num: sum, den: overrides.reviewCount },
  exactSource: 'cache',
  bestMonth: null,
  bestYear: null,
  reviewsLast90Days: 0,
  busiest30Days: 0,
  timezone: 'Europe/Sofia',
  asOf: '2026-10-16T12:00:00.000Z',
  ...overrides,
})

const HARBORLINE = inputs(
  {
    reviewCount: 261,
    displayedTenths: 39,
    bestYear: { year: 2024, average: { num: 116, den: 26 }, reviewCount: 26 },
    reviewsLast90Days: 6,
    busiest30Days: 3,
  },
  1021,
)
const OLIVE_TREE = inputs(
  {
    reviewCount: 60,
    displayedTenths: 42,
    bestYear: { year: 2025, average: { num: 126, den: 30 }, reviewCount: 30 },
    reviewsLast90Days: 15,
    busiest30Days: 8,
  },
  251,
)
const SEAVIEW = inputs(
  {
    reviewCount: 640,
    displayedTenths: 42,
    bestMonth: { year: 2026, month: 8, average: { num: 52, den: 11 }, reviewCount: 11 },
    reviewsLast90Days: 104,
    busiest30Days: 46,
  },
  2707,
)
const TAVOLA = inputs(
  {
    reviewCount: 2100,
    displayedTenths: 45,
    bestMonth: {
      year: 2026,
      month: 5,
      average: { num: 730, den: 152 },
      reviewCount: 152,
    },
    reviewsLast90Days: 444,
    busiest30Days: 152,
  },
  9492,
)

type Plan = Extract<RatingGoalSetupPlanView, { kind: 'plan' }>

function planOf(
  setup: RatingGoalSetupInputs,
  choices: Partial<RatingGoalSetupChoices> = {},
): Plan {
  const view = workOutRatingGoal(setup, { ...NO_SETUP_CHOICES, ...choices })
  if (view.kind !== 'plan') throw new Error(`expected a plan, got ${view.kind}`)
  return view
}

const days = (fraction: Readonly<{ num: number; den: number }> | null) =>
  fraction === null ? null : fraction.num / fraction.den

describe('the four approved scenarios', () => {
  it('opens Harborline Suites (3.9 from 261) on 4.1 in 81 days at 1 a day, 4.5★ from 2024', () => {
    const plan = planOf(HARBORLINE)
    expect(plan.average).toMatchObject({
      tenths: 45,
      source: 'best_year',
      ownMinTenths: 41,
    })
    expect(plan.average.evidence).toEqual({ kind: 'best_year', year: 2024, tenths: 45 })
    expect(plan.pace.chips.map((chip) => chip.tenthsPerWeek)).toEqual([
      30, 70, 140, 210, 350,
    ])
    expect(plan.pace).toMatchObject({
      tenthsPerWeek: 70,
      recommendedIndex: 1,
      chosenIndex: 1,
    })
    expect(plan.pace).toMatchObject({ nowPerMonth: 2, provenDayTenths: 1, busiest30: 3 })
    expect(plan.goal).toMatchObject({
      shownTenths: 39,
      earnedTenths: 39,
      minTenths: 40,
      maxTenths: 44,
      targetTenths: 41,
      recommendedTenths: 41,
      recommendedIsSafe: true,
      pinnedTenths: null,
      pinnedAboveMax: false,
    })
    expect(plan.reviewsNeeded).toBe(81)
    expect(days(plan.days)).toBe(81)
    expect(days(plan.likely.fast)).toBe(60)
    expect(days(plan.likely.slow)).toBeCloseTo(114.44, 2)
    expect(plan.overSixMonths).toBe(false)
    expect(plan.nextUp).toMatchObject({ targetTenths: 42, reviewsNeeded: 178 })
    expect(days(plan.nextUp?.days ?? null)).toBe(178)
    expect(plan.fasterPace).toBeNull()
    expect(plan.averageAfterHundredths).toBe(405)
    expect(days(plan.daysAtTodaysPace)).toBe(1215)
  })

  it('opens Olive Tree B&B (4.2 from 60) on 4.4 in 40 days, halfway at 4.6★', () => {
    const plan = planOf(OLIVE_TREE)
    expect(plan.average).toMatchObject({ tenths: 46, source: 'halfway' })
    expect(plan.goal.targetTenths).toBe(44)
    expect(plan.reviewsNeeded).toBe(40)
    expect(days(plan.likely.fast)).toBeCloseTo(26.36, 2)
    expect(days(plan.likely.slow)).toBeCloseTo(74.44, 2)
    expect(plan.nextUp).toMatchObject({ targetTenths: 45, reviewsNeeded: 107 })
    expect(plan.pace.nowPerMonth).toBe(5)
  })

  it('opens Seaview Hotel (4.2 from 640) on 4.4 in 110 days at 2 a day, its best month August', () => {
    const plan = planOf(SEAVIEW)
    expect(plan.average).toMatchObject({ tenths: 47, source: 'best_month' })
    expect(plan.pace.chips.map((chip) => chip.tenthsPerWeek)).toEqual([
      107, 140, 210, 350, 490,
    ])
    expect(plan.pace.chips[0]?.kind).toBe('busiest_month')
    expect(plan.pace).toMatchObject({
      tenthsPerWeek: 140,
      provenDayTenths: 15,
      nowPerMonth: 35,
    })
    expect(plan.goal.targetTenths).toBe(44)
    expect(plan.reviewsNeeded).toBe(220)
    expect(days(plan.days)).toBe(110)
    expect(plan.nextUp).toMatchObject({ targetTenths: 45, reviewsNeeded: 564 })
    expect(days(plan.nextUp?.days ?? null)).toBe(282)
  })

  it('opens Tavola (4.5 from 2,100) on 4.6 in 36 days at 7 a day, 4.8★ from May', () => {
    const plan = planOf(TAVOLA)
    expect(plan.average).toMatchObject({ tenths: 48, source: 'best_month' })
    expect(plan.pace).toMatchObject({
      tenthsPerWeek: 490,
      provenDayTenths: 51,
      nowPerMonth: 150,
    })
    expect(plan.goal.targetTenths).toBe(46)
    expect(plan.reviewsNeeded).toBe(252)
    expect(days(plan.days)).toBe(36)
    expect(days(plan.likely.fast)).toBeCloseTo(23.38, 2)
    expect(days(plan.likely.slow)).toBeCloseTo(66.67, 2)
    expect(plan.nextUp).toMatchObject({ targetTenths: 47, reviewsNeeded: 1820 })
  })
})

describe('a goal moved with − and +', () => {
  it('follows the recommendation when pinned on it', () => {
    expect(planOf(HARBORLINE, { pinnedTargetTenths: 41 }).goal.pinnedTenths).toBeNull()
  })

  it('is kept when pinned elsewhere', () => {
    const plan = planOf(HARBORLINE, { pinnedTargetTenths: 42 })
    expect(plan.goal).toMatchObject({
      targetTenths: 42,
      pinnedTenths: 42,
      recommendedTenths: 41,
    })
    expect(plan.reviewsNeeded).toBe(178)
  })

  it('is shown at the highest goal, and says so, when the average no longer reaches it', () => {
    const plan = planOf(HARBORLINE, { pinnedTargetTenths: 46 })
    expect(plan.goal).toMatchObject({
      targetTenths: 44,
      pinnedTenths: 46,
      pinnedAboveMax: true,
    })
  })

  it('is raised to the lowest goal when it is below it', () => {
    const plan = planOf(HARBORLINE, { pinnedTargetTenths: 39 })
    expect(plan.goal).toMatchObject({ targetTenths: 40, pinnedTenths: 40 })
  })
})

describe('a typed average and a typed pace', () => {
  it('opens 4.9 at an average of 5.0', () => {
    const plan = planOf(HARBORLINE, { ownAverageTenths: 50 })
    expect(plan.average).toMatchObject({ tenths: 50, source: 'own', clamped: false })
    expect(plan.goal.maxTenths).toBe(49)
  })

  it('works out the lowest and the highest own pace', () => {
    expect(
      planOf(HARBORLINE, { pace: { kind: 'own', tenthsPerWeek: 14 } }).pace,
    ).toMatchObject({
      tenthsPerWeek: 14,
      chosenIndex: null,
      clamped: false,
    })
    expect(
      planOf(HARBORLINE, { pace: { kind: 'own', tenthsPerWeek: 3500 } }).goal
        .targetTenths,
    ).toBe(43)
  })

  it('clamps and reports what is out of range, and never throws', () => {
    const plan = planOf(HARBORLINE, {
      ownAverageTenths: 99,
      pinnedTargetTenths: 60,
      pace: { kind: 'own', tenthsPerWeek: 9 },
    })
    expect(plan.average).toMatchObject({ tenths: 50, clamped: true })
    expect(plan.goal).toMatchObject({ targetTenths: 49, pinnedAboveMax: true })
    expect(plan.pace).toMatchObject({ tenthsPerWeek: 10, clamped: true })
  })

  it('takes a chip past the end as the last chip', () => {
    expect(planOf(HARBORLINE, { pace: { kind: 'chip', index: 9 } }).pace).toMatchObject({
      tenthsPerWeek: 350,
      chosenIndex: 4,
      clamped: true,
    })
  })

  it('uses a kept average while it is still in range, as the plan’s earlier one', () => {
    expect(planOf(HARBORLINE, { keptAverageTenths: 47 }).average).toMatchObject({
      tenths: 47,
      automaticTenths: 45,
      source: 'earlier',
      clamped: false,
    })
    expect(planOf(HARBORLINE, { keptAverageTenths: 40 }).average).toMatchObject({
      tenths: 41,
      source: 'earlier',
      clamped: true,
    })
  })

  it('survives a stale draft: Google moved to 4.0 while the screen was open', () => {
    const choices = {
      pace: { kind: 'chip', index: 2 },
      pinnedTargetTenths: 40,
      ownAverageTenths: 41,
    } as const
    const moved = {
      ...HARBORLINE,
      displayedTenths: 40,
      reviewCount: 266,
      exact: { num: 1046, den: 266 },
    }
    const plan = planOf(moved, choices)
    expect(plan.goal).toMatchObject({ minTenths: 41, targetTenths: 41 })
    expect(plan.average).toMatchObject({ tenths: 42, clamped: true })
  })
})

describe('a goal more than six months away', () => {
  it('names the faster chip, and that chip brings it within six months', () => {
    const slow = planOf(HARBORLINE, { pinnedTargetTenths: 43 })
    expect(slow.overSixMonths).toBe(true)
    expect(slow.fasterPace?.chipIndex).toBe(2)
    const faster = planOf(HARBORLINE, {
      pinnedTargetTenths: 43,
      pace: { kind: 'chip', index: 2 },
    })
    expect(faster.overSixMonths).toBe(false)
  })
})

describe('the edges', () => {
  it.each([49, 50])('offers only Keep when Google shows %i tenths', (shown) => {
    const view = workOutRatingGoal(
      inputs({ reviewCount: 500, displayedTenths: shown }, shown * 50),
      NO_SETUP_CHOICES,
    )
    expect(view).toEqual({ kind: 'keep_only' })
  })

  it('suggests the next step up from 4.6, not safe, with an open slow end', () => {
    const plan = planOf(inputs({ reviewCount: 500, displayedTenths: 46 }, 2300))
    expect(plan.average).toMatchObject({ tenths: 48, source: 'halfway', ownOnly: false })
    expect(plan.goal).toMatchObject({
      targetTenths: 47,
      recommendedIsSafe: false,
      maxTenths: 47,
    })
    expect(plan.reviewsNeeded).toBe(167)
    expect(plan.likely.slow).toBeNull()
    expect(plan.nextUp).toBeNull()
  })

  it.each([
    [47, 2350, 49, 48],
    [48, 2400, 50, 49],
  ])(
    'plans %i tenths only at a typed average, starting at its floor',
    (shown, sum, floor, goal) => {
      const plan = planOf(inputs({ reviewCount: 500, displayedTenths: shown }, sum))
      expect(plan.average).toMatchObject({ tenths: floor, source: 'own', ownOnly: true })
      expect(plan.goal.targetTenths).toBe(goal)
      expect(plan.reviewsNeeded).toBe(167)
    },
  )

  it('starts above what the cache has earned while Google lags (3.96 shows 3.9)', () => {
    const plan = planOf(
      inputs(
        {
          reviewCount: 100,
          displayedTenths: 39,
          reviewsLast90Days: 10,
          busiest30Days: 6,
        },
        396,
      ),
    )
    expect(plan.goal).toMatchObject({
      shownTenths: 39,
      earnedTenths: 40,
      minTenths: 41,
      targetTenths: 42,
    })
    expect(plan.reviewsNeeded).toBe(55)
    expect(plan.average.ownMinTenths).toBe(42)
  })

  it('is catching up when the cache has earned every tenth to 4.9', () => {
    const view = workOutRatingGoal(
      inputs({ reviewCount: 20, displayedTenths: 45 }, 98),
      NO_SETUP_CHOICES,
    )
    expect(view).toEqual({ kind: 'catching_up', earnedTenths: 49 })
  })

  it('plans a low rating halfway to five stars (2.5 plans 3.8★)', () => {
    const plan = planOf(
      inputs(
        { reviewCount: 80, displayedTenths: 25, reviewsLast90Days: 3, busiest30Days: 2 },
        200,
      ),
    )
    expect(plan.average).toMatchObject({ tenths: 38, source: 'halfway' })
    expect(plan.goal).toMatchObject({ minTenths: 26, targetTenths: 33 })
    expect(plan.reviewsNeeded).toBe(110)
  })

  it('works from Google’s own rounded figure when the cache is short', () => {
    const plan = planOf({
      ...HARBORLINE,
      exact: { num: 39, den: 10 },
      exactSource: 'google',
    })
    expect(plan.reviewsNeeded).toBe(87)
  })
})
