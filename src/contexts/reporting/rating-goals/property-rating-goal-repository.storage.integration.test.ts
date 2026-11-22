// The Property Google rating goal repository against real PostgreSQL: one
// active goal per Property, the version compare-and-set, the change log, the
// daily listing, the tenant scope of every read, "Not now" and the Property
// facts it reads.
//
// One held transaction per test, always rolled back; a statement expected to
// fail runs in its own savepoint.

import { beforeEach, describe, expect, it } from 'vitest'
import {
  propertyRatingGoalChanges,
  propertyRatingGoalDeferrals,
} from '#/shared/db/schema/goal.schema'
import { createRatingGoalPropertyFactsReader } from './property-rating-goal-repository.server'
import {
  FOREIGN_PROPERTY,
  LATER,
  ORG,
  OTHER_ORG,
  OTHER_PROPERTY,
  PROPERTY,
  SET_AT,
  goalId,
  held,
  newGoal,
  refused,
  repository,
  useRatingGoalStorageTransaction,
} from './property-rating-goal-storage.test-fixtures'

useRatingGoalStorageTransaction()

/** Ends the first goal as its manager at version 1. */
const endGoal1 = () =>
  repository().endByManager({
    organizationId: ORG,
    propertyId: PROPERTY,
    goalId: goalId(1),
    expectedVersion: 1,
    endedAt: LATER,
  })

