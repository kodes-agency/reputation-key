// Migration 0060 against real PostgreSQL, on rows stored the way 0059 stored
// them: a climb goal's pace in whole reviews a week only, and the change log's
// pace rows in the same unit. Inside one held transaction, always rolled back,
// the tables are put back to their 0059 shape (the new column dropped, the
// 0059 CHECKs restored from their own migration), seeded, and 0060 is run on
// them statement by statement.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  holdTransaction,
  type HeldTransaction,
} from '#/shared/db/testing/held-transaction'

const DRIZZLE = join(import.meta.dirname, '..', '..', '..', '..', 'drizzle')
const migration = (file: string) => readFileSync(join(DRIZZLE, file), 'utf8')

const STATEMENTS = migration('0060_rating_goal_pace_tenths.sql')
  .split('--> statement-breakpoint')
  .map((statement) => statement.trim())
  .filter((statement) => statement.length > 0)

/** `CHECK (...)` of a named constraint as an earlier migration wrote it. */
function checkOf(sql: string, name: string): string {
  const at = sql.indexOf(`"${name}" CHECK `)
  if (at < 0) throw new Error(`No CHECK named ${name}`)
  const open = sql.indexOf('(', at)
  let depth = 0
  for (let index = open; index < sql.length; index++) {
    if (sql[index] === '(') depth++
    if (sql[index] === ')') depth--
    if (depth === 0) return `CHECK ${sql.slice(open, index + 1)}`
  }
  throw new Error(`Unbalanced CHECK ${name}`)
}

const GOALS = 'property_rating_goals'
const CHANGES = 'property_rating_goal_changes'
const BEFORE = {
  plan: checkOf(migration('0059_rating_goal_planned_quality.sql'), `${GOALS}_plan_check`),
  value: checkOf(
    migration('0059_rating_goal_planned_quality.sql'),
    `${CHANGES}_value_check`,
  ),
}

const ORG = 'org-rating-goal-0060'
const PROPERTY = '60600000-0000-4000-8000-000000000001'
const goalId = (n: number) => `60600000-0000-4000-8000-${String(n).padStart(12, '0')}`

let held: HeldTransaction

/** The tables as 0059 left them. */
async function backTo0059(): Promise<void> {
  const sql = [
    `ALTER TABLE ${GOALS} DROP CONSTRAINT ${GOALS}_plan_check`,
    `ALTER TABLE ${CHANGES} DROP CONSTRAINT ${CHANGES}_value_check`,
    `ALTER TABLE ${GOALS} DROP COLUMN pace_tenths_per_week`,
    `ALTER TABLE ${GOALS} ADD CONSTRAINT ${GOALS}_plan_check ${BEFORE.plan}`,
    `ALTER TABLE ${CHANGES} ADD CONSTRAINT ${CHANGES}_value_check ${BEFORE.value}`,
  ]
  for (const statement of sql) await held.client.query(statement)
}

async function insertOldGoal(
  n: number,
  mode: 'climb' | 'keep',
  pace: number | null,
): Promise<void> {
  await held.client.query(
    `INSERT INTO ${GOALS} (
       id, organization_id, property_id, source_epoch, mode, target_tenths,
       pace_per_week, quality_tenths, status, ended_reason, ended_at,
       baseline_review_count, baseline_google_average, baseline_exact_average,
       created_by
     ) VALUES ($1, $2, $3, 2, $4, $5, $6, $7, $8, $9, $10, 812, 4.3, 4.31, 'manager-1')`,
    [
      goalId(n),
      ORG,
      PROPERTY,
      mode,
      mode === 'climb' ? 45 : 49,
      pace,
      mode === 'climb' ? 47 : null,
      // One active goal per Property: the keep goal ended before this one.
      n === 1 ? 'active' : 'ended',
      n === 1 ? null : 'manager',
      n === 1 ? null : '2026-09-01T06:00:00Z',
    ],
  )
}

async function insertLogRow(
  n: number,
  field: string,
  oldValue: string | null,
  newValue: string | null,
  goal = 1,
): Promise<void> {
  await held.client.query(
    `INSERT INTO ${CHANGES} (id, goal_id, organization_id, property_id, changed_by,
       changed_at, field, old_value, new_value)
     VALUES ($1, $2, $3, $4, 'manager-1', now(), $5, $6, $7)`,
    [goalId(100 + n), goalId(goal), ORG, PROPERTY, field, oldValue, newValue],
  )
}

/** A statement that must fail, in a savepoint so the held transaction survives. */
async function refusedCode(sql: string, values: readonly unknown[]): Promise<string> {
  await held.client.query('SAVEPOINT refused')
  try {
    await held.client.query(sql, [...values])
    return 'accepted'
  } catch (error) {
    return (error as { code?: string }).code ?? 'unknown'
  } finally {
    await held.client.query('ROLLBACK TO SAVEPOINT refused')
  }
}

