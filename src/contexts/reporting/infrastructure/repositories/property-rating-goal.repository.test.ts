// The Property Google rating goal repository against real PostgreSQL: one
// active goal per Property, the version compare-and-set, the change log, the
// evaluation write that changes the row only when something changed, the
// tenant scope of every read, and the table checks behind them.
//
// One held transaction per test, always rolled back; a statement expected to
// fail runs in its own savepoint.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  propertyRatingGoalChanges,
  propertyRatingGoals,
} from '#/shared/db/schema/goal.schema'
import {
  holdTransaction,
  type HeldTransaction,
} from '#/shared/db/testing/held-transaction'
import type {
  NewPropertyRatingGoal,
  RatingGoalEvaluationWrite,
} from '../../application/ports/property-rating-goal.repository'
import type {
  RatingGoalChangeRow,
  RatingGoalPlan,
  RatingGoalStatus,
} from '../../domain/rating-goal'
import {
  createPropertyRatingGoalRepository,
  createRatingGoalPropertyFactsReader,
} from './property-rating-goal.repository'

const ORG = 'org-rating-goal-repository-0001'
const OTHER_ORG = 'org-rating-goal-repository-0002'
const PROPERTY = '58000000-0000-4000-8000-000000000001'
const OTHER_PROPERTY = '58000000-0000-4000-8000-000000000002'
const FOREIGN_PROPERTY = '58000000-0000-4000-8000-000000000003'
const SET_AT = new Date('2026-09-01T09:00:00.000Z')
const LATER = new Date('2026-10-01T09:00:00.000Z')

let held: HeldTransaction

