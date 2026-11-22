// The Property Google rating goal table checks against real PostgreSQL: the
// plan, status, pace and log rows each refuse what the domain never writes.
//
// One held transaction per test, always rolled back; a statement expected to
// fail runs in its own savepoint.

import { describe, expect, it } from 'vitest'
import {
  propertyRatingGoalChanges,
  propertyRatingGoals,
} from '#/shared/db/schema/goal.schema'
import { legacyPacePerWeek } from '../domain/rating-goal-pace'
import {
  LATER,
  ORG,
  OTHER_PROPERTY,
  PROPERTY,
  goalId,
  held,
  newGoal,
  refused,
  repository,
  useRatingGoalStorageTransaction,
} from './property-rating-goal-storage.test-fixtures'

useRatingGoalStorageTransaction()

type GoalRow = Partial<typeof propertyRatingGoals.$inferInsert>
type LogRow = Partial<typeof propertyRatingGoalChanges.$inferInsert>
type Probe<V> = readonly [label: string, values: V, code: string | undefined]

const CHECK_VIOLATION = '23514'
const FOREIGN_KEY_VIOLATION = '23503'

/** A goal row that satisfies every check, with `values` laid over it. */
const insertGoalRow = (values: GoalRow) =>
  refused(() =>
    held.db.insert(propertyRatingGoals).values({
      id: goalId(9),
      organizationId: ORG,
      propertyId: PROPERTY,
      sourceEpoch: 2,
      mode: 'climb',
      targetTenths: 45,
      qualityTenths: 47,
      pacePerWeek: 11,
      paceTenthsPerWeek: 110,
      baselineReviewCount: 812,
      baselineGoogleAverage: 4.3,
      baselineExactAverage: 4.31,
      createdBy: 'manager-1',
      ...values,
    }),
  )

/** A log row that satisfies every check, with `values` laid over it. */
const insertLogRow = (values: LogRow) =>
  refused(() =>
    held.db.insert(propertyRatingGoalChanges).values({
      id: goalId(201),
      goalId: goalId(1),
      organizationId: ORG,
      propertyId: PROPERTY,
      changedBy: 'manager-1',
      changedAt: LATER,
      field: 'pace',
      oldValue: '110',
      newValue: '140',
      ...values,
    }),
  )

/** Runs the probes in order: a passing one stays in the held transaction. */
async function expectProbes<V>(
  run: (values: V) => Promise<string | undefined>,
  probes: readonly Probe<V>[],
) {
  for (const [label, values, code] of probes) {
    expect(await run(values), label).toBe(code)
  }
}

