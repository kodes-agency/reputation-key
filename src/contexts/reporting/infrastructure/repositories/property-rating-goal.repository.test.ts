// The Property Google rating goal repository against real PostgreSQL: one
// active goal per Property, the version compare-and-set, the change log, the
// evaluation write that changes the row only when something changed and
// writes its notices as outbox facts with it, the daily listing, the tenant
// scope of every read, and the table checks behind them.
//
// One held transaction per test, always rolled back; a statement expected to
// fail runs in its own savepoint.

import { and, asc, eq } from 'drizzle-orm'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  propertyRatingGoalChanges,
  propertyRatingGoalDeferrals,
  propertyRatingGoals,
} from '#/shared/db/schema/goal.schema'
import { outboxEvents } from '#/shared/db/schema/outbox.schema'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
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
  lastEvaluation: {
    displayedTenths: 43,
    status: 'getting_started',
    evaluatedAt: SET_AT,
    knownStatus: 'getting_started',
    belowPaceNoticedAt: null,
    cantReachNoticedAt: null,
  },
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

beforeAll(() => {
  registerAllEventSchemas()
})

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

  /** What the goal holds as set: the mark an evaluation reads first. */
  const AS_SET: RatingGoalEvaluationWrite['expectedMark'] = {
    displayedTenths: 43,
    knownStatus: 'getting_started',
    belowPaceNoticedAt: null,
    cantReachNoticedAt: null,
  }

  /** An evaluation read on `expectedMark`; its known status follows its status. */
  const write = (
    overrides: Partial<RatingGoalEvaluationWrite> = {},
  ): RatingGoalEvaluationWrite => {
    const status: RatingGoalStatus = overrides.status ?? 'on_pace'
    return {
      organizationId: ORG,
      propertyId: PROPERTY,
      goalId: goalId(1),
      expectedVersion: 1,
      expectedMark: AS_SET,
      displayedTenths: 43,
      status,
      knownStatus: status === 'waiting_for_google' ? 'getting_started' : status,
      belowPaceNoticedAt: null,
      cantReachNoticedAt: null,
      evaluatedAt: LATER,
      outcome: { kind: 'continues' },
      notices: [],
      ...overrides,
    }
  }

  /** The facts the held transaction's evaluations wrote, oldest first. */
  const noticeFacts = () =>
    held.db
      .select({
        eventType: outboxEvents.eventType,
        organizationId: outboxEvents.organizationId,
        propertyId: outboxEvents.propertyId,
        payload: outboxEvents.payload,
        createdAt: outboxEvents.createdAt,
      })
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.organizationId, ORG),
          eq(outboxEvents.eventType, 'goal.rating_goal.transitioned'),
        ),
      )
      .orderBy(asc(outboxEvents.createdAt))

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
        write({
          expectedMark: { ...AS_SET, displayedTenths: 44, knownStatus: 'below_pace' },
          evaluatedAt: new Date(LATER.getTime() - 60_000),
        }),
      ),
    ).resolves.toBe(false)

    await expect(repository().findActive(ORG, PROPERTY)).resolves.toMatchObject({
      lastEvaluation: { displayedTenths: 44, status: 'below_pace', evaluatedAt: LATER },
    })
  })

  it('stores a new status and tenth once, and nothing for a repeat', async () => {
    await expect(repository().recordEvaluation(write())).resolves.toBe(true)
    await expect(
      repository().recordEvaluation(
        write({ expectedMark: { ...AS_SET, knownStatus: 'on_pace' } }),
      ),
    ).resolves.toBe(false)

    await expect(repository().findActive(ORG, PROPERTY)).resolves.toMatchObject({
      lastEvaluation: { displayedTenths: 43, status: 'on_pace', evaluatedAt: LATER },
      version: 1,
    })
  })

  it('keeps the stored tenth and the known status while Google cannot be read', async () => {
    await repository().recordEvaluation(write())

    await repository().recordEvaluation(
      write({
        expectedMark: { ...AS_SET, knownStatus: 'on_pace' },
        displayedTenths: null,
        status: 'waiting_for_google',
        knownStatus: 'on_pace',
      }),
    )

    await expect(repository().findActive(ORG, PROPERTY)).resolves.toMatchObject({
      lastEvaluation: {
        displayedTenths: 43,
        status: 'waiting_for_google',
        knownStatus: 'on_pace',
      },
    })
  })

  it('writes one fact per notice with the row, carrying the figures the notice states', async () => {
    const belowPaceAt = LATER

    await expect(
      repository().recordEvaluation(
        write({
          displayedTenths: 42,
          status: 'below_pace',
          belowPaceNoticedAt: belowPaceAt,
          notices: [
            {
              transition: 'google_rating_changed',
              mode: 'climb',
              targetTenths: 45,
              shownTenths: 42,
              previousTenths: 43,
            },
            {
              transition: 'entered_below_pace',
              targetTenths: 45,
              pacePerWeek: 11,
              recentPaceTenths: 65,
              paceWindow: 'last_4_weeks',
            },
          ],
        }),
      ),
    ).resolves.toBe(true)

    const facts = await noticeFacts()
    expect(facts).toHaveLength(2)
    expect(facts.map((fact) => fact.payload)).toEqual([
      expect.objectContaining({
        organizationId: ORG,
        propertyId: PROPERTY,
        goalId: goalId(1),
        transition: 'google_rating_changed',
        mode: 'climb',
        targetTenths: 45,
        shownTenths: 42,
        previousTenths: 43,
        pacePerWeek: null,
      }),
      expect.objectContaining({
        transition: 'entered_below_pace',
        pacePerWeek: 11,
        recentPaceTenths: 65,
        paceWindow: 'last_4_weeks',
        shownTenths: null,
      }),
    ])
    expect(facts.every((fact) => fact.propertyId === PROPERTY)).toBe(true)
    await expect(repository().findActive(ORG, PROPERTY)).resolves.toMatchObject({
      lastEvaluation: {
        displayedTenths: 42,
        knownStatus: 'below_pace',
        belowPaceNoticedAt: belowPaceAt,
      },
    })
  })

  it('tells a change once: a second evaluation read before it was stored writes nothing', async () => {
    const gained = write({
      displayedTenths: 44,
      notices: [
        {
          transition: 'google_rating_changed',
          mode: 'climb',
          targetTenths: 45,
          shownTenths: 44,
          previousTenths: 43,
        },
      ],
    })

    await expect(repository().recordEvaluation(gained)).resolves.toBe(true)
    // Read on the same 4.3 a moment later, after Google moved again.
    await expect(
      repository().recordEvaluation({
        ...gained,
        displayedTenths: 45,
        evaluatedAt: new Date(LATER.getTime() + 60_000),
      }),
    ).resolves.toBe(false)

    await expect(noticeFacts()).resolves.toHaveLength(1)
    await expect(repository().findActive(ORG, PROPERTY)).resolves.toMatchObject({
      lastEvaluation: { displayedTenths: 44, evaluatedAt: LATER },
    })
  })

  it('applies a later evaluation onto the below-pace notice time it read back', async () => {
    await repository().recordEvaluation(
      write({ status: 'below_pace', belowPaceNoticedAt: LATER }),
    )
    const stored = await repository().findActive(ORG, PROPERTY)

    await expect(
      repository().recordEvaluation(
        write({
          expectedMark: {
            displayedTenths: stored!.lastEvaluation.displayedTenths,
            knownStatus: stored!.lastEvaluation.knownStatus,
            belowPaceNoticedAt: stored!.lastEvaluation.belowPaceNoticedAt,
            cantReachNoticedAt: stored!.lastEvaluation.cantReachNoticedAt,
          },
          status: 'on_pace',
          belowPaceNoticedAt: LATER,
          evaluatedAt: new Date(LATER.getTime() + 60_000),
        }),
      ),
    ).resolves.toBe(true)
    await expect(repository().findActive(ORG, PROPERTY)).resolves.toMatchObject({
      lastEvaluation: {
        status: 'on_pace',
        knownStatus: 'on_pace',
        belowPaceNoticedAt: LATER,
      },
    })
  })

  it('writes the Can’t reach fact with the target alone, and stores when it was told', async () => {
    await expect(
      repository().recordEvaluation(
        write({
          status: 'cant_reach_at_mix',
          cantReachNoticedAt: LATER,
          notices: [{ transition: 'entered_cant_reach', targetTenths: 45 }],
        }),
      ),
    ).resolves.toBe(true)

    const [fact, ...rest] = await noticeFacts()
    expect(rest).toEqual([])
    expect(fact?.payload).toMatchObject({
      transition: 'entered_cant_reach',
      targetTenths: 45,
      shownTenths: null,
      previousTenths: null,
      pacePerWeek: null,
      recentPaceTenths: null,
      paceWindow: null,
    })
    await expect(repository().findActive(ORG, PROPERTY)).resolves.toMatchObject({
      lastEvaluation: {
        knownStatus: 'cant_reach_at_mix',
        cantReachNoticedAt: LATER,
        belowPaceNoticedAt: null,
      },
    })
  })

  it('applies a later evaluation onto the Can’t reach notice time it read back', async () => {
    await repository().recordEvaluation(
      write({ status: 'cant_reach_at_mix', cantReachNoticedAt: LATER }),
    )
    const stored = await repository().findActive(ORG, PROPERTY)

    await expect(
      repository().recordEvaluation(
        write({
          expectedMark: {
            displayedTenths: stored!.lastEvaluation.displayedTenths,
            knownStatus: stored!.lastEvaluation.knownStatus,
            belowPaceNoticedAt: stored!.lastEvaluation.belowPaceNoticedAt,
            cantReachNoticedAt: stored!.lastEvaluation.cantReachNoticedAt,
          },
          status: 'on_pace',
          cantReachNoticedAt: LATER,
          evaluatedAt: new Date(LATER.getTime() + 60_000),
        }),
      ),
    ).resolves.toBe(true)
    await expect(repository().findActive(ORG, PROPERTY)).resolves.toMatchObject({
      lastEvaluation: {
        status: 'on_pace',
        knownStatus: 'on_pace',
        cantReachNoticedAt: LATER,
      },
    })
  })

  it('refuses an evaluation read before the Can’t reach notice time it would overwrite was stored', async () => {
    // Stored: a below-pace goal whose managers were told Can't reach at LATER.
    await repository().recordEvaluation(
      write({ status: 'below_pace', cantReachNoticedAt: LATER }),
    )

    // Read on the same tenth and known status, but before that time landed.
    await expect(
      repository().recordEvaluation(
        write({
          expectedMark: { ...AS_SET, knownStatus: 'below_pace' },
          status: 'on_pace',
          cantReachNoticedAt: null,
          evaluatedAt: new Date(LATER.getTime() + 60_000),
        }),
      ),
    ).resolves.toBe(false)

    await expect(repository().findActive(ORG, PROPERTY)).resolves.toMatchObject({
      lastEvaluation: { status: 'below_pace', cantReachNoticedAt: LATER },
    })
  })

  it('writes no fact for an evaluation that stores nothing', async () => {
    await repository().recordEvaluation(write())

    await expect(
      repository().recordEvaluation(
        write({
          expectedMark: { ...AS_SET, knownStatus: 'on_pace' },
          evaluatedAt: new Date(LATER.getTime() + 60_000),
        }),
      ),
    ).resolves.toBe(false)
    await expect(noticeFacts()).resolves.toEqual([])
  })

  it('forgets the known status when a manager changes the plan, and keeps when it last told', async () => {
    await repository().recordEvaluation(
      write({
        status: 'below_pace',
        belowPaceNoticedAt: LATER,
        cantReachNoticedAt: SET_AT,
      }),
    )

    await changePlanTo({ mode: 'climb', targetTenths: 45, pacePerWeek: 8 }, [
      { field: 'pace', oldValue: '11', newValue: '8' },
    ])

    await expect(repository().findActive(ORG, PROPERTY)).resolves.toMatchObject({
      pacePerWeek: 8,
      lastEvaluation: {
        status: 'below_pace',
        knownStatus: null,
        belowPaceNoticedAt: LATER,
        cantReachNoticedAt: SET_AT,
      },
      version: 2,
    })
  })

  it('stores the status a new plan puts the goal in, without a notice', async () => {
    await changePlanTo({ mode: 'climb', targetTenths: 45, pacePerWeek: 20 }, [
      { field: 'pace', oldValue: '11', newValue: '20' },
    ])

    await expect(
      repository().recordEvaluation(
        write({
          expectedVersion: 2,
          expectedMark: { ...AS_SET, knownStatus: null },
          status: 'getting_started',
          knownStatus: 'getting_started',
          evaluatedAt: new Date(LATER.getTime() + 60_000),
        }),
      ),
    ).resolves.toBe(true)
    await expect(repository().findActive(ORG, PROPERTY)).resolves.toMatchObject({
      lastEvaluation: { status: 'getting_started', knownStatus: 'getting_started' },
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
    await repository().endByManager({
      organizationId: ORG,
      propertyId: PROPERTY,
      goalId: goalId(1),
      expectedVersion: 1,
      endedAt: LATER,
    })

    const scopes = await repository().listActiveGoalScopes({ goalId: goalId(0) }, 10)
    expect(scopes.filter((scope) => scope.organizationId === ORG)).toEqual([])
  })
})

describe('the table holds the plan and the log to their rules', () => {
  it('refuses a known status that is a wait for Google', async () => {
    await expect(
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
          lastKnownStatus: 'waiting_for_google',
        }),
      ),
    ).resolves.toBe('23514')
  })

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

  it('holds no Organization without a lifecycle closure', async () => {
    await expect(repository().isOrganizationHeld(ORG)).resolves.toBe(false)
  })
})