const setPace = (tenths: number | null, perWeek: number | null, n = 1) =>
  refusedCode(
    `UPDATE ${GOALS} SET pace_tenths_per_week = $1, pace_per_week = $2 WHERE id = $3`,
    [tenths, perWeek, goalId(n)],
  )

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
  await backTo0059()
  await insertOldGoal(1, 'climb', 11)
  await insertOldGoal(2, 'keep', null)
  await insertLogRow(1, 'pace', '14', '11')
  await insertLogRow(2, 'pace', '11', null)
  await insertLogRow(3, 'target', '44', '45')
  // The old range's edges, 1 and 200 a week, on ended climb goals.
  await insertOldGoal(3, 'climb', 1)
  await insertOldGoal(4, 'climb', 200)
  await insertLogRow(4, 'pace', '1', '200', 3)
  await insertLogRow(5, 'pace', '200', '1', 3)
  for (const statement of STATEMENTS) await held.client.query(statement)
})

afterEach(async () => {
  await held.rollBack()
})

describe('migration 0060 on rating goals stored before it', () => {
  it('gives a climb goal its pace in tenths and leaves a keep goal without one', async () => {
    const { rows } = await held.client.query(
      `SELECT id, pace_per_week, pace_tenths_per_week FROM ${GOALS}
       WHERE id IN ($1, $2) ORDER BY id`,
      [goalId(1), goalId(2)],
    )

    expect(rows).toEqual([
      { id: goalId(1), pace_per_week: 11, pace_tenths_per_week: 110 },
      { id: goalId(2), pace_per_week: null, pace_tenths_per_week: null },
    ])
  })

  it('moves the old range edges, 1 and 200 a week, to 10 and 2000 tenths with whole mirrors', async () => {
    const goals = await held.client.query(
      `SELECT id, pace_per_week, pace_tenths_per_week FROM ${GOALS}
       WHERE id IN ($1, $2) ORDER BY id`,
      [goalId(3), goalId(4)],
    )
    const log = await held.client.query(
      `SELECT old_value, new_value FROM ${CHANGES} WHERE goal_id = $1 ORDER BY id`,
      [goalId(3)],
    )

    expect(goals.rows).toEqual([
      { id: goalId(3), pace_per_week: 1, pace_tenths_per_week: 10 },
      { id: goalId(4), pace_per_week: 200, pace_tenths_per_week: 2000 },
    ])
    expect(log.rows).toEqual([
      { old_value: '10', new_value: '2000' },
      { old_value: '2000', new_value: '10' },
    ])
  })

  it('rewrites the logged paces in tenths and leaves every other field', async () => {
    const { rows } = await held.client.query(
      `SELECT field, old_value, new_value FROM ${CHANGES} WHERE goal_id = $1 ORDER BY id`,
      [goalId(1)],
    )

    expect(rows).toEqual([
      { field: 'pace', old_value: '140', new_value: '110' },
      { field: 'pace', old_value: '110', new_value: null },
      { field: 'target', old_value: '44', new_value: '45' },
    ])
  })

  it('takes a pace up to 50 a day with its whole weekly mirror, and refuses more', async () => {
    await expect(setPace(3500, 350)).resolves.toBe('accepted')
    await expect(setPace(105, 11)).resolves.toBe('accepted')
    await expect(setPace(3501, 350)).resolves.toBe('23514')
    await expect(setPace(9, 1)).resolves.toBe('23514')
  })

  it('refuses a pace whose whole weekly mirror differs, or is missing', async () => {
    await expect(setPace(105, 10)).resolves.toBe('23514')
    await expect(setPace(110, null)).resolves.toBe('23514')
    await expect(setPace(null, 11)).resolves.toBe('23514')
  })

  it('keeps a keep goal without a pace', async () => {
    await expect(setPace(null, null, 2)).resolves.toBe('accepted')
    await expect(setPace(110, 11, 2)).resolves.toBe('23514')
  })

  it('takes a logged pace in tenths from 10 to 3500 from then on', async () => {
    const logRow = (n: number, oldValue: string, newValue: string) =>
      refusedCode(
        `INSERT INTO ${CHANGES} (id, goal_id, organization_id, property_id, changed_by,
           changed_at, field, old_value, new_value)
         VALUES ($1, $2, $3, $4, 'manager-1', now(), 'pace', $5, $6)`,
        [goalId(200 + n), goalId(1), ORG, PROPERTY, oldValue, newValue],
      )

    await expect(logRow(1, '110', '3500')).resolves.toBe('accepted')
    await expect(logRow(2, '110', '3501')).resolves.toBe('23514')
    // One a week was the old floor; in tenths it is 10.
    await expect(logRow(3, '9', '110')).resolves.toBe('23514')
  })
})
