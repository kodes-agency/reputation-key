import { describe, expect, it } from 'vitest'
import { ratio } from '../domain/rating-goal-numbers'
import type { PropertyRatingGoal } from '../domain/rating-goal'
import type { RatingGoalReading } from './rating-goal-reading'
import { evaluateRatingGoal, evaluationWrite } from './rating-goal-evaluation'

const NOW = new Date('2026-10-14T12:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000

const goal = (overrides: Partial<PropertyRatingGoal> = {}): PropertyRatingGoal => ({
  id: 'goal-1',
  organizationId: 'org-1',
  propertyId: 'property-1',
  sourceEpoch: 2,
  mode: 'climb',
  targetTenths: 45,
  pacePerWeek: 10,
  state: 'active',
  endedReason: null,
  baseline: { reviewCount: 800, googleAverage: 4.3, exactAverage: 4.31 },
  lastEvaluation: { displayedTenths: 43, status: 'on_pace', evaluatedAt: null },
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
    const keep = goal({ mode: 'keep', targetTenths: 44, pacePerWeek: null })

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
    const keep = goal({ mode: 'keep', targetTenths: 43, pacePerWeek: null })

    expect(evaluateRatingGoal(keep, reading(), null).outcome).toEqual({
      kind: 'continues',
    })
  })
})

describe('what an evaluation writes', () => {
  it('names the goal, the plan version it was worked out on, the status, the tenth and the time', () => {
    const changed = goal({ version: 3 })

    expect(
      evaluationWrite(changed, evaluateRatingGoal(changed, reading(), 40), NOW),
    ).toEqual({
      organizationId: 'org-1',
      propertyId: 'property-1',
      goalId: 'goal-1',
      expectedVersion: 3,
      status: 'on_pace',
      displayedTenths: 43,
      evaluatedAt: NOW,
      outcome: { kind: 'continues' },
    })
  })
})
