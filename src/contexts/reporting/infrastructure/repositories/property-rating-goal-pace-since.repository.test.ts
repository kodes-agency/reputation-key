// The Property Google rating goal repository's pace start and answered check-in
// (migration 0061, round 5 D-3) against real PostgreSQL: a set writes its own
// clock as the pace start, never the column's DEFAULT; a change of plan writes
// the pace start the use case worked out, and only a change that moves the pace
// moves it; a Keep stores its week with no version and no log row.
//
// One held transaction per test, always rolled back.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  holdTransaction,
  type HeldTransaction,
} from '#/shared/db/testing/held-transaction'
import type {
  NewPropertyRatingGoal,
  RatingGoalPlanChange,
} from '../../application/ports/property-rating-goal.repository'
import type { RatingGoalChangeRow, RatingGoalPlan } from '../../domain/rating-goal'
import { createPropertyRatingGoalRepository } from './property-rating-goal.repository'

const ORG = 'org-rating-goal-pace-since-0001'
const PROPERTY = '61000000-0000-4000-8000-000000000001'
const GOAL = '61000000-0000-4000-8000-000000000101'
// Long before the database's own clock: a DEFAULT now() could never read as it.
const SET_AT = new Date('2026-01-05T09:00:00.000Z')
const LATER = new Date('2026-02-02T09:00:00.000Z')

let held: HeldTransaction

const repository = () => createPropertyRatingGoalRepository(held.db)

const newGoal = (): NewPropertyRatingGoal => ({
  id: GOAL,
  organizationId: ORG,
  propertyId: PROPERTY,
  sourceEpoch: 2,
  mode: 'climb',
  targetTenths: 45,
  qualityTenths: 47,
  paceTenthsPerWeek: 70,
  baseline: { reviewCount: 812, googleAverage: 4.3, exactAverage: 4.31 },
  lastEvaluation: {
    displayedTenths: 43,
    status: 'getting_started',
    evaluatedAt: SET_AT,
    knownStatus: 'getting_started',
    belowPaceNoticedAt: null,
    tooLowNoticedAt: null,
  },
  createdBy: 'manager-1',
  createdAt: SET_AT,
  updatedAt: SET_AT,
})

const PLAN: RatingGoalPlan = {
  mode: 'climb',
  targetTenths: 45,
  qualityTenths: 47,
  paceTenthsPerWeek: 70,
}

const changeTo = (
  plan: RatingGoalPlan,
  rows: readonly RatingGoalChangeRow[],
  paceSince: Date,
  forgetsKnownStatus = true,
): RatingGoalPlanChange => ({
  organizationId: ORG,
  propertyId: PROPERTY,
  goalId: GOAL,
  expectedVersion: 1,
  plan,
  changes: rows.map((row, index) => ({
    ...row,
    id: `61000000-0000-4000-8000-${String(200 + index).padStart(12, '0')}`,
    goalId: GOAL,
    organizationId: ORG,
    propertyId: PROPERTY,
    changedBy: 'manager-2',
    changedAt: LATER,
  })),
  changedAt: LATER,
  paceSince,
  forgetsKnownStatus,
})

const stored = () => repository().findById(ORG, PROPERTY, GOAL)

beforeEach(async () => {
  held = await holdTransaction()
  await held.client.query(
    `INSERT INTO organization (id, name, slug, "createdAt") VALUES ($1, $1, $1, now())`,
    [ORG],
  )
  await held.client.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, source_epoch)
     VALUES ($1::uuid, $2, $1::text, $1::text, 'Europe/Sofia', 2)`,
    [PROPERTY, ORG],
  )
  await repository().insert(newGoal())
})

afterEach(async () => {
  await held.rollBack()
})

describe('the pace start a rating goal stores', () => {
  it('starts with the set, on the set’s own clock, with no check-in answered', async () => {
    await expect(stored()).resolves.toMatchObject({
      createdAt: SET_AT,
      paceSince: SET_AT,
      recapAnsweredWeek: null,
    })
  })

  it('moves to the change when a change moves the pace', async () => {
    const result = await repository().changePlan(
      changeTo(
        { ...PLAN, paceTenthsPerWeek: 140 },
        [{ field: 'pace', oldValue: '70', newValue: '140' }],
        LATER,
      ),
    )

    expect(result).toBe('written')
    await expect(stored()).resolves.toMatchObject({ paceSince: LATER, version: 2 })
  })

  it('stays where it was when a change moves only the target', async () => {
    await repository().changePlan(
      changeTo(
        { ...PLAN, targetTenths: 46 },
        [{ field: 'target', oldValue: '45', newValue: '46' }],
        SET_AT,
      ),
    )

    await expect(stored()).resolves.toMatchObject({
      targetTenths: 46,
      paceSince: SET_AT,
      createdAt: SET_AT,
    })
  })
})

describe('the status a change of plan leaves the goal knowing', () => {
  it('keeps it on a change of the pace alone, for the fresh start to compare with', async () => {
    await repository().changePlan(
      changeTo(
        { ...PLAN, paceTenthsPerWeek: 140 },
        [{ field: 'pace', oldValue: '70', newValue: '140' }],
        LATER,
        false,
      ),
    )

    const goal = await stored()
    expect(goal?.lastEvaluation.knownStatus).toBe('getting_started')
  })

  it('forgets it on any other change', async () => {
    await repository().changePlan(
      changeTo(
        { ...PLAN, targetTenths: 46 },
        [{ field: 'target', oldValue: '45', newValue: '46' }],
        SET_AT,
      ),
    )

    const goal = await stored()
    expect(goal?.lastEvaluation.knownStatus).toBeNull()
  })
})

describe('a manager’s Keep in the Monday check-in', () => {
  const answer = (weekStart: string) =>
    repository().markRecapAnswered({
      organizationId: ORG,
      propertyId: PROPERTY,
      goalId: GOAL,
      weekStart,
    })

  it('stores the week once, twice over, with no version and no log row', async () => {
    await expect(answer('2026-01-26')).resolves.toBe(true)
    await expect(answer('2026-01-26')).resolves.toBe(true)

    await expect(stored()).resolves.toMatchObject({
      recapAnsweredWeek: '2026-01-26',
      version: 1,
      updatedAt: SET_AT,
    })
    const log = await repository().listChanges(ORG, PROPERTY, GOAL, 50)
    expect(log.recent).toEqual([])
  })

  it('never goes back to an earlier week', async () => {
    await answer('2026-02-02')
    await answer('2026-01-26')

    await expect(stored()).resolves.toMatchObject({ recapAnsweredWeek: '2026-02-02' })
  })

  it('stores nothing on a goal that is no longer active, or in another Organization', async () => {
    await repository().endByManager({
      organizationId: ORG,
      propertyId: PROPERTY,
      goalId: GOAL,
      expectedVersion: 1,
      endedAt: LATER,
    })

    await expect(answer('2026-01-26')).resolves.toBe(false)
    await expect(
      repository().markRecapAnswered({
        organizationId: 'org-rating-goal-pace-since-other',
        propertyId: PROPERTY,
        goalId: GOAL,
        weekStart: '2026-01-26',
      }),
    ).resolves.toBe(false)
  })
})
