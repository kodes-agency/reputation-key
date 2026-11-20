// Migration 0059 against real PostgreSQL, on rows stored the way 0056-0058
// stored them: no planned quality, and the retired status `cant_reach_at_mix`
// as last seen and as known. Inside one held transaction, always rolled back,
// the table is put back to its 0058 shape (the new column dropped, the 0058
// CHECKs restored from their own migrations), seeded, and 0059 is run on it
// statement by statement. No rating goal exists on the beta, but the migration
// must hold on any data.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  holdTransaction,
  type HeldTransaction,
} from '#/shared/db/testing/held-transaction'

const DRIZZLE = join(import.meta.dirname, '..', '..', '..', '..', 'drizzle')
const migration = (file: string) => readFileSync(join(DRIZZLE, file), 'utf8')

const STATEMENTS = migration('0059_rating_goal_planned_quality.sql')
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
  plan: checkOf(migration('0056_property_rating_goals.sql'), `${GOALS}_plan_check`),
  evaluation: checkOf(
    migration('0056_property_rating_goals.sql'),
    `${GOALS}_evaluation_check`,
  ),
  noticeMark: checkOf(
    migration('0057_rating_goal_notice_marks.sql'),
    `${GOALS}_notice_mark_check`,
  ),
  value: checkOf(migration('0056_property_rating_goals.sql'), `${CHANGES}_value_check`),
}

const ORG = 'org-rating-goal-0059'
const PROPERTY = '59590000-0000-4000-8000-000000000001'
const goalId = (n: number) => `59590000-0000-4000-8000-${String(n).padStart(12, '0')}`
const TOLD = '2026-10-01T06:00:00Z'

let held: HeldTransaction

/** The table as 0058 left it. */
async function backTo0058(): Promise<void> {
  const sql = [
    `ALTER TABLE ${GOALS} DROP CONSTRAINT ${GOALS}_plan_check`,
    `ALTER TABLE ${GOALS} DROP CONSTRAINT ${GOALS}_evaluation_check`,
    `ALTER TABLE ${GOALS} DROP CONSTRAINT ${GOALS}_notice_mark_check`,
    `ALTER TABLE ${CHANGES} DROP CONSTRAINT ${CHANGES}_value_check`,
    `ALTER TABLE ${GOALS} DROP COLUMN quality_tenths`,
    // Added by 0060, after this migration: gone again in the 0058 shape.
    `ALTER TABLE ${GOALS} DROP COLUMN pace_tenths_per_week`,
    `ALTER TABLE ${GOALS} ADD CONSTRAINT ${GOALS}_plan_check ${BEFORE.plan}`,
    `ALTER TABLE ${GOALS} ADD CONSTRAINT ${GOALS}_evaluation_check ${BEFORE.evaluation}`,
    `ALTER TABLE ${GOALS} ADD CONSTRAINT ${GOALS}_notice_mark_check ${BEFORE.noticeMark}`,
    `ALTER TABLE ${CHANGES} ADD CONSTRAINT ${CHANGES}_value_check ${BEFORE.value}`,
  ]
  for (const statement of sql) await held.client.query(statement)
}

type OldGoal = Readonly<{
  n: number
  mode: 'climb' | 'keep'
  target: number
  pace: number | null
  status?: 'active' | 'reached' | 'ended'
  lastStatus: string | null
  knownStatus: string | null
  toldTooLow?: boolean
}>

async function insertOldGoal(goal: OldGoal): Promise<void> {
  const status = goal.status ?? 'active'
  await held.client.query(
    `INSERT INTO ${GOALS} (
       id, organization_id, property_id, source_epoch, mode, target_tenths,
       pace_per_week, status, ended_reason, reached_at, ended_at,
       baseline_review_count, baseline_google_average, baseline_exact_average,
       last_evaluated_status, last_known_status, cant_reach_noticed_at, created_by
     ) VALUES ($1, $2, $3, 2, $4, $5, $6, $7, $8, $9, $10, 812, 4.3, 4.31, $11, $12, $13,
               'manager-1')`,
    [
      goalId(goal.n),
      ORG,
      PROPERTY,
      goal.mode,
      goal.target,
      goal.pace,
      status,
      status === 'ended' ? 'manager' : null,
      status === 'reached' ? TOLD : null,
      status === 'ended' ? TOLD : null,
      goal.lastStatus,
      goal.knownStatus,
      goal.toldTooLow ? TOLD : null,
    ],
  )
}

