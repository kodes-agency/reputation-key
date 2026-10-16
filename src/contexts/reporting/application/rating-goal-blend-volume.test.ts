// Property Google rating goal — the notice-volume check of the blend (round 4,
// owner X3, condition d).
//
// Twenty-four representative goals (the four golden Properties of rounds 3
// and 4, each with new reviews as planned, 0.3★ below plan or too low for the
// target, at the chosen pace or half of it) run through the daily evaluation
// for 26 weeks on a seeded review stream. Before the blend a goal's numbers
// switched from the plan to the since-set average at the tenth review (R2-5);
// now they blend from the first. The check pins what that changes:
//   - the notices: none, by construction. The evaluation and its notices never
//     read the forecast average (neither imports trackingMix, asserted below),
//     so notices cannot change. The check does not run the old switch for
//     notices: it pins today's counts and shows identical streams at another
//     planned quality;
//   - the average the numbers assume: it no longer jumps at review ten;
//   - chip and numbers, both ways: a plain blend would forecast a too-low goal
//     as reachable on many days (the built one returns their own average then,
//     condition a, so its zero is a regression guard), and before the tenth
//     review it would read a goal that is not too low as unreachable, a verdict
//     R2-5 holds to ten (20 goal-days, against 0 for the switch); the built one
//     holds the blend at the target's minimum quality then, so it never does.
// docs/plan/google-rating-goal.md quotes these numbers.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { PropertyRatingGoal } from '../domain/rating-goal'
import {
  compareRatios,
  fromThousandths,
  ratio,
  ratioToNumber,
  thresholdThousandths,
  type Ratio,
  type RatingTotals,
} from '../domain/rating-goal-numbers'
import { nearestTenth } from '../domain/rating-goal-quality'
import {
  PLANNED_AVERAGE_WEIGHT_REVIEWS,
  QUALITY_VERDICT_MIN_REVIEWS,
  statusPaceWindow,
  trackingMix,
} from '../domain/rating-goal-status'
import { evaluateRatingGoal, recordRatingGoalEvaluation } from './rating-goal-evaluation'
import type { RatingGoalReading } from './rating-goal-reading'

const DAY = 24 * 60 * 60 * 1000
const DAYS = 182
const SET_AT = new Date('2026-10-19T12:00:00.000Z')

type Property = Readonly<{
  name: string
  count: number
  sum: number
  plan: number
  target: number
  pace: number
}>

// Harborline 3.9 from 261, Olive Tree B&B 4.2 from 60, Seaview 4.2 from 640,
// Tavola 4.5 from 2,100, at their recommended goal, average and pace a week.
const PROPERTIES: readonly Property[] = [
  { name: 'Harborline', count: 261, sum: 1021, plan: 45, target: 41, pace: 70 },
  { name: 'Olive Tree', count: 60, sum: 252, plan: 46, target: 44, pace: 70 },
  { name: 'Seaview', count: 640, sum: 2688, plan: 47, target: 44, pace: 140 },
  { name: 'Tavola', count: 2100, sum: 9450, plan: 48, target: 46, pace: 490 },
]

type Scenario = Readonly<{
  property: Property
  mean: number
  paceShare: number
  seed: number
}>

const SCENARIOS: readonly Scenario[] = PROPERTIES.flatMap((property, p) =>
  [
    property.plan / 10,
    property.plan / 10 - 0.3,
    thresholdThousandths(property.target) / 1000 - 0.15,
  ].flatMap((mean, m) =>
    [1, 0.5].map((paceShare, s) => ({
      property,
      mean,
      paceShare,
      seed: 1 + p * 6 + m * 2 + s,
    })),
  ),
)

/** mulberry32: the same stream on every run. */
function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** One star rating around `mean`: a few 1★, the rest 4★ or 5★. */
function stars(mean: number, next: () => number): number {
  const ones = Math.min(0.08, (5 - mean) / 8)
  if (next() < ones) return 1
  const high = (mean - ones) / (1 - ones)
  return next() < high - 4 ? 5 : 4
}

/** Reviews of each day since the set: a count and its stars. */
function reviewDays(scenario: Scenario): readonly RatingTotals[] {
  const next = random(scenario.seed)
  const perDay = (scenario.property.pace / 70) * scenario.paceShare
  return Array.from({ length: DAYS }, () => {
    const count = Math.floor(perDay) + (next() < perDay % 1 ? 1 : 0)
    const ratings = Array.from({ length: count }, () => stars(scenario.mean, next))
    return { count, sum: ratings.reduce((total, each) => total + each, 0) }
  })
}

const total = (days: readonly RatingTotals[]): RatingTotals =>
  days.reduce((all, day) => ({ count: all.count + day.count, sum: all.sum + day.sum }), {
    count: 0,
    sum: 0,
  })