describe('one active rating goal per Property', () => {
  it('stores a goal with the tenth and status it was set at, and finds it as the Property’s active goal', async () => {
    await expect(repository().insert(newGoal())).resolves.toBe('inserted')

    const active = await repository().findActive(ORG, PROPERTY)

    expect(active).toMatchObject({
      id: goalId(1),
      mode: 'climb',
      targetTenths: 45,
      qualityTenths: 47,
      paceTenthsPerWeek: 110,
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
    await endGoal1()
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
    plan: {
      mode: 'climb' as const,
      targetTenths: 46,
      qualityTenths: 48,
      paceTenthsPerWeek: 140,
    },
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
        oldValue: '110',
        newValue: '140',
      },
      {
        id: goalId(103),
        goalId: goalId(1),
        organizationId: ORG,
        propertyId: PROPERTY,
        changedBy: 'manager-2',
        changedAt: LATER,
        field: 'quality' as const,
        oldValue: '47',
        newValue: '48',
      },
    ],
    changedAt: LATER,
    paceSince: LATER,
    forgetsKnownStatus: true,
  })

  it('writes the plan and its log rows, and moves the version', async () => {
    await expect(repository().changePlan(change(1))).resolves.toBe('written')

    await expect(repository().findById(ORG, PROPERTY, goalId(1))).resolves.toMatchObject({
      targetTenths: 46,
      qualityTenths: 48,
      paceTenthsPerWeek: 140,
      version: 2,
    })
    const log = await repository().listChanges(ORG, PROPERTY, goalId(1), 50)
    expect(
      log.recent.map(({ field, oldValue, newValue, changedBy }) => [
        field,
        oldValue,
        newValue,
        changedBy,
      ]),
    ).toEqual([
      // One change at one instant reads mode, target, quality, then pace.
      ['target', '45', '46', 'manager-2'],
      ['quality', '47', '48', 'manager-2'],
      ['pace', '110', '140', 'manager-2'],
    ])
  })

  it('refuses a stale version and an ended goal', async () => {
    await expect(repository().changePlan(change(2))).resolves.toBe('version_conflict')
    await endGoal1()
    await expect(repository().changePlan(change(2))).resolves.toBe('not_active')
    await expect(repository().listChanges(ORG, PROPERTY, goalId(1), 50)).resolves.toEqual(
      { recent: [], firstPerField: [] },
    )
  })

  it('never shows one Organization the log of another', async () => {
    await repository().changePlan(change(1))

    await expect(
      repository().listChanges(OTHER_ORG, PROPERTY, goalId(1), 50),
    ).resolves.toEqual({ recent: [], firstPerField: [] })
  })

  it('finds what the goal was set with past the newest 50 changes, in one read', async () => {
    const DAY_MS = 24 * 60 * 60 * 1000
    const row = (
      n: number,
      field: 'target' | 'pace',
      oldValue: string,
      newValue: string,
    ) => ({
      id: goalId(200 + n),
      goalId: goalId(1),
      organizationId: ORG,
      propertyId: PROPERTY,
      changedBy: 'manager-2',
      changedAt: new Date(SET_AT.getTime() + (n + 1) * DAY_MS),
      field,
      oldValue,
      newValue,
    })
    // The target moved once, first; then the pace 51 times.
    await held.db
      .insert(propertyRatingGoalChanges)
      .values([
        row(0, 'target', '45', '46'),
        ...Array.from({ length: 51 }, (_, n) =>
          row(n + 1, 'pace', String(110 + n), String(111 + n)),
        ),
      ])

    const log = await repository().listChanges(ORG, PROPERTY, goalId(1), 50)

    expect(log.recent).toHaveLength(50)
    expect(log.recent[0]).toMatchObject({ field: 'pace', newValue: '161' })
    expect(log.recent.some((change) => change.field === 'target')).toBe(false)
    expect(
      log.firstPerField
        .map(({ field, oldValue }) => [field, oldValue])
        .sort(([a], [b]) => String(a).localeCompare(String(b))),
    ).toEqual([
      ['pace', '110'],
      ['target', '45'],
    ])
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

describe('the daily listing of active goals', () => {
  it('pages through every active goal across Organizations in goal id order', async () => {
    await repository().insert(newGoal({ id: goalId(3) }))
    await repository().insert(
      newGoal({ id: goalId(2), propertyId: OTHER_PROPERTY, organizationId: ORG }),
    )
    await repository().insert(
      newGoal({ id: goalId(4), organizationId: OTHER_ORG, propertyId: FOREIGN_PROPERTY }),
    )

    // Other suites may hold goals of their own: start below these ids, and
    // keep to these Organizations.
    const ours = (scopes: readonly { organizationId: string }[]) =>
      scopes.filter((scope) => [ORG, OTHER_ORG].includes(scope.organizationId))
    const first = await repository().listActiveGoalScopes({ goalId: goalId(0) }, 2)
    const rest = ours(await repository().listActiveGoalScopes({ goalId: goalId(3) }, 2))

    expect(first).toEqual([
      { goalId: goalId(2), organizationId: ORG, propertyId: OTHER_PROPERTY },
      { goalId: goalId(3), organizationId: ORG, propertyId: PROPERTY },
    ])
    expect(rest).toEqual([
      { goalId: goalId(4), organizationId: OTHER_ORG, propertyId: FOREIGN_PROPERTY },
    ])
  })

  it('leaves reached and ended goals out', async () => {
    await repository().insert(newGoal())
    await endGoal1()

    const scopes = await repository().listActiveGoalScopes({ goalId: goalId(0) }, 10)
    expect(scopes.filter((scope) => scope.organizationId === ORG)).toEqual([])
  })
})

describe('"Not now" for a Property’s rating goal', () => {
  const choice = { organizationId: ORG, propertyId: PROPERTY, chosenBy: 'manager-1' }

  it('records who chose it and when, once per Property', async () => {
    // Act
    const first = await repository().recordNotNow({ ...choice, chosenAt: SET_AT })
    const again = await repository().recordNotNow({
      ...choice,
      chosenBy: 'manager-2',
      chosenAt: LATER,
    })

    // Assert
    expect([first, again]).toEqual([true, false])
    const rows = await held.db.select().from(propertyRatingGoalDeferrals)
    expect(rows).toEqual([
      {
        propertyId: PROPERTY,
        organizationId: ORG,
        deferredBy: 'manager-1',
        deferredAt: SET_AT,
      },
    ])
  })

  it('refuses a Property of another Organization', async () => {
    // Act
    const code = await refused(() =>
      repository().recordNotNow({
        ...choice,
        propertyId: FOREIGN_PROPERTY,
        chosenAt: SET_AT,
      }),
    )

    // Assert: the tenant foreign key.
    expect(code).toBe('23503')
  })

  it('goes with its Property', async () => {
    // Arrange
    await repository().recordNotNow({ ...choice, chosenAt: SET_AT })

    // Act
    await held.client.query(`DELETE FROM properties WHERE id = $1::uuid`, [PROPERTY])

    // Assert
    const rows = await held.db.select().from(propertyRatingGoalDeferrals)
    expect(rows).toEqual([])
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
})
