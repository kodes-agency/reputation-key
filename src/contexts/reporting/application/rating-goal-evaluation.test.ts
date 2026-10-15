import { describe, expect, it } from 'vitest'
import { ratio } from '../domain/rating-goal-numbers'
import type { PropertyRatingGoal } from '../domain/rating-goal'
import type { RatingGoalReading } from './rating-goal-reading'
import type { PropertyRatingGoalRepository } from './ports/property-rating-goal.repository'
import {
  evaluateRatingGoal,
  evaluationNotices,
  evaluationWrite,
  recordRatingGoalEvaluation,
} from './rating-goal-evaluation'

const NOW = new Date('2026-10-14T12:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000

const goal = (overrides: Partial<PropertyRatingGoal> = {}): PropertyRatingGoal => ({
  id: 'goal-1',
  organizationId: 'org-1',
  propertyId: 'property-1',
  sourceEpoch: 2,
  mode: 'climb',
  targetTenths: 45,
  qualityTenths: 47,
  pacePerWeek: 10,
  state: 'active',
  endedReason: null,
  baseline: { reviewCount: 800, googleAverage: 4.3, exactAverage: 4.31 },
  lastEvaluation: {
    displayedTenths: 43,
    status: 'on_pace',
    evaluatedAt: null,
    knownStatus: 'on_pace',
    belowPaceNoticedAt: null,
    tooLowNoticedAt: null,
  },
  reachedAt: null,
  endedAt: null,
  createdBy: 'manager-1',
  createdAt: new Date(NOW.getTime() - 40 * DAY),
  updatedAt: new Date(NOW.getTime() - 40 * DAY),
  version: 1,
  ...overrides,
})

const reading = (overrides: Partial<RatingGoalReading> = {}): RatingGoalReading => ({
  now: NOW,
  facts: {
    timezone: 'Europe/Sofia',
    lifecycleState: 'active',
    sourceEpoch: 2,
    googleBindingActive: true,
  },
  google: {
    reviewCount: 812,
    averageRating: 4.3,
    displayedTenths: 43,
    verifiedAt: new Date(NOW.getTime() - 60 * 60 * 1000),
  },
  googleCurrent: true,
  waiting: false,
  exact: { value: ratio(431, 100), source: 'cache' },
  mix: { value: ratio(470, 100), reviewCount: 30, basis: 'last_90_days' },
  reviewsLast28Days: 40,
  extraCounts: [],
  sinceSet: { count: 12, sum: 56 },
  ...overrides,
})

describe('evaluating an active rating goal', () => {
  it('reports the status and the tenth Google shows', () => {
    expect(evaluateRatingGoal(goal(), reading(), 40)).toEqual({
      status: 'on_pace',
      displayedTenths: 43,
      outcome: { kind: 'continues' },
    })
  })

  it('says new reviews are too low from the reviews since the goal was set', () => {
    // 20 reviews since the set at exactly 4.45, the threshold of 4.5.
    const tooLow = reading({ sinceSet: { count: 20, sum: 89 } })

    expect(evaluateRatingGoal(goal(), tooLow, 40)).toEqual({
      status: 'reviews_too_low',
      displayedTenths: 43,
      outcome: { kind: 'continues' },
    })
  })

  it('gives no verdict on new reviews when the read did not count them', () => {
    expect(evaluateRatingGoal(goal(), reading({ sinceSet: null }), 40).status).toBe(
      'on_pace',
    )
  })

  it('reaches the goal when Google shows the target', () => {
    const shown = reading({
      google: { ...reading().google!, averageRating: 4.5, displayedTenths: 45 },
    })

    expect(evaluateRatingGoal(goal(), shown, 40)).toEqual({
      status: 'reached',
      displayedTenths: 45,
      outcome: { kind: 'reached' },
    })
  })

  it('ends the goal when the Google location changes under it', () => {
    const relinked = reading({ facts: { ...reading().facts, sourceEpoch: 3 } })

    expect(evaluateRatingGoal(goal(), relinked, 40).outcome).toEqual({
      kind: 'ended',
      reason: 'google_location_changed',
    })
  })

  it('ends the goal when the Property is archived, before anything else', () => {
    const archived = reading({
      facts: { ...reading().facts, lifecycleState: 'archived', sourceEpoch: 3 },
    })

    expect(evaluateRatingGoal(goal(), archived, 40)).toEqual({
      status: 'on_pace',
      displayedTenths: null,
      outcome: { kind: 'ended', reason: 'property_archived' },
    })
  })

  it('keeps a suspended Property’s goal running', () => {
    const suspended = reading({
      facts: { ...reading().facts, lifecycleState: 'suspended' },
    })

    expect(evaluateRatingGoal(goal(), suspended, 40).outcome).toEqual({
      kind: 'continues',
    })
  })

  it('waits for Google without overwriting the tenth it last showed', () => {
    expect(evaluateRatingGoal(goal(), reading({ waiting: true }), 40)).toEqual({
      status: 'waiting_for_google',
      displayedTenths: null,
      outcome: { kind: 'continues' },
    })
  })

  it('judges a keep goal by the tenth it keeps', () => {
    const keep = goal({
      mode: 'keep',
      targetTenths: 44,
      qualityTenths: null,
      pacePerWeek: null,
    })

    expect(evaluateRatingGoal(keep, reading(), null).status).toBe('dropped_below')
    expect(
      evaluateRatingGoal(
        keep,
        reading({ google: { ...reading().google!, displayedTenths: 44 } }),
        null,
      ).status,
    ).toBe('holding')
  })

  it('never reaches a keep goal', () => {
    const keep = goal({
      mode: 'keep',
      targetTenths: 43,
      qualityTenths: null,
      pacePerWeek: null,
    })

    expect(evaluateRatingGoal(keep, reading(), null).outcome).toEqual({
      kind: 'continues',
    })
  })
})

const NO_FACTS = { pace: null } as const

describe('what an evaluation writes', () => {
  it('names the goal, the plan version and the mark it was worked out on, the status, the tenth and the time', () => {
    const changed = goal({ version: 3 })
    const evaluation = evaluateRatingGoal(changed, reading(), 40)

    expect(
      evaluationWrite(
        changed,
        evaluation,
        evaluationNotices(changed, evaluation, NO_FACTS, NOW),
        NOW,
      ),
    ).toEqual({
      organizationId: 'org-1',
      propertyId: 'property-1',
      goalId: 'goal-1',
      expectedVersion: 3,
      expectedMark: {
        displayedTenths: 43,
        knownStatus: 'on_pace',
        belowPaceNoticedAt: null,
        tooLowNoticedAt: null,
      },
      status: 'on_pace',
      displayedTenths: 43,
      knownStatus: 'on_pace',
      belowPaceNoticedAt: null,
      tooLowNoticedAt: null,
      evaluatedAt: NOW,
      outcome: { kind: 'continues' },
      notices: [],
    })
  })

  it('carries the notices of a change with it, and the goal comes back with the new mark', async () => {
    const writes: unknown[] = []
    const repository: Pick<PropertyRatingGoalRepository, 'recordEvaluation'> = {
      recordEvaluation: async (write) => {
        writes.push(write)
        return true
      },
    }
    const gained = reading({
      google: { ...reading().google!, averageRating: 4.4, displayedTenths: 44 },
    })
    const evaluation = evaluateRatingGoal(goal(), gained, 40)

    const recorded = await recordRatingGoalEvaluation(
      repository,
      goal(),
      evaluation,
      NO_FACTS,
      NOW,
    )

    expect(recorded.notices).toEqual([
      {
        transition: 'google_rating_changed',
        mode: 'climb',
        targetTenths: 45,
        shownTenths: 44,
        previousTenths: 43,
      },
    ])
    expect(writes).toEqual([expect.objectContaining({ notices: recorded.notices })])
    expect(recorded.goal.lastEvaluation).toEqual({
      displayedTenths: 44,
      status: 'on_pace',
      evaluatedAt: NOW,
      knownStatus: 'on_pace',
      belowPaceNoticedAt: null,
      tooLowNoticedAt: null,
    })
  })

  it('tells nobody when the repository refuses the write', async () => {
    const repository = { recordEvaluation: async () => false }
    const gained = reading({
      google: { ...reading().google!, averageRating: 4.4, displayedTenths: 44 },
    })

    const recorded = await recordRatingGoalEvaluation(
      repository,
      goal(),
      evaluateRatingGoal(goal(), gained, 40),
      NO_FACTS,
      NOW,
    )

    expect(recorded).toEqual({ goal: goal(), stored: false, notices: [] })
  })
})
