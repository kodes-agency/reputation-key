// The Property Google rating goal evaluation write against real PostgreSQL: the
// row changes only when something changed, notices are written as outbox facts
// with it, and a reading older than what is stored is refused.
//
// One held transaction per test, always rolled back.

import { beforeEach, describe, expect, it } from 'vitest'
import { and, asc, eq } from 'drizzle-orm'
import { outboxEvents } from '#/shared/db/schema/outbox.schema'
import type { RatingGoalEvaluationWrite } from './property-rating-goal-repository.port.server'
import type {
  PropertyRatingGoal,
  RatingGoalChangeRow,
  RatingGoalPlan,
  RatingGoalStatus,
} from '../domain/rating-goal'
import {
  LATER,
  ORG,
  PROPERTY,
  SET_AT,
  goalId,
  held,
  newGoal,
  repository,
  useRatingGoalStorageTransaction,
} from './property-rating-goal-storage.test-fixtures'

useRatingGoalStorageTransaction()

describe('an evaluation write', () => {
  beforeEach(async () => {
    await repository().insert(newGoal())
  })

  /** What the goal holds as set: the mark an evaluation reads first. */
  const AS_SET: RatingGoalEvaluationWrite['expectedMark'] = {
    displayedTenths: 43,
    knownStatus: 'getting_started',
    belowPaceNoticedAt: null,
    tooLowNoticedAt: null,
  }

  /** The mark an evaluation reads back from a stored goal. */
  const markOf = ({
    lastEvaluation,
  }: PropertyRatingGoal): RatingGoalEvaluationWrite['expectedMark'] => ({
    displayedTenths: lastEvaluation.displayedTenths,
    knownStatus: lastEvaluation.knownStatus,
    belowPaceNoticedAt: lastEvaluation.belowPaceNoticedAt,
    tooLowNoticedAt: lastEvaluation.tooLowNoticedAt,
  })

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
      tooLowNoticedAt: null,
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
      paceSince: LATER,
      forgetsKnownStatus: true,
    })

  it('refuses an evaluation worked out on a target a manager has since changed', async () => {
    // Read on 4.5 while Google showed 4.5; the manager then moved the target to 4.6.
    await changePlanTo(
      { mode: 'climb', targetTenths: 46, qualityTenths: 47, paceTenthsPerWeek: 110 },
      [{ field: 'target', oldValue: '45', newValue: '46' }],
    )

    await expect(repository().recordEvaluation(write(reachedAt45))).resolves.toBe(false)

    await expect(repository().findById(ORG, PROPERTY, goalId(1))).resolves.toMatchObject({
      state: 'active',
      targetTenths: 46,
      reachedAt: null,
      version: 2,
    })
  })

  it('refuses a reached evaluation from before a switch to keep, without breaking the table rules', async () => {
    await changePlanTo(
      { mode: 'keep', targetTenths: 43, qualityTenths: null, paceTenthsPerWeek: null },
      [
        { field: 'mode', oldValue: 'climb', newValue: 'keep' },
        { field: 'target', oldValue: '45', newValue: '43' },
        { field: 'quality', oldValue: '47', newValue: null },
        { field: 'pace', oldValue: '110', newValue: null },
      ],
    )

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
              paceTenthsPerWeek: 110,
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
        paceTenthsPerWeek: null,
      }),
      expect.objectContaining({
        transition: 'entered_below_pace',
        pacePerWeek: 11,
        paceTenthsPerWeek: 110,
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

  it('writes the too-low fact with the target alone, and stores when it was told', async () => {
    await expect(
      repository().recordEvaluation(
        write({
          status: 'reviews_too_low',
          tooLowNoticedAt: LATER,
          notices: [{ transition: 'entered_reviews_too_low', targetTenths: 45 }],
        }),
      ),
    ).resolves.toBe(true)

    const [fact, ...rest] = await noticeFacts()
    expect(rest).toEqual([])
    expect(fact?.payload).toMatchObject({
      transition: 'entered_reviews_too_low',
      targetTenths: 45,
      shownTenths: null,
      previousTenths: null,
      pacePerWeek: null,
      paceTenthsPerWeek: null,
      recentPaceTenths: null,
      paceWindow: null,
    })
    await expect(repository().findActive(ORG, PROPERTY)).resolves.toMatchObject({
      lastEvaluation: {
        knownStatus: 'reviews_too_low',
        tooLowNoticedAt: LATER,
        belowPaceNoticedAt: null,
      },
    })
  })

  it.each([
    [
      'applies a later evaluation onto the below-pace notice time it read back',
      { status: 'below_pace', belowPaceNoticedAt: LATER },
      { belowPaceNoticedAt: LATER },
    ],
    [
      'applies a later evaluation onto the too-low notice time it read back',
      { status: 'reviews_too_low', tooLowNoticedAt: LATER },
      { tooLowNoticedAt: LATER },
    ],
  ] as const)('%s', async (_title, first, noticedAgain) => {
    await repository().recordEvaluation(write(first))
    const stored = await repository().findActive(ORG, PROPERTY)

    await expect(
      repository().recordEvaluation(
        write({
          ...noticedAgain,
          expectedMark: markOf(stored!),
          status: 'on_pace',
          evaluatedAt: new Date(LATER.getTime() + 60_000),
        }),
      ),
    ).resolves.toBe(true)
    await expect(repository().findActive(ORG, PROPERTY)).resolves.toMatchObject({
      lastEvaluation: { status: 'on_pace', knownStatus: 'on_pace', ...noticedAgain },
    })
  })

  it('refuses an evaluation read before the too-low notice time it would overwrite was stored', async () => {
    // Stored: a below-pace goal whose managers were told new reviews were too low at LATER.
    await repository().recordEvaluation(
      write({ status: 'below_pace', tooLowNoticedAt: LATER }),
    )

    // Read on the same tenth and known status, but before that time landed.
    await expect(
      repository().recordEvaluation(
        write({
          expectedMark: { ...AS_SET, knownStatus: 'below_pace' },
          status: 'on_pace',
          tooLowNoticedAt: null,
          evaluatedAt: new Date(LATER.getTime() + 60_000),
        }),
      ),
    ).resolves.toBe(false)

    await expect(repository().findActive(ORG, PROPERTY)).resolves.toMatchObject({
      lastEvaluation: { status: 'below_pace', tooLowNoticedAt: LATER },
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
        tooLowNoticedAt: SET_AT,
      }),
    )

    await changePlanTo(
      { mode: 'climb', targetTenths: 46, qualityTenths: 47, paceTenthsPerWeek: 110 },
      [{ field: 'target', oldValue: '45', newValue: '46' }],
    )

    await expect(repository().findActive(ORG, PROPERTY)).resolves.toMatchObject({
      targetTenths: 46,
      lastEvaluation: {
        status: 'below_pace',
        knownStatus: null,
        belowPaceNoticedAt: LATER,
        tooLowNoticedAt: SET_AT,
      },
      version: 2,
    })
  })

  it('stores the status a new plan puts the goal in, without a notice', async () => {
    await changePlanTo(
      { mode: 'climb', targetTenths: 46, qualityTenths: 47, paceTenthsPerWeek: 110 },
      [{ field: 'target', oldValue: '45', newValue: '46' }],
    )

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