const goalOf = (property: Property, plan: number): PropertyRatingGoal => ({
  id: `goal-${property.name}`,
  organizationId: 'org-1',
  propertyId: `property-${property.name}`,
  sourceEpoch: 1,
  mode: 'climb',
  targetTenths: property.target,
  qualityTenths: plan,
  paceTenthsPerWeek: property.pace,
  state: 'active',
  endedReason: null,
  baseline: {
    reviewCount: property.count,
    googleAverage: 4,
    exactAverage: property.sum / property.count,
  },
  lastEvaluation: {
    displayedTenths: nearestTenth(ratio(property.sum, property.count)),
    status: null,
    evaluatedAt: null,
    knownStatus: null,
    belowPaceNoticedAt: null,
    tooLowNoticedAt: null,
  },
  reachedAt: null,
  endedAt: null,
  createdBy: 'manager-1',
  createdAt: SET_AT,
  updatedAt: SET_AT,
  version: 1,
})

function readingOn(
  property: Property,
  days: readonly RatingTotals[],
  day: number,
): RatingGoalReading {
  const now = new Date(SET_AT.getTime() + day * DAY)
  const sinceSet = total(days.slice(0, day))
  const exact = ratio(property.sum + sinceSet.sum, property.count + sinceSet.count)
  const shown = nearestTenth(exact)
  return {
    now,
    facts: {
      timezone: 'Europe/Sofia',
      lifecycleState: 'active',
      sourceEpoch: 1,
      googleBindingActive: true,
    },
    google: {
      reviewCount: property.count + sinceSet.count,
      averageRating: shown / 10,
      displayedTenths: shown,
      verifiedAt: new Date(now.getTime() - 60 * 60 * 1000),
    },
    googleCurrent: true,
    waiting: false,
    exact: { value: exact, source: 'cache' },
    mix: null,
    reviewsLast28Days: total(days.slice(Math.max(0, day - 28), day)).count,
    reviewsLast90Days: total(days.slice(Math.max(0, day - 90), day)).count,
    extraCounts: [],
    sinceSet,
  }
}

/** Reviews of the days inside the window (each day's reviews arrive at its start). */
const inWindow = (days: readonly RatingTotals[], day: number, start: Date): number =>
  total(
    days
      .slice(0, day)
      .filter((_, index) => SET_AT.getTime() + index * DAY >= start.getTime()),
  ).count

/** One evaluated day: is the goal too low, how many reviews since the set, the averages. */
type Day = Readonly<{
  tooLow: boolean
  reviews: number
  blended: number
  switched: number
}>

type Run = Readonly<{
  notices: readonly string[]
  days: readonly Day[]
  /** Too-low days a plain blend (no condition a) and the built one forecast as reachable. */
  plainDisagrees: number
  builtDisagrees: number
  /**
   * Days not too low (all before the tenth review: from it on, a blend of two
   * averages above the threshold is above it) whose mix does not clear the
   * threshold, so the numbers would read "not reachable" under the chip.
   */
  plainEarlyUnreachable: number
  builtEarlyUnreachable: number
  switchedEarlyUnreachable: number
}>

const ALWAYS_STORED = { recordEvaluation: async () => true }

/** The R2-5 switch this PR replaced, as the reference. */
const switchedMix = (plan: number, sinceSet: RatingTotals): Ratio =>
  sinceSet.count >= QUALITY_VERDICT_MIN_REVIEWS
    ? ratio(sinceSet.sum, sinceSet.count)
    : ratio(plan, 10)

const plainBlend = (plan: number, sinceSet: RatingTotals): Ratio =>
  ratio(
    PLANNED_AVERAGE_WEIGHT_REVIEWS * plan + 10 * sinceSet.sum,
    10 * (PLANNED_AVERAGE_WEIGHT_REVIEWS + sinceSet.count),
  )

async function run(scenario: Scenario, plan: number): Promise<Run> {
  const { property } = scenario
  const days = reviewDays(scenario)
  const threshold = fromThousandths(thresholdThousandths(property.target))
  const reaches = (mix: Ratio) => compareRatios(mix, threshold) > 0
  let goal = goalOf(property, plan)
  const result = {
    notices: [] as string[],
    days: [] as Day[],
    plainDisagrees: 0,
    builtDisagrees: 0,
    plainEarlyUnreachable: 0,
    builtEarlyUnreachable: 0,
    switchedEarlyUnreachable: 0,
  }
  for (let day = 1; day <= DAYS && goal.state === 'active'; day += 1) {
    const reading = readingOn(property, days, day)
    const window = statusPaceWindow(goal.createdAt, reading.now)
    const paceCount = window === null ? null : inWindow(days, day, window.start)
    const evaluation = evaluateRatingGoal(goal, reading, paceCount)
    const pace =
      window === null || paceCount === null ? null : { reviews: paceCount, window }
    const recorded = await recordRatingGoalEvaluation(
      ALWAYS_STORED,
      goal,
      evaluation,
      { pace },
      reading.now,
    )
    goal = recorded.goal
    result.notices.push(
      ...recorded.notices.map((notice) => `${day}:${notice.transition}`),
    )
    const sinceSet = reading.sinceSet ?? { count: 0, sum: 0 }
    const built = trackingMix(plan, sinceSet, property.target).mix
    const tooLow = evaluation.status === 'reviews_too_low'
    result.days.push({
      tooLow,
      reviews: sinceSet.count,
      blended: ratioToNumber(built),
      switched: ratioToNumber(switchedMix(plan, sinceSet)),
    })
    if (tooLow) {
      result.plainDisagrees += reaches(plainBlend(plan, sinceSet)) ? 1 : 0
      result.builtDisagrees += reaches(built) ? 1 : 0
    } else if (evaluation.status !== 'reached') {
      result.plainEarlyUnreachable += reaches(plainBlend(plan, sinceSet)) ? 0 : 1
      result.builtEarlyUnreachable += reaches(built) ? 0 : 1
      result.switchedEarlyUnreachable += reaches(switchedMix(plan, sinceSet)) ? 0 : 1
    }
  }
  return result
}