describe('the table holds the plan and the log to their rules', () => {
  it('refuses a known status that is a wait for Google', async () => {
    await expectProbes(insertGoalRow, [
      [
        'waiting_for_google as known',
        { lastKnownStatus: 'waiting_for_google' },
        CHECK_VIOLATION,
      ],
    ])
  })

  it('refuses the retired status, as last seen or as known', async () => {
    await expectProbes(insertGoalRow, [
      [
        'retired as last seen',
        { lastEvaluatedStatus: 'cant_reach_at_mix' },
        CHECK_VIOLATION,
      ],
      ['retired as known', { lastKnownStatus: 'cant_reach_at_mix' }, CHECK_VIOLATION],
      [
        'a live status in both',
        { lastEvaluatedStatus: 'reviews_too_low', lastKnownStatus: 'reviews_too_low' },
        undefined,
      ],
    ])
  })

  it('refuses a climb without a planned quality or below its target, and a keep with one', async () => {
    await expectProbes(insertGoalRow, [
      ['climb without quality', { qualityTenths: null }, CHECK_VIOLATION],
      // At or below the threshold no count of reviews gets there; the floor
      // above it is the domain's rule.
      ['quality below the target', { qualityTenths: 44 }, CHECK_VIOLATION],
      ['quality above the ceiling', { qualityTenths: 51 }, CHECK_VIOLATION],
      [
        'keep with a quality',
        {
          mode: 'keep',
          targetTenths: 43,
          pacePerWeek: null,
          paceTenthsPerWeek: null,
          qualityTenths: 47,
        },
        CHECK_VIOLATION,
      ],
      ['quality at the target', { qualityTenths: 45 }, undefined],
    ])
  })

  it('refuses a climb without a pace, a climb to 5.0 and a keep with a pace', async () => {
    await expectProbes(insertGoalRow, [
      [
        'climb without a pace',
        { pacePerWeek: null, paceTenthsPerWeek: null },
        CHECK_VIOLATION,
      ],
      ['climb to 5.0', { targetTenths: 50 }, CHECK_VIOLATION],
      ['keep with a pace', { mode: 'keep', qualityTenths: null }, CHECK_VIOLATION],
      ['status reached set by hand', { status: 'reached' }, CHECK_VIOLATION],
      [
        'status ended without a reason',
        { status: 'ended', endedAt: LATER },
        CHECK_VIOLATION,
      ],
      [
        'status ended as deadline_missed',
        { status: 'ended', endedReason: 'deadline_missed', endedAt: LATER },
        CHECK_VIOLATION,
      ],
      ['the base row', {}, undefined],
    ])
  })

  it('holds the whole weekly pace equal to the tenths, half up and at least one', async () => {
    // The same table as legacyPacePerWeek's (rating-goal-pace.test.ts).
    for (const [tenths, perWeek] of [
      [10, 1],
      [14, 1],
      [15, 2],
      [105, 11],
      [3500, 350],
    ] as const) {
      await expectProbes(insertGoalRow, [
        [
          `${tenths} tenths with ${perWeek} a week`,
          { paceTenthsPerWeek: tenths, pacePerWeek: perWeek },
          undefined,
        ],
        [
          `${tenths} tenths with ${perWeek + 1} a week`,
          { id: goalId(10), paceTenthsPerWeek: tenths, pacePerWeek: perWeek + 1 },
          CHECK_VIOLATION,
        ],
      ])
      expect(legacyPacePerWeek(tenths)).toBe(perWeek)
      await held.client.query('DELETE FROM property_rating_goals WHERE id = $1', [
        goalId(9),
      ])
    }
    await expectProbes(insertGoalRow, [
      [
        '105 tenths with 10 a week',
        { paceTenthsPerWeek: 105, pacePerWeek: 10 },
        CHECK_VIOLATION,
      ],
      [
        'a weekly pace without tenths',
        { paceTenthsPerWeek: null, pacePerWeek: 11 },
        CHECK_VIOLATION,
      ],
      [
        'tenths without a weekly pace',
        { paceTenthsPerWeek: 110, pacePerWeek: null },
        CHECK_VIOLATION,
      ],
      ['9 tenths', { paceTenthsPerWeek: 9, pacePerWeek: 1 }, CHECK_VIOLATION],
      ['3501 tenths', { paceTenthsPerWeek: 3501, pacePerWeek: 351 }, CHECK_VIOLATION],
    ])
  })

  it('round-trips a pace in tenths and writes its whole weekly mirror', async () => {
    await repository().insert(newGoal({ paceTenthsPerWeek: 105 }))

    await expect(repository().findActive(ORG, PROPERTY)).resolves.toMatchObject({
      paceTenthsPerWeek: 105,
    })
    const { rows } = await held.client.query<{ pace_per_week: number }>(
      'SELECT pace_per_week FROM property_rating_goals WHERE id = $1',
      [goalId(1)],
    )
    expect(rows).toEqual([{ pace_per_week: 11 }])
  })

  it('refuses a log row that names another Property’s goal or changes nothing', async () => {
    await repository().insert(newGoal())

    await expectProbes(insertLogRow, [
      ['another Property’s goal', { propertyId: OTHER_PROPERTY }, FOREIGN_KEY_VIOLATION],
      ['a pace logged as unchanged', { newValue: '110' }, CHECK_VIOLATION],
      // A pace is logged in tenths of a review a week, 10 to 3500.
      ['a pace above 3500', { newValue: '3501' }, CHECK_VIOLATION],
      ['a pace below 10', { newValue: '9' }, CHECK_VIOLATION],
      ['a pace with a leading zero', { newValue: '010' }, CHECK_VIOLATION],
      [
        'a pace at the ceiling',
        { id: goalId(206), oldValue: '35', newValue: '3500' },
        undefined,
      ],
      [
        'a target set from nothing',
        { field: 'target', oldValue: null, newValue: '45' },
        CHECK_VIOLATION,
      ],
      [
        'a mode set from nothing',
        { field: 'mode', oldValue: null, newValue: 'keep' },
        CHECK_VIOLATION,
      ],
      [
        'a pace cleared',
        { id: goalId(203), field: 'pace', oldValue: '110', newValue: null },
        undefined,
      ],
      [
        'a mode the table does not know',
        { field: 'mode', oldValue: 'climb', newValue: 'hold' },
        CHECK_VIOLATION,
      ],
      [
        'a quality changed',
        { id: goalId(204), field: 'quality', oldValue: '47', newValue: '48' },
        undefined,
      ],
      [
        'a quality cleared',
        { id: goalId(205), field: 'quality', oldValue: '47', newValue: null },
        undefined,
      ],
      [
        'a quality above the ceiling',
        { field: 'quality', oldValue: '47', newValue: '51' },
        CHECK_VIOLATION,
      ],
      ['the base row', { id: goalId(202) }, undefined],
    ])
  })
})
