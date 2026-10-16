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
} from './rating-goal-test-fixtures'
import {
  getRatingGoalCard,
  getRatingGoalDetail,
  getRatingGoalHistory,
  getRatingGoalSetup,
} from './rating-goal-reads'
import { createRatingGoalEvaluator } from './rating-goals'

let world: FakeWorld

beforeEach(() => {
  world = exampleWorld()
})

const input = { propertyId: PROPERTY }

describe('the setup read', () => {
  it('says whether a goal may be set, Google’s numbers and the exact average', async () => {
    const setup = await getRatingGoalSetup(dependencies(world), input, actor)

    expect(setup).toEqual({
      eligibility: { eligible: true },
      hasActiveGoal: false,
      google: { shows: 4.3, reviewCount: 812, asOf: expect.any(String), current: true },
      exactAverage: 4.31,
      exactAverageSource: 'cache',
      offerKeepFirst: false,
      setupInputs: expect.objectContaining({ displayedTenths: 43, reviewCount: 812 }),
      offersClimb: true,
    })
    expect(world.authorizations).toEqual([`goal.read:${PROPERTY}`])
  })

  it('takes the best calendar year with ten reviews as evidence for the average', async () => {
    world.years = [
      { year: 2023, count: 40, sum: 192 }, // 4.8
      { year: 2025, count: 9, sum: 45 }, // too few
    ]

    const setup = await getRatingGoalSetup(dependencies(world), input, actor)

    expect(setup.setupInputs?.bestYear).toEqual({
      year: 2023,
      average: { num: 24, den: 5 },
      reviewCount: 40,
    })
    expect(world.calls).toContain('reviews.getYearlyTotals')
  })

  it('offers Keep first from 4.7, and a climb still (X1)', async () => {
    world.snapshot = { ...world.snapshot!, averageRating: Math.fround(4.7) }
    world.summary = { ...world.summary, all: { count: 812, sum: 3817 } }

    const setup = await getRatingGoalSetup(dependencies(world), input, actor)

    expect(setup).toMatchObject({ offerKeepFirst: true, offersClimb: true })
  })

  it('offers Keep first, and no climb, when Google shows 4.9', async () => {
    world.snapshot = { ...world.snapshot!, averageRating: 4.900000095367432 }
    world.summary = { ...world.summary, all: { count: 812, sum: 3970 } }

    const setup = await getRatingGoalSetup(dependencies(world), input, actor)

    expect(setup).toMatchObject({ offerKeepFirst: true, offersClimb: false })
  })

  it('says how many reviews there are when there are fewer than ten', async () => {
    world.snapshot = { ...world.snapshot!, reviewCount: 6 }

    const setup = await getRatingGoalSetup(dependencies(world), input, actor)

    expect(setup.eligibility).toEqual({
      eligible: false,
      reason: 'few_reviews',
      reviewCount: 6,
    })
  })

  it('says a Property without a Google review has none yet, with fresh numbers', async () => {
    world.snapshot = { ...world.snapshot!, reviewCount: 0, averageRating: null }
    world.summary = {
      ...world.summary,
      all: { count: 0, sum: 0 },
      mixWindow: { count: 0, sum: 0 },
      mostRecent: { count: 0, sum: 0 },
    }

    const setup = await getRatingGoalSetup(dependencies(world), input, actor)

    expect(setup).toMatchObject({
      eligibility: { eligible: false, reason: 'few_reviews', reviewCount: 0 },
      google: { shows: null, reviewCount: 0, current: true },
      setupInputs: null,
      offersClimb: false,
    })
  })

  it('says how many reviews there are while Google’s numbers are a day old', async () => {
    world.snapshot = {
      ...world.snapshot!,
      reviewCount: 6,
      verifiedAt: new Date(NOW.getTime() - 25 * 3600_000),
    }

    const setup = await getRatingGoalSetup(dependencies(world), input, actor)

    expect(setup).toMatchObject({
      eligibility: { eligible: false, reason: 'few_reviews', reviewCount: 6 },
      google: { reviewCount: 6, current: false },
    })
  })

  it('offers no goal for a Property that is not active, as setting one refuses', async () => {
    world.facts = { ...world.facts!, lifecycleState: 'suspended' }

    const setup = await getRatingGoalSetup(dependencies(world), input, actor)

    expect(setup.eligibility).toEqual({ eligible: false, reason: 'property_not_active' })
  })

  it('waits for Google without a snapshot, and has nothing to offer', async () => {
    world.snapshot = null

    const setup = await getRatingGoalSetup(dependencies(world), input, actor)

    expect(setup).toMatchObject({
      eligibility: { eligible: false, reason: 'waiting_for_google' },
      google: null,
      offerKeepFirst: false,
      setupInputs: null,
      offersClimb: false,
    })
  })

  it('asks Review for the months and the dates the setup’s evidence comes from', async () => {
    await getRatingGoalSetup(dependencies(world), input, actor)

    expect(world.evidenceRequests).toEqual([
      { read: 'months', since: new Date(NOW.getTime() - 400 * DAY), minimumCount: 10 },
      { read: 'days', since: new Date(NOW.getTime() - 366 * DAY) },
    ])
  })

  it('hands the setup its inputs: Google’s numbers, the evidence and the busiest days', async () => {
    const setup = await getRatingGoalSetup(dependencies(world), input, actor)

    expect(setup.offersClimb).toBe(true)

    expect(setup.setupInputs).toEqual({
      reviewCount: 812,
      displayedTenths: 43,
      exact: { num: 125, den: 29 }, // 3500 / 812
      exactSource: 'cache',
      bestMonth: null,
      bestYear: null,
      // The reviews of the last 90 days: the recent mix's window.
      reviewsLast90Days: 30,
      busiest30Days: 0,
      timezone: 'Europe/Sofia',
      asOf: NOW.toISOString(),
    })
  })

  it('takes the best month of the last twelve and the busiest 30 days', async () => {
    world.months = [
      { year: 2025, month: 10, count: 40, sum: 200 }, // twelve months back: out
      { year: 2026, month: 8, count: 11, sum: 52 },
    ]
    world.years = [{ year: 2025, count: 116, sum: 522 }]
    world.days = [
      { day: '2026-09-01', count: 6 },
      { day: '2026-09-30', count: 4 },
      { day: '2026-10-01', count: 5 },
    ]

    const { setupInputs } = await getRatingGoalSetup(dependencies(world), input, actor)

    expect(setupInputs).toMatchObject({
      bestMonth: { year: 2026, month: 8, average: { num: 52, den: 11 }, reviewCount: 11 },
      bestYear: { year: 2025, average: { num: 9, den: 2 }, reviewCount: 116 },
      // 1 to 30 Sep holds 6 + 4; 2 Sep to 1 Oct holds 4 + 5.
      busiest30Days: 10,
    })
  })

  it('answers not found for a Property outside the Organization', async () => {
    world.facts = null

    await expect(
      getRatingGoalSetup(dependencies(world), input, actor),
    ).rejects.toMatchObject({
      code: 'not_found',
    })
  })
})

