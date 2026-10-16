// Migration 0061 against real PostgreSQL, on goals stored the way 0060 stored
// them: no pace start and no answered check-in. Inside one held transaction,
// always rolled back, the two columns are dropped, goals and their change logs
// are seeded, and 0061 is run on them statement by statement.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  holdTransaction,
  type HeldTransaction,
} from '#/shared/db/testing/held-transaction'

const DRIZZLE = join(import.meta.dirname, '..', '..', '..', '..', 'drizzle')

const STATEMENTS = readFileSync(join(DRIZZLE, '0061_rating_goal_pace_since.sql'), 'utf8')
  .split('--> statement-breakpoint')
  .map((statement) => statement.trim())
  .filter((statement) => statement.length > 0)

const GOALS = 'property_rating_goals'
const CHANGES = 'property_rating_goal_changes'
const ORG = 'org-rating-goal-0061'
const OTHER_ORG = 'org-rating-goal-0061-other'
const PROPERTY = '61610000-0000-4000-8000-000000000001'
const OTHER_PROPERTY = '61610000-0000-4000-8000-000000000002'
const goalId = (n: number) => `61610000-0000-4000-8000-${String(n).padStart(12, '0')}`

const SET_AT = '2026-08-03T09:00:00.000Z'
const FIRST_PACE_CHANGE = '2026-08-20T09:00:00.000Z'
const SECOND_PACE_CHANGE = '2026-09-07T09:00:00.000Z'
const TARGET_CHANGE = '2026-09-21T09:00:00.000Z'

let held: HeldTransaction

async function insertGoal(n: number, org: string, property: string, status: string) {
  await held.client.query(
    `INSERT INTO ${GOALS} (
       id, organization_id, property_id, source_epoch, mode, target_tenths,
       pace_per_week, pace_tenths_per_week, quality_tenths, status, ended_reason, ended_at,
       baseline_review_count, baseline_google_average, baseline_exact_average,
       created_by, created_at
     ) VALUES ($1, $2, $3, 2, 'climb', 45, 7, 70, 47, $4, $5, $6, 812, 4.3, 4.31,
       'manager-1', $7)`,
    [
      goalId(n),
      org,
      property,
      status,
      status === 'active' ? null : 'manager',
      status === 'active' ? null : '2026-09-01T06:00:00Z',
      SET_AT,
    ],
  )
}

async function insertLogRow(
  n: number,
  goal: number,
  org: string,
  property: string,
  field: 'pace' | 'target',
  changedAt: string,
) {
  const [oldValue, newValue] = field === 'pace' ? ['70', '140'] : ['45', '46']
  await held.client.query(
    `INSERT INTO ${CHANGES} (id, goal_id, organization_id, property_id, changed_by,
       changed_at, field, old_value, new_value)
     VALUES ($1, $2, $3, $4, 'manager-1', $5, $6, $7, $8)`,
    [goalId(100 + n), goalId(goal), org, property, changedAt, field, oldValue, newValue],
  )
}

beforeEach(async () => {
  held = await holdTransaction()
  for (const [org, property] of [
    [ORG, PROPERTY],
    [OTHER_ORG, OTHER_PROPERTY],
  ] as const) {
    await held.client.query(
      `INSERT INTO organization (id, name, slug, "createdAt") VALUES ($1, $1, $1, now())`,
      [org],
    )
    await held.client.query(
      `INSERT INTO properties (id, organization_id, name, slug, timezone, source_epoch)
       VALUES ($1::uuid, $2, $1::text, $1::text, 'Europe/Sofia', 2)`,
      [property, org],
    )
  }
  await held.client.query(
    `ALTER TABLE ${GOALS} DROP COLUMN pace_since, DROP COLUMN recap_answered_week`,
  )
  // Goal 1: two pace changes and a later target change. Goal 2: none.
  await insertGoal(1, ORG, PROPERTY, 'active')
  await insertGoal(2, ORG, PROPERTY, 'ended')
  await insertGoal(3, OTHER_ORG, OTHER_PROPERTY, 'active')
  await insertLogRow(1, 1, ORG, PROPERTY, 'pace', FIRST_PACE_CHANGE)
  await insertLogRow(2, 1, ORG, PROPERTY, 'pace', SECOND_PACE_CHANGE)
  await insertLogRow(3, 1, ORG, PROPERTY, 'target', TARGET_CHANGE)
  for (const statement of STATEMENTS) await held.client.query(statement)
})

afterEach(async () => {
  await held.rollBack()
})

const paceSinceOf = async (n: number): Promise<string> => {
  const { rows } = await held.client.query<{ pace_since: Date }>(
    `SELECT pace_since FROM ${GOALS} WHERE id = $1`,
    [goalId(n)],
  )
  return rows[0]?.pace_since.toISOString() ?? 'missing'
}

describe('migration 0061 on rating goals stored before it', () => {
  it('starts a goal’s pace at its latest pace change, not a later target change', async () => {
    await expect(paceSinceOf(1)).resolves.toBe(SECOND_PACE_CHANGE)
  })

  it('starts the pace of a goal whose pace never changed at its set', async () => {
    await expect(paceSinceOf(2)).resolves.toBe(SET_AT)
    await expect(paceSinceOf(3)).resolves.toBe(SET_AT)
  })

  it('leaves every check-in unanswered', async () => {
    const { rows } = await held.client.query(
      `SELECT count(*)::int AS answered FROM ${GOALS}
       WHERE id = ANY($1) AND recap_answered_week IS NOT NULL`,
      [[goalId(1), goalId(2), goalId(3)]],
    )

    expect(rows).toEqual([{ answered: 0 }])
  })

  it('gives an old web server’s insert, which names no pace start, the database clock', async () => {
    const { rows } = await held.client.query(
      `SELECT column_default, is_nullable FROM information_schema.columns
       WHERE table_name = $1 AND column_name = 'pace_since'`,
      [GOALS],
    )

    expect(rows).toEqual([{ column_default: 'now()', is_nullable: 'NO' }])
  })
})