type Rule = 'blended' | 'switched'

/**
 * The largest day-to-day move of the average a forecast on screen assumes: days
 * that are too low show no forecast (the card and the page say so instead).
 */
const largestStep = (runs: readonly Run[], rule: Rule): number =>
  Math.max(
    ...runs.flatMap((each) =>
      each.days.slice(1).map((day, index) => {
        const before = each.days[index]
        return before === undefined || day.tooLow || before.tooLow
          ? 0
          : Math.abs(day[rule] - before[rule])
      }),
    ),
  )

/** The move on the day the tenth review since the set arrived, for goals not too low. */
const tenthReviewStep = (runs: readonly Run[], rule: Rule): number =>
  Math.max(
    ...runs.map((each) => {
      const at = each.days.findIndex((day) => day.reviews >= QUALITY_VERDICT_MIN_REVIEWS)
      const day = each.days[at]
      const before = each.days[at - 1]
      return day === undefined || before === undefined || day.tooLow
        ? 0
        : Math.abs(day[rule] - before[rule])
    }),
  )

const count = (runs: readonly Run[], transition: string): number =>
  runs.reduce(
    (all, each) =>
      all + each.notices.filter((notice) => notice.endsWith(`:${transition}`)).length,
    0,
  )

describe('the notice volume of blending new reviews into the planned average', () => {
  it('raises the same notices whatever average the numbers assume', async () => {
    const asPlanned = await Promise.all(
      SCENARIOS.map((each) => run(each, each.property.plan)),
    )
    const otherPlan = await Promise.all(
      SCENARIOS.map((each) => run(each, each.property.plan + 2)),
    )

    expect(otherPlan.map((each) => each.notices)).toEqual(
      asPlanned.map((each) => each.notices),
    )
    expect({
      belowPace: count(asPlanned, 'entered_below_pace'),
      tooLow: count(asPlanned, 'entered_reviews_too_low'),
      reached: count(asPlanned, 'reached'),
    }).toEqual({ belowPace: 20, tooLow: 25, reached: 8 })
  })

  it('moves the assumed average step by step instead of jumping at the tenth review', async () => {
    const runs = await Promise.all(SCENARIOS.map((each) => run(each, each.property.plan)))

    const moves = {
      dailyBlended: largestStep(runs, 'blended').toFixed(2),
      dailySwitched: largestStep(runs, 'switched').toFixed(2),
      tenthBlended: tenthReviewStep(runs, 'blended').toFixed(2),
      tenthSwitched: tenthReviewStep(runs, 'switched').toFixed(2),
    }
    // The blend moves most on an early day of a busy Property (seven reviews
    // a day against a plan counted as 15); the switch moves most at review 10.
    expect(moves).toEqual({
      dailyBlended: '0.21',
      dailySwitched: '0.34',
      tenthBlended: '0.06',
      tenthSwitched: '0.30',
    })
  })

  it('reads the notices from the status alone, never from the forecast average', () => {
    const sources = [
      './rating-goal-evaluation.ts',
      '../domain/rating-goal-notices.ts',
    ].map((path) => readFileSync(new URL(path, import.meta.url), 'utf8'))

    expect(sources.map((source) => source.includes('trackingMix'))).toEqual([
      false,
      false,
    ])
  })

  it('regression guard: never forecasts a goal that is too low as reachable', async () => {
    const runs = await Promise.all(SCENARIOS.map((each) => run(each, each.property.plan)))

    // Zero by construction (their own average while too low); a plain blend would not be.
    expect(runs.reduce((all, each) => all + each.builtDisagrees, 0)).toBe(0)
    expect(runs.reduce((all, each) => all + each.plainDisagrees, 0)).toBe(340)
  })

  it('never reads a goal that is not too low as unreachable before the verdict', async () => {
    const runs = await Promise.all(SCENARIOS.map((each) => run(each, each.property.plan)))
    const sum = (key: 'plain' | 'built' | 'switched') =>
      runs.reduce((all, each) => all + each[`${key}EarlyUnreachable`], 0)

    expect({
      built: sum('built'),
      switched: sum('switched'),
      plain: sum('plain'),
    }).toEqual({
      built: 0,
      switched: 0,
      plain: 20,
    })
  })
})