describe('the simple card', () => {
  it('is empty without an active goal', async () => {
    await expect(getRatingGoalCard(dependencies(world), input, actor)).resolves.toBeNull()
  })

  it('shows Google’s number, progress, this week and a forecast at the actual pace', async () => {
    world.goals = [activeGoal()]
    // The windows asked for: last 28 days, this week, the pace window.
    world.summary = { ...world.summary, counts: [40, 6, 40] }

    const card = await getRatingGoalCard(dependencies(world), input, actor)

    expect(card).toMatchObject({
      state: 'active',
      status: 'on_pace',
      target: 4.5,
      threshold: 4.45,
      google: { shows: 4.3, reviewCount: 812 },
      exactAverageSource: 'cache',
      thisWeekCount: 6,
      justSet: false,
      googleShowsSoon: false,
      forecastBasis: 'actual_pace',
      forecast: { kind: 'range' },
    })
    // From the baseline 4.29 to 4.45, the exact 4.3103 is an eighth of the way.
    expect(card!.progress).toBeCloseTo(0.127, 3)
    expect(world.goals[0]!.lastEvaluation).toMatchObject({
      status: 'on_pace',
      displayedTenths: 43,
    })
  })

  it('names the average Google’s own while the cache holds fewer reviews than Google counts', async () => {
    world.goals = [activeGoal()]
    // 700 of Google's 812 reviews: the exact average falls back to Google's figure.
    world.summary = { ...world.summary, all: { count: 700, sum: 3000 } }

    const card = await getRatingGoalCard(dependencies(world), input, actor)

    expect(card).toMatchObject({ exactAverage: 4.3, exactAverageSource: 'google' })
  })

  it('forecasts at the chosen pace while the goal is young', async () => {
    world.goals = [activeGoal({ createdAt: new Date(NOW.getTime() - 3 * DAY) })]

    const card = await getRatingGoalCard(dependencies(world), input, actor)

    expect(card).toMatchObject({
      status: 'getting_started',
      justSet: true,
      forecastBasis: 'chosen_pace',
    })
  })

  it('reaches the goal on the read that finds Google showing the target', async () => {
    world.goals = [activeGoal()]
    world.snapshot = { ...world.snapshot!, averageRating: 4.5 }

    const card = await getRatingGoalCard(dependencies(world), input, actor)

    expect(card).toMatchObject({ state: 'reached', status: 'reached' })
    expect(world.goals[0]).toMatchObject({ state: 'reached', reachedAt: NOW })
    await expect(getRatingGoalCard(dependencies(world), input, actor)).resolves.toBeNull()
  })

  it('ends the goal when the Property was archived', async () => {
    world.goals = [activeGoal()]
    world.facts = { ...world.facts!, lifecycleState: 'archived', sourceEpoch: 3 }

    const card = await getRatingGoalCard(dependencies(world), input, actor)

    expect(card).toMatchObject({ state: 'ended', endedReason: 'property_archived' })
  })

  it('waits for Google when the binding is no longer active', async () => {
    world.goals = [activeGoal()]
    world.facts = { ...world.facts!, googleBindingActive: false }

    const card = await getRatingGoalCard(dependencies(world), input, actor)

    expect(card).toMatchObject({
      status: 'waiting_for_google',
      google: { current: false },
    })
  })
})

