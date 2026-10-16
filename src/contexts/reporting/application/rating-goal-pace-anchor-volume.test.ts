// Property Google rating goal — the notice-volume check of the pace anchor
// (round 5 D-3, owner answer Q3; the round 4 X3 (d) pattern).
//
// The 24 representative goals of the blend's check (the four golden Properties,
// new reviews as planned, 0.3★ below plan or too low for the target, at the
// chosen pace or half of it) each get a pace change at week 6 (doubled, halved,
// or none) and run through 26 weeks of the daily evaluation on the same seeded
// review stream, under two rules:
//   - old: the pace judged from the set, and a change of plan forgets the
//     known status (the code before D-3);
//   - new: the pace judged from its change, getting started again for 14 days,
//     the known status kept through that fresh start.
// The check pins the below-pace notices of each rule, and which goals get more
// under the new one (at most one more each):
//   - a goal on pace when its pace was raised: the old rule forgot the known
//     status, so the raised pace's Below pace was stored silently; Q3 tells it
//     once, on leaving the fresh start (four goals);
//   - one goal eased to about the pace it really has: judged on the days since
//     the change (14 to 28 of them) instead of 28, it crosses 90% once more,
//     as a new goal's shorter window can in its days 14 to 28 (Harborline, new
//     reviews 0.3★ below plan at half its pace of 7 a week, eased to 3.5).
// No goal that stays at its pace changes at all.
// docs/plan/google-rating-goal.md quotes these numbers.
import { describe, expect, it } from 'vitest'
import { changeForgetsKnownStatus, type PropertyRatingGoal } from '../domain/rating-goal'
import {
  ratio,
  thresholdThousandths,
  type RatingTotals,
} from '../domain/rating-goal-numbers'
import { nearestTenth } from '../domain/rating-goal-quality'
import { statusPaceWindow } from '../domain/rating-goal-status'
import { evaluateRatingGoal, recordRatingGoalEvaluation } from './rating-goal-evaluation'
import type { RatingGoalReading } from './rating-goal-reading'

const DAY = 24 * 60 * 60 * 1000
const DAYS = 182
const CHANGE_DAY = 42
const SET_AT = new Date('2026-10-19T12:00:00.000Z')

type Property = Readonly<{
  name: string
  count: number
  sum: number
  plan: number
  target: number
  pace: number
}>

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

/** The pace change at week 6: doubled, halved (at least 1 a week) or none. */
const CHANGES = {
  raise: (pace: number) => Math.min(3500, pace * 2),
  ease: (pace: number) => Math.max(10, Math.round(pace / 2)),
  none: (pace: number) => pace,
} as const
type ChangeKind = keyof typeof CHANGES
type Rule = 'old' | 'new'

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

/** Reviews of each day since the set: what the Property does, whatever the plan says. */
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

const dayAt = (day: number) => new Date(SET_AT.getTime() + day * DAY)

const goalOf = (property: Property): PropertyRatingGoal => ({
  id: `goal-${property.name}`,
  organizationId: 'org-1',
  propertyId: `property-${property.name}`,
  sourceEpoch: 1,
  mode: 'climb',
  targetTenths: property.target,
  qualityTenths: property.plan,
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
  paceSince: SET_AT,
  recapAnsweredWeek: null,
  version: 1,
})

function readingOn(
  property: Property,
  days: readonly RatingTotals[],
  day: number,
): RatingGoalReading {
  const now = dayAt(day)
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
    days.slice(0, day).filter((_, index) => dayAt(index).getTime() >= start.getTime()),
  ).count

/**
 * A manager's change of the pace, as each rule stores it: the old one forgets
 * the known status and judges from the set; the new one starts the pace at
 * the change and keeps the known status (changeForgetsKnownStatus).
 */