const goalId = (n: number) => `59000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const newGoal = (
  overrides: Partial<NewPropertyRatingGoal> = {},
): NewPropertyRatingGoal => ({
  id: goalId(1),
  organizationId: ORG,
  propertyId: PROPERTY,
  sourceEpoch: 2,
  mode: 'climb',
  targetTenths: 45,
  pacePerWeek: 11,
  baseline: { reviewCount: 812, googleAverage: 4.3, exactAverage: 4.31 },
  lastEvaluation: { displayedTenths: 43, status: 'getting_started', evaluatedAt: SET_AT },
  createdBy: 'manager-1',
  createdAt: SET_AT,
  updatedAt: SET_AT,
  ...overrides,
})

const repository = () => createPropertyRatingGoalRepository(held.db)

/** Runs a statement that must fail in a savepoint, so the held transaction survives. */
async function refused(statement: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await held.db.transaction(async () => {
      await statement()
    })
  } catch (error) {
    const cause = (error as { cause?: { code?: string } }).cause
    return cause?.code ?? (error as { code?: string }).code
  }
  return undefined
}

beforeEach(async () => {
  held = await holdTransaction()
  for (const org of [ORG, OTHER_ORG]) {
    await held.client.query(
      `INSERT INTO organization (id, name, slug, "createdAt") VALUES ($1, $1, $1, now())`,
      [org],
    )
  }
  for (const [id, org] of [
    [PROPERTY, ORG],
    [OTHER_PROPERTY, ORG],
    [FOREIGN_PROPERTY, OTHER_ORG],
  ] as const) {
    await held.client.query(
      `INSERT INTO properties (id, organization_id, name, slug, timezone, source_epoch)
       VALUES ($1::uuid, $2, $1::text, $1::text, 'Europe/Sofia', 2)`,
      [id, org],
    )
  }
})

afterEach(async () => {
  await held.rollBack()
})

describe('one active rating goal per Property', () => {
  it('stores a goal with the tenth and status it was set at, and finds it as the Property’s active goal', async () => {
    await expect(repository().insert(newGoal())).resolves.toBe('inserted')

    const active = await repository().findActive(ORG, PROPERTY)

    expect(active).toMatchObject({
      id: goalId(1),
      mode: 'climb',
      targetTenths: 45,
      pacePerWeek: 11,
      state: 'active',
      sourceEpoch: 2,
      baseline: { reviewCount: 812, googleAverage: 4.3, exactAverage: 4.31 },
      // The first evaluation can tell a tenth gained since the goal was set.
      lastEvaluation: {
        displayedTenths: 43,
        status: 'getting_started',
        evaluatedAt: SET_AT,
      },
      version: 1,
    })
  })

  it('answers active_exists for a second active goal, and allows one after the first ended', async () => {
    await repository().insert(newGoal())

    await expect(repository().insert(newGoal({ id: goalId(2) }))).resolves.toBe(
      'active_exists',
    )
    await repository().endByManager({
      organizationId: ORG,
      propertyId: PROPERTY,
      goalId: goalId(1),
      expectedVersion: 1,
      endedAt: LATER,
    })
    await expect(repository().insert(newGoal({ id: goalId(2) }))).resolves.toBe(
      'inserted',
    )
  })

  it('reads a goal only within its Organization and Property', async () => {
    await repository().insert(newGoal())

    await expect(repository().findActive(OTHER_ORG, PROPERTY)).resolves.toBeNull()
    await expect(repository().findActive(ORG, OTHER_PROPERTY)).resolves.toBeNull()
    await expect(
      repository().findById(OTHER_ORG, PROPERTY, goalId(1)),
    ).resolves.toBeNull()
  })
})

describe('a manager’s change', () => {
  beforeEach(async () => {
    await repository().insert(newGoal())
  })

  const change = (expectedVersion: number) => ({
    organizationId: ORG,
    propertyId: PROPERTY,
    goalId: goalId(1),
    expectedVersion,
    plan: { mode: 'climb' as const, targetTenths: 46, pacePerWeek: 14 },
    changes: [
      {
        id: goalId(101),
        goalId: goalId(1),
        organizationId: ORG,
        propertyId: PROPERTY,
        changedBy: 'manager-2',
        changedAt: LATER,
        field: 'target' as const,
        oldValue: '45',
        newValue: '46',
      },
      {
        id: goalId(102),
        goalId: goalId(1),
        organizationId: ORG,
        propertyId: PROPERTY,
        changedBy: 'manager-2',
        changedAt: LATER,
        field: 'pace' as const,
        oldValue: '11',
        newValue: '14',
      },
    ],
    changedAt: LATER,
  })

  it('writes the plan and its log rows, and moves the version', async () => {
    await expect(repository().changePlan(change(1))).resolves.toBe('written')

    await expect(repository().findById(ORG, PROPERTY, goalId(1))).resolves.toMatchObject({
      targetTenths: 46,
      pacePerWeek: 14,
      version: 2,
    })
    const log = await repository().listChanges(ORG, PROPERTY, goalId(1), 50)
    expect(
      log.map(({ field, oldValue, newValue, changedBy }) => [
        field,
        oldValue,
        newValue,
        changedBy,
      ]),
    ).toEqual([
      ['target', '45', '46', 'manager-2'],
      ['pace', '11', '14', 'manager-2'],
    ])
  })

  it('refuses a stale version and an ended goal', async () => {
    await expect(repository().changePlan(change(2))).resolves.toBe('version_conflict')
    await repository().endByManager({
      organizationId: ORG,
      propertyId: PROPERTY,
      goalId: goalId(1),
      expectedVersion: 1,
      endedAt: LATER,
    })
    await expect(repository().changePlan(change(2))).resolves.toBe('not_active')
    await expect(repository().listChanges(ORG, PROPERTY, goalId(1), 50)).resolves.toEqual(
      [],
    )
  })

  it('never shows one Organization the log of another', async () => {
    await repository().changePlan(change(1))

    await expect(
      repository().listChanges(OTHER_ORG, PROPERTY, goalId(1), 50),
    ).resolves.toEqual([])
  })
})

describe('an evaluation write', () => {
  beforeEach(async () => {
    await repository().insert(newGoal())
  })

  const write = (
    overrides: Partial<
      Parameters<ReturnType<typeof repository>['recordEvaluation']>[0]
    > = {},
  ) => ({
    organizationId: ORG,
    propertyId: PROPERTY,
    goalId: goalId(1),
    expectedVersion: 1,
    displayedTenths: 43 as number | null,
    status: 'on_pace' as RatingGoalStatus,
    evaluatedAt: LATER,
    outcome: { kind: 'continues' } as RatingGoalEvaluationWrite['outcome'],
    ...overrides,
  })

  const reachedAt45 = {
    displayedTenths: 45,
    status: 'reached',
    outcome: { kind: 'reached' },
  } as const

  /** A manager's change of the plan, logged as the use case logs it. */
  const changePlanTo = (plan: RatingGoalPlan, fields: readonly RatingGoalChangeRow[]) =>
    repository().changePlan({
      organizationId: ORG,
      propertyId: PROPERTY,
      goalId: goalId(1),
      expectedVersion: 1,
      plan,
      changes: fields.map((field, index) => ({
        ...field,
        id: goalId(300 + index),
        goalId: goalId(1),
        organizationId: ORG,
        propertyId: PROPERTY,
        changedBy: 'manager-2',
        changedAt: LATER,
      })),
      changedAt: LATER,
    })

  it('refuses an evaluation worked out on a target a manager has since changed', async () => {
    // Read on 4.5 while Google showed 4.5; the manager then moved the target to 4.6.
    await changePlanTo({ mode: 'climb', targetTenths: 46, pacePerWeek: 11 }, [
      { field: 'target', oldValue: '45', newValue: '46' },
    ])

    await expect(repository().recordEvaluation(write(reachedAt45))).resolves.toBe(false)

    await expect(repository().findById(ORG, PROPERTY, goalId(1))).resolves.toMatchObject({
      state: 'active',
      targetTenths: 46,
      reachedAt: null,
      version: 2,
    })
  })

  it('refuses a reached evaluation from before a switch to keep, without breaking the table rules', async () => {
    await changePlanTo({ mode: 'keep', targetTenths: 43, pacePerWeek: null }, [
      { field: 'mode', oldValue: 'climb', newValue: 'keep' },
      { field: 'target', oldValue: '45', newValue: '43' },
      { field: 'pace', oldValue: '11', newValue: null },
    ])

    await expect(repository().recordEvaluation(write(reachedAt45))).resolves.toBe(false)

    await expect(repository().findActive(ORG, PROPERTY)).resolves.toMatchObject({
      mode: 'keep',
      state: 'active',
    })
  })

  it('never lets an older reading overwrite what a newer one stored', async () => {
    await repository().recordEvaluation(
      write({ displayedTenths: 44, status: 'below_pace' }),
    )

    // A page read that began before the newer numbers landed writes last.
    await expect(
      repository().recordEvaluation(
        write({ evaluatedAt: new Date(LATER.getTime() - 60_000) }),
      ),
    ).resolves.toBe(false)

    await expect(repository().findActive(ORG, PROPERTY)).resolves.toMatchObject({
      lastEvaluation: { displayedTenths: 44, status: 'below_pace', evaluatedAt: LATER },
    })
  })

  it('stores a new status and tenth once, and nothing for a repeat', async () => {
    await expect(repository().recordEvaluation(write())).resolves.toBe(true)
    await expect(repository().recordEvaluation(write())).resolves.toBe(false)

    await expect(repository().findActive(ORG, PROPERTY)).resolves.toMatchObject({
      lastEvaluation: { displayedTenths: 43, status: 'on_pace', evaluatedAt: LATER },
      version: 1,
    })
  })

  it('keeps the stored tenth while Google cannot be read', async () => {
    await repository().recordEvaluation(write())

    await repository().recordEvaluation(
      write({ displayedTenths: null, status: 'waiting_for_google' }),
    )

    await expect(repository().findActive(ORG, PROPERTY)).resolves.toMatchObject({
      lastEvaluation: { displayedTenths: 43, status: 'waiting_for_google' },
    })
  })

  it('reaches the goal once, with the date, and moves it to History', async () => {
    await expect(
      repository().recordEvaluation(
        write({ displayedTenths: 45, status: 'reached', outcome: { kind: 'reached' } }),
      ),
    ).resolves.toBe(true)
    await expect(
      repository().recordEvaluation(
        write({ displayedTenths: 45, status: 'reached', outcome: { kind: 'reached' } }),
      ),
    ).resolves.toBe(false)

    await expect(repository().findActive(ORG, PROPERTY)).resolves.toBeNull()
    await expect(repository().listHistory(ORG, PROPERTY, 20)).resolves.toEqual([
      expect.objectContaining({ id: goalId(1), state: 'reached', reachedAt: LATER }),
    ])
  })

  it('ends the goal when its Google location changed', async () => {
    await repository().recordEvaluation(
      write({ outcome: { kind: 'ended', reason: 'google_location_changed' } }),
    )

    await expect(repository().findById(ORG, PROPERTY, goalId(1))).resolves.toMatchObject({
      state: 'ended',
      endedReason: 'google_location_changed',
      endedAt: LATER,
    })
  })
})

describe('a Property archive', () => {
  const archive = (overrides: Record<string, unknown> = {}) => ({
    organizationId: ORG,
    propertyId: PROPERTY,
    // The goal was set under epoch 2; the archive moved the Property to 3.
    archivedEpoch: 3,
    endedAt: LATER,
    ...overrides,
  })

  it('ends the goal set before it, once, as property_archived', async () => {
    await repository().insert(newGoal())

    await expect(repository().endForArchivedProperty(archive())).resolves.toBe(true)
    await expect(repository().endForArchivedProperty(archive())).resolves.toBe(false)

    await expect(repository().findById(ORG, PROPERTY, goalId(1))).resolves.toMatchObject({
      state: 'ended',
      endedReason: 'property_archived',
      endedAt: LATER,
    })
  })

  it('leaves a goal set after a Restore alone when the fact arrives late', async () => {
    // Archive moved the Property to 3, Restore to 4; the new goal is at 4.
    await repository().insert(newGoal({ sourceEpoch: 4 }))

    await expect(repository().endForArchivedProperty(archive())).resolves.toBe(false)
    await expect(repository().findActive(ORG, PROPERTY)).resolves.toMatchObject({
      state: 'active',
    })
  })

  it('ends nothing in another Organization or Property', async () => {
    await repository().insert(newGoal())

    await expect(
      repository().endForArchivedProperty(archive({ organizationId: OTHER_ORG })),
    ).resolves.toBe(false)
    await expect(
      repository().endForArchivedProperty(archive({ propertyId: OTHER_PROPERTY })),
    ).resolves.toBe(false)
    await expect(repository().findActive(ORG, PROPERTY)).resolves.not.toBeNull()
  })
})

describe('the table holds the plan and the log to their rules', () => {
  it('refuses a climb without a pace, a climb to 5.0 and a keep with a pace', async () => {
    const insert = (values: Partial<typeof propertyRatingGoals.$inferInsert>) =>
      refused(() =>
        held.db.insert(propertyRatingGoals).values({
          id: goalId(9),
          organizationId: ORG,
          propertyId: PROPERTY,
          sourceEpoch: 2,
          mode: 'climb',
          targetTenths: 45,
          pacePerWeek: 11,
          baselineReviewCount: 812,
          baselineGoogleAverage: 4.3,
          baselineExactAverage: 4.31,
          createdBy: 'manager-1',
          ...values,
        }),
      )

    await expect(insert({ pacePerWeek: null })).resolves.toBe('23514')
    await expect(insert({ targetTenths: 50 })).resolves.toBe('23514')
    await expect(insert({ mode: 'keep' })).resolves.toBe('23514')
    await expect(insert({ status: 'reached' })).resolves.toBe('23514')
    await expect(insert({ status: 'ended', endedAt: LATER })).resolves.toBe('23514')
    await expect(
      insert({ status: 'ended', endedReason: 'deadline_missed', endedAt: LATER }),
    ).resolves.toBe('23514')
    await expect(insert({})).resolves.toBeUndefined()
  })

  it('refuses a log row that names another Property’s goal or changes nothing', async () => {
    await repository().insert(newGoal())
    const logRow = (values: Partial<typeof propertyRatingGoalChanges.$inferInsert>) =>
      refused(() =>
        held.db.insert(propertyRatingGoalChanges).values({
          id: goalId(201),
          goalId: goalId(1),
          organizationId: ORG,
          propertyId: PROPERTY,
          changedBy: 'manager-1',
          changedAt: LATER,
          field: 'pace',
          oldValue: '11',
          newValue: '14',
          ...values,
        }),
      )

    await expect(logRow({ propertyId: OTHER_PROPERTY })).resolves.toBe('23503')
    await expect(logRow({ newValue: '11' })).resolves.toBe('23514')
    await expect(logRow({ newValue: '201' })).resolves.toBe('23514')
    await expect(
      logRow({ field: 'target', oldValue: null, newValue: '45' }),
    ).resolves.toBe('23514')
    await expect(
      logRow({ field: 'mode', oldValue: null, newValue: 'keep' }),
    ).resolves.toBe('23514')
    await expect(
      logRow({ id: goalId(203), field: 'pace', oldValue: '11', newValue: null }),
    ).resolves.toBeUndefined()
    await expect(
      logRow({ field: 'mode', oldValue: 'climb', newValue: 'hold' }),
    ).resolves.toBe('23514')
    await expect(logRow({ id: goalId(202) })).resolves.toBeUndefined()
  })
})

describe('the Property facts a rating goal reads', () => {
  it('reads the zone, lifecycle, epoch and whether the binding is active', async () => {
    const facts = createRatingGoalPropertyFactsReader(held.db)

    await expect(facts.findPropertyFacts(ORG, OTHER_PROPERTY)).resolves.toEqual({
      timezone: 'Europe/Sofia',
      lifecycleState: 'active',
      sourceEpoch: 2,
      googleBindingActive: false,
    })
    await expect(facts.findPropertyFacts(ORG, FOREIGN_PROPERTY)).resolves.toBeNull()
  })

  it('holds no Organization without a lifecycle closure', async () => {
    await expect(repository().isOrganizationHeld(ORG)).resolves.toBe(false)
  })
})