describe('the detail read', () => {
  it('adds the monitoring numbers, the weeks, the stars and the change log', async () => {
    world.goals = [activeGoal({ createdAt: new Date('2026-10-05T09:00:00.000Z') })]
    world.changes = [
      {
        id: 'change-1',
        goalId: activeGoal().id,
        organizationId: actor.organizationId,
        propertyId: PROPERTY,
        changedBy: 'manager-2',
        changedAt: new Date('2026-10-06T09:00:00.000Z'),
        field: 'pace',
        // Logged in tenths a week; "Pick a plan" reads it a week.
        oldValue: '100',
        newValue: '105',
      },
    ]

    const detail = await getRatingGoalDetail(dependencies(world), input, actor)

    expect(detail).toMatchObject({
      exactAverageSource: 'cache',
      lastFourWeeksPerWeek: 7,
      stillNeeded: 454,
      bestCase: 207,
      nextTenth: { targetTenths: 44, target: 4.4, reviewsNeeded: 92 },
      baseline: { googleShows: 4.3, reviewCount: 790, exactAverage: 4.29 },
      weeks: [
        { weekStart: '2026-10-05', count: 0 },
        { weekStart: '2026-10-12', count: 3 },
      ],
      starsSinceSet: [
        { stars: 1, count: 0 },
        { stars: 2, count: 0 },
        { stars: 3, count: 0 },
        { stars: 4, count: 0 },
        { stars: 5, count: 3 },
      ],
      changes: [
        {
          changedBy: 'manager-2',
          changedAt: '2026-10-06T09:00:00.000Z',
          field: 'pace',
          // As logged: tenths of a review a week.
          oldValue: '100',
          newValue: '105',
        },
      ],
    })
    expect(detail!.forecastAtChosenPace).toMatchObject({ kind: 'range' })
    expect(detail!.forecastAtActualPace).toMatchObject({ kind: 'range' })
  })

  it('sets the plan beside what happened, with no verdict before ten new reviews', async () => {
    world.goals = [activeGoal()]

    const detail = await getRatingGoalDetail(dependencies(world), input, actor)

    expect(detail?.plan).toEqual({
      targetTenths: 45,
      googleShowsTenths: 43,
      qualityTenths: 47,
      sinceSet: { reviewCount: 9, average: null, averageTenths: null },
      qualityBasis: 'planned',
      paceTenthsPerWeek: 110,
      lastFourWeeksPerWeek: 7,
      forecast: detail!.forecastAtActualPace,
    })
    expect(detail).toMatchObject({
      qualityTenths: 47,
      quality: 4.7,
      qualityBasis: 'planned',
    })
  })

  it('works the goal out at the average of new reviews from the tenth on', async () => {
    world.goals = [activeGoal()]
    // 20 reviews since the set at 4.55: (812 × 4.45 − 3500) / 0.10 = 1,134.
    world.summary = { ...world.summary, sinceSet: { count: 20, sum: 91 } }

    const detail = await getRatingGoalDetail(dependencies(world), input, actor)

    expect(detail).toMatchObject({
      status: 'below_pace',
      qualityBasis: 'since_set',
      stillNeeded: 1134,
      plan: {
        sinceSet: { reviewCount: 20, average: 4.55, averageTenths: 46 },
        qualityBasis: 'since_set',
      },
    })
  })

  it('says new reviews are too low once ten since the set average at the threshold', async () => {
    world.goals = [activeGoal()]
    world.summary = { ...world.summary, sinceSet: { count: 20, sum: 89 } }

    const detail = await getRatingGoalDetail(dependencies(world), input, actor)

    expect(detail).toMatchObject({
      status: 'reviews_too_low',
      stillNeeded: null,
      forecast: { kind: 'unreachable' },
    })
    expect(world.summaryRequests.at(-1)?.totalsSince).toEqual(activeGoal().createdAt)
  })
})