async function stored(n: number) {
  const { rows } = await held.client.query(
    `SELECT quality_tenths, last_evaluated_status, last_known_status, cant_reach_noticed_at
     FROM ${GOALS} WHERE id = $1`,
    [goalId(n)],
  )
  return rows[0]
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
  await backTo0058()
  await insertOldGoal({
    n: 1,
    mode: 'climb',
    target: 45,
    pace: 11,
    lastStatus: 'cant_reach_at_mix',
    knownStatus: 'cant_reach_at_mix',
    toldTooLow: true,
  })
  await insertOldGoal({
    n: 2,
    mode: 'climb',
    target: 49,
    pace: 3,
    status: 'reached',
    lastStatus: 'reached',
    knownStatus: 'reached',
  })
  await insertOldGoal({
    n: 3,
    mode: 'keep',
    target: 50,
    pace: null,
    status: 'ended',
    lastStatus: 'holding',
    knownStatus: 'holding',
  })
  await insertOldGoal({
    n: 4,
    mode: 'climb',
    target: 40,
    pace: 2,
    status: 'ended',
    lastStatus: 'below_pace',
    knownStatus: 'below_pace',
  })
  for (const statement of STATEMENTS) await held.client.query(statement)
})

afterEach(async () => {
  await held.rollBack()
})

describe('migration 0059 on rating goals stored before it', () => {
  it('gives every climb goal a step above what its target needs, at most 5.0, and a keep goal none', async () => {
    await expect(stored(1)).resolves.toMatchObject({ quality_tenths: 48 })
    await expect(stored(2)).resolves.toMatchObject({ quality_tenths: 50 })
    await expect(stored(3)).resolves.toMatchObject({ quality_tenths: null })
    await expect(stored(4)).resolves.toMatchObject({ quality_tenths: 43 })
  })

  it('clears the retired status and the notice time it used, and keeps every other status', async () => {
    await expect(stored(1)).resolves.toEqual({
      quality_tenths: 48,
      last_evaluated_status: null,
      last_known_status: null,
      cant_reach_noticed_at: null,
    })
    await expect(stored(4)).resolves.toMatchObject({
      last_evaluated_status: 'below_pace',
      last_known_status: 'below_pace',
    })
  })

  it('refuses the retired status and a climb without a quality from then on', async () => {
    await expect(
      refusedCode(
        `UPDATE ${GOALS} SET last_known_status = 'cant_reach_at_mix' WHERE id = $1`,
        [goalId(4)],
      ),
    ).resolves.toBe('23514')
    await expect(
      refusedCode(`UPDATE ${GOALS} SET quality_tenths = NULL WHERE id = $1`, [goalId(1)]),
    ).resolves.toBe('23514')
    await expect(
      refusedCode(
        `UPDATE ${GOALS} SET last_evaluated_status = 'reviews_too_low',
           last_known_status = 'reviews_too_low' WHERE id = $1`,
        [goalId(1)],
      ),
    ).resolves.toBe('accepted')
  })

  it('takes a change of planned quality into the change log', async () => {
    await expect(
      refusedCode(
        `INSERT INTO ${CHANGES} (id, goal_id, organization_id, property_id, changed_by,
           changed_at, field, old_value, new_value)
         VALUES ($1, $2, $3, $4, 'manager-1', now(), 'quality', '48', '47')`,
        [goalId(101), goalId(1), ORG, PROPERTY],
      ),
    ).resolves.toBe('accepted')
  })
})