function changePace(
  goal: PropertyRatingGoal,
  pace: number,
  rule: Rule,
): PropertyRatingGoal {
  if (pace === goal.paceTenthsPerWeek) return goal
  const next = { ...goal, paceTenthsPerWeek: pace, version: goal.version + 1 }
  const forget = rule === 'old' || changeForgetsKnownStatus(goal, next)
  return {
    ...next,
    paceSince: rule === 'old' ? goal.paceSince : dayAt(CHANGE_DAY),
    lastEvaluation: forget
      ? { ...goal.lastEvaluation, knownStatus: null }
      : goal.lastEvaluation,
  }
}

const ALWAYS_STORED = { recordEvaluation: async () => true }

type Run = Readonly<{
  belowPace: number
  /** The status the goal was in on the day its pace changed. */
  atChange: string | null
  /** Below-pace notices measured since the pace changed. */
  sincePaceChange: number
}>

async function run(scenario: Scenario, kind: ChangeKind, rule: Rule): Promise<Run> {
  const { property } = scenario
  const days = reviewDays(scenario)
  let goal = goalOf(property)
  let belowPace = 0
  let sincePaceChange = 0
  let atChange: string | null = null
  for (let day = 1; day <= DAYS && goal.state === 'active'; day += 1) {
    if (day === CHANGE_DAY) {
      atChange = goal.lastEvaluation.status
      goal = changePace(goal, CHANGES[kind](property.pace), rule)
    }
    const reading = readingOn(property, days, day)
    const window = statusPaceWindow(goal.paceSince, reading.now)
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
    for (const notice of recorded.notices) {
      if (notice.transition !== 'entered_below_pace') continue
      belowPace += 1
      if (notice.paceWindow === 'since_pace_change') sincePaceChange += 1
    }
  }
  return { belowPace, atChange, sincePaceChange }
}

const runAll = (kind: ChangeKind, rule: Rule) =>
  Promise.all(SCENARIOS.map((scenario) => run(scenario, kind, rule)))

const sum = (runs: readonly Run[], key: 'belowPace' | 'sincePaceChange') =>
  runs.reduce((all, each) => all + each[key], 0)

const label = (scenario: Scenario) =>
  `${scenario.property.name} ${scenario.mean.toFixed(2)} at ${scenario.paceShare}`

describe('the notice volume of judging a new pace from its change', () => {
  it('pins the below-pace notices of each rule', async () => {
    const counts: Record<string, number> = {}
    for (const kind of Object.keys(CHANGES) as ChangeKind[]) {
      for (const rule of ['old', 'new'] as const) {
        counts[`${kind}:${rule}`] = sum(await runAll(kind, rule), 'belowPace')
      }
    }

    expect(counts).toEqual({
      'raise:old': 23,
      'raise:new': 27,
      'ease:old': 22,
      'ease:new': 23,
      'none:old': 20,
      'none:new': 20,
    })
  })

  it('adds at most one notice to a goal, on pace before a raise or eased to its own pace', async () => {
    const more: string[] = []
    for (const kind of ['raise', 'ease'] as const) {
      const [before, after] = await Promise.all([
        runAll(kind, 'old'),
        runAll(kind, 'new'),
      ])
      after.forEach((each, index) => {
        const extra = each.belowPace - before[index]!.belowPace
        if (extra > 0) {
          more.push(`${kind} ${label(SCENARIOS[index]!)}: +${extra}, ${each.atChange}`)
        }
      })
    }

    expect(more).toEqual([
      'raise Harborline 4.50 at 1: +1, on_pace',
      'raise Seaview 4.70 at 1: +1, on_pace',
      'raise Tavola 4.80 at 1: +1, on_pace',
      'raise Tavola 4.50 at 1: +1, on_pace',
      'ease Harborline 4.20 at 0.5: +1, below_pace',
    ])
  })

  it('changes nothing for a goal whose pace stays', async () => {
    const [before, after] = await Promise.all([
      runAll('none', 'old'),
      runAll('none', 'new'),
    ])

    expect(after).toEqual(before)
    expect(sum(after, 'sincePaceChange')).toBe(0)
  })

  it('says "since the pace changed" for the notices measured from a change', async () => {
    const raised = await runAll('raise', 'new')

    expect(sum(raised, 'sincePaceChange')).toBe(7)
  })
})