describe('the history read', () => {
  it('lists reached and ended goals only', async () => {
    world.goals = [
      activeGoal({ id: 'active' }),
      activeGoal({ id: 'reached', state: 'reached', reachedAt: NOW }),
    ]

    const history = await getRatingGoalHistory(dependencies(world), input, actor)

    expect(history).toEqual([
      expect.objectContaining({
        goalId: 'reached',
        state: 'reached',
        target: 4.5,
        reachedAt: NOW.toISOString(),
        baselineGoogleShows: 4.3,
      }),
    ])
  })
})

describe('the evaluator the snapshot consumer runs', () => {
  it('does nothing for a Property without an active goal', async () => {
    const evaluate = createRatingGoalEvaluator(dependencies(world))

    await expect(evaluate(actor.organizationId, PROPERTY)).resolves.toBeNull()
  })

  it('evaluates and stores the active goal without asking a policy', async () => {
    world.goals = [activeGoal()]
    world.deny = true
    const evaluate = createRatingGoalEvaluator(dependencies(world))

    const evaluated = await evaluate(actor.organizationId, PROPERTY)

    expect(evaluated?.evaluation.status).toBe('below_pace')
    expect(world.goals[0]!.lastEvaluation.status).toBe('below_pace')
    expect(world.authorizations).toEqual([])
  })

  it('tells a transition from a repeat, once', async () => {
    world.goals = [activeGoal()]
    const evaluate = createRatingGoalEvaluator(dependencies(world))

    const first = await evaluate(actor.organizationId, PROPERTY)
    const repeat = await evaluate(actor.organizationId, PROPERTY)

    expect(first).toMatchObject({
      stored: true,
      previous: {
        state: 'active',
        lastEvaluation: { status: 'on_pace', displayedTenths: 43 },
      },
      goal: { lastEvaluation: { status: 'below_pace' } },
    })
    expect(repeat).toMatchObject({
      stored: false,
      previous: { lastEvaluation: { status: 'below_pace' } },
    })
  })
})
