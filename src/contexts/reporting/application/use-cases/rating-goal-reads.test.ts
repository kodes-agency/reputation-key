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
  it('works out stops, labels, the preselection and the three paces', async () => {
    const setup = await getRatingGoalSetup(dependencies(world), input, actor)

    expect(setup).toMatchObject({
      eligibility: { eligible: true },
      hasActiveGoal: false,
      google: { shows: 4.3, reviewCount: 812, current: true },
      exactAverageSource: 'cache',
      recentMix: { average: 4.7, reviewCount: 30, basis: 'last_90_days' },
      currentPacePerWeek: 7,
      paces: {
        steady: { perWeek: 7, perMonth: 30, perDay: 1 },
        faster: { perWeek: 11, perMonth: 48, perDay: 1.6 },
        push: { perWeek: 14, perMonth: 61, perDay: 2 },
      },
      preselectedTenths: 44,
      offerKeepFirst: false,
      perfectStop: { targetTenths: 50, disabledReason: 'needs_every_review_5_star' },
    })
    expect(
      setup.stops.map(({ targetTenths, reviewsNeeded, label }) => [
        targetTenths,
        reviewsNeeded,
        label,
      ]),
    ).toEqual([
      // (812 × 4.35 − 3500) / 0.35 = 92 exactly; (812 × 4.45 − 3500) / 0.25 = 453.6.
      [44, 92, 'realistic'],
      [45, 454, 'stretch'],
      [46, 1298, 'out_of_reach'],
      [47, 5516, 'out_of_reach'],
      [48, null, 'out_of_reach'],
      [49, null, 'out_of_reach'],
    ])
    expect(setup.stops[0]!.forecasts.faster).toEqual({
      kind: 'range',
      fromMonth: '2026-11',
      toMonth: '2027-01',
    })
    expect(setup.forecastInputs).toMatchObject({
      reviewCount: 812,
      exact: { num: 125, den: 29 }, // 3500 / 812
      mix: { num: 47, den: 10 },
      reviewsLast28Days: 28,
      timezone: 'Europe/Sofia',
      asOf: NOW.toISOString(),
    })
    expect(world.authorizations).toEqual([`goal.read:${PROPERTY}`])
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

  it('waits for Google without a snapshot, and has nothing to offer', async () => {
    world.snapshot = null

    const setup = await getRatingGoalSetup(dependencies(world), input, actor)

    expect(setup).toMatchObject({
      eligibility: { eligible: false, reason: 'waiting_for_google' },
      google: null,
      stops: [],
      preselectedTenths: null,
      forecastInputs: null,
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
        oldValue: '10',
        newValue: '11',
      },
    ]

    const detail = await getRatingGoalDetail(dependencies(world), input, actor)

    expect(detail).toMatchObject({
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
          oldValue: '10',
          newValue: '11',
        },
      ],
    })
    expect(detail!.forecastAtChosenPace).toMatchObject({ kind: 'range' })
    expect(detail!.forecastAtActualPace).toMatchObject({ kind: 'range' })
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
