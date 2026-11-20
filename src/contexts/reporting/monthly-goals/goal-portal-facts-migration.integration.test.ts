// Migration 0062 against real PostgreSQL, on goals stored the way 0061 stored
// them: no number source, no answered check-in, no stop record and no "Not
// now" table. Inside one held transaction, always rolled back, the new columns
// and the table are dropped (0062's down step), a goal with a month and a
// month target change is seeded, and 0062 is run on them statement by
// statement.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  holdTransaction,
  type HeldTransaction,
} from '#/shared/db/testing/held-transaction'

const DRIZZLE = join(import.meta.dirname, '..', '..', '..', '..', 'drizzle')

const STATEMENTS = readFileSync(join(DRIZZLE, '0062_portal_goal_facts.sql'), 'utf8')
  .split('--> statement-breakpoint')
  .map((statement) => statement.trim())
  .filter((statement) => statement.length > 0)

const ORG = 'org-portal-goal-0062'
const OTHER_ORG = 'org-portal-goal-0062-other'
const id = (n: number) => `62620000-0000-4000-8000-${String(n).padStart(12, '0')}`
const PROPERTY = id(1)
/** A Property with no goal, so it can be deleted inside the test. */
const SPARE_PROPERTY = id(2)
const OTHER_PROPERTY = id(3)
const PROGRAM = id(10)
const VERSION = id(11)
const ASSIGNMENT = id(12)
const MONTH = id(13)
const CHANGE = id(14)
const LATER_PROGRAM = id(20)
const LATER_VERSION = id(21)
const LATER_CHANGE = id(24)
const RATING_COUNT_DEFINITION = '11111111-1111-4111-8111-111111110302'
const RATING_COUNT_VERSION = '11111111-1111-4111-8111-111111111302'

let held: HeldTransaction

/** 0062's down step: the tables as 0061 left them. */
async function backTo0061(): Promise<void> {
  for (const statement of [
    'DROP TABLE portal_goal_prompt_deferrals',
    'ALTER TABLE goal_programs DROP CONSTRAINT goal_programs_ended_record_check',
    'ALTER TABLE goal_programs DROP CONSTRAINT goal_programs_check_in_answered_month_check',
    'ALTER TABLE goal_programs DROP COLUMN ended_by, DROP COLUMN ended_at, DROP COLUMN check_in_answered_month',
    'ALTER TABLE goal_month_target_changes DROP CONSTRAINT goal_month_target_changes_target_source_check',
    'ALTER TABLE goal_month_target_changes DROP COLUMN target_source',
    'ALTER TABLE goal_program_versions DROP CONSTRAINT goal_program_versions_target_source_check',
    'ALTER TABLE goal_program_versions DROP COLUMN target_source',
  ]) {
    await held.client.query(statement)
  }
}

/** A goal as an old web server writes it: its columns named, no others. */
async function insertOldGoal(program: string, version: string, status: string) {
  await held.client.query(
    `INSERT INTO goal_programs (id, organization_id, property_id, name, status,
       current_version, created_by)
     VALUES ($1, $2, $3, 'Monthly portal goal', $4, 1, 'manager-1')`,
    [program, ORG, PROPERTY, status],
  )
  await held.client.query(
    `INSERT INTO goal_program_versions (id, program_id, organization_id, property_id,
       version, metric_definition_id, metric_definition_version_id, metric_key,
       metric_minimum_sample, target_value, property_timezone, effective_from,
       change_reason, created_by)
     VALUES ($1, $2, $3, $4, 1, $5, $6, 'portal_rating_count', 0, 40, 'UTC',
       TIMESTAMPTZ '2026-10-01T00:00:00Z', 'created', 'manager-1')`,
    [version, program, ORG, PROPERTY, RATING_COUNT_DEFINITION, RATING_COUNT_VERSION],
  )
}

async function insertOldMonthWithChange(): Promise<void> {
  await held.client.query(
    `INSERT INTO goal_subject_assignments (id, program_id, program_version_id,
       organization_id, property_id, metric_key, subject_kind, property_subject_id,
       effective_from, created_by)
     VALUES ($1, $2, $3, $4, $5, 'portal_rating_count', 'property', $5,
       TIMESTAMPTZ '2026-10-01T00:00:00Z', 'manager-1')`,
    [ASSIGNMENT, PROGRAM, VERSION, ORG, PROPERTY],
  )
  await held.client.query(
    `INSERT INTO goal_monthly_results (id, assignment_id, program_id,
       program_version_id, organization_id, property_id, period_start, period_end,
       property_timezone, status, evaluation_state, sample_count, reason)
     VALUES ($1, $2, $3, $4, $5, $6, TIMESTAMPTZ '2026-10-01T00:00:00Z',
       TIMESTAMPTZ '2026-11-01T00:00:00Z', 'UTC', 'open', 'updating', 0, 'period_open')`,
    [MONTH, ASSIGNMENT, PROGRAM, VERSION, ORG, PROPERTY],
  )
  await insertOldChange(CHANGE)
}

async function insertOldChange(change: string): Promise<void> {
  await held.client.query(
    `INSERT INTO goal_month_target_changes (id, organization_id, property_id,
       program_id, monthly_result_id, change_id, previous_target_value,
       new_target_value, following_outcome, created_by)
     VALUES ($1, $2, $3, $4, $5, $1, 40, 45, 'not_requested', 'manager-1')`,
    [change, ORG, PROPERTY, PROGRAM, MONTH],
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

const defer = (property: string, month: string, org = ORG) =>
  refusedCode(
    `INSERT INTO portal_goal_prompt_deferrals (organization_id, property_id, month,
       deferred_by, deferred_at)
     VALUES ($1, $2, $3, 'manager-1', TIMESTAMPTZ '2026-10-17T09:00:00Z')`,
    [org, property, month],
  )

beforeEach(async () => {
  held = await holdTransaction()
  for (const [org, property] of [
    [ORG, PROPERTY],
    [ORG, SPARE_PROPERTY],
    [OTHER_ORG, OTHER_PROPERTY],
  ] as const) {
    await held.client.query(
      `INSERT INTO organization (id, name, slug, "createdAt") VALUES ($1, $1, $1, now())
       ON CONFLICT (id) DO NOTHING`,
      [org],
    )
    await held.client.query(
      `INSERT INTO properties (id, organization_id, name, slug, timezone)
       VALUES ($1::uuid, $2, $1::text, $1::text, 'Europe/Sofia')`,
      [property, org],
    )
  }
  await backTo0061()
  await insertOldGoal(PROGRAM, VERSION, 'active')
  await insertOldMonthWithChange()
  for (const statement of STATEMENTS) await held.client.query(statement)
})

afterEach(async () => {
  await held.rollBack()
})

describe('migration 0062 on goals stored before it', () => {
  it('an old-shaped insert still works and stores NULL', async () => {
    // What an old web server writes while the new one starts.
    await insertOldGoal(LATER_PROGRAM, LATER_VERSION, 'scheduled')
    await insertOldChange(LATER_CHANGE)

    const programs = await held.client.query(
      `SELECT id, check_in_answered_month, ended_at, ended_by FROM goal_programs
       WHERE id = ANY($1) ORDER BY id`,
      [[PROGRAM, LATER_PROGRAM]],
    )
    const versions = await held.client.query(
      `SELECT id, target_source FROM goal_program_versions WHERE id = ANY($1) ORDER BY id`,
      [[VERSION, LATER_VERSION]],
    )
    const changes = await held.client.query(
      `SELECT id, target_source FROM goal_month_target_changes
       WHERE id = ANY($1) ORDER BY id`,
      [[CHANGE, LATER_CHANGE]],
    )

    expect(programs.rows).toEqual([
      { id: PROGRAM, check_in_answered_month: null, ended_at: null, ended_by: null },
      {
        id: LATER_PROGRAM,
        check_in_answered_month: null,
        ended_at: null,
        ended_by: null,
      },
    ])
    expect(versions.rows).toEqual([
      { id: VERSION, target_source: null },
      { id: LATER_VERSION, target_source: null },
    ])
    expect(changes.rows).toEqual([
      { id: CHANGE, target_source: null },
      { id: LATER_CHANGE, target_source: null },
    ])
  })

  it('refuses another target source', async () => {
    const setVersion = (source: string) =>
      refusedCode(`UPDATE goal_program_versions SET target_source = $1 WHERE id = $2`, [
        source,
        VERSION,
      ])
    const setChange = (source: string) =>
      refusedCode(
        `UPDATE goal_month_target_changes SET target_source = $1 WHERE id = $2`,
        [source, CHANGE],
      )

    await expect(setVersion('recommended')).resolves.toBe('accepted')
    await expect(setVersion('own')).resolves.toBe('accepted')
    await expect(setVersion('suggested')).resolves.toBe('23514')
    await expect(setChange('own')).resolves.toBe('accepted')
    await expect(setChange('recommended')).resolves.toBe('accepted')
    await expect(setChange('Recommended')).resolves.toBe('23514')
  })

  it('refuses month 2026-13', async () => {
    const answer = (month: string) =>
      refusedCode(`UPDATE goal_programs SET check_in_answered_month = $1 WHERE id = $2`, [
        month,
        PROGRAM,
      ])

    await expect(answer('2026-12')).resolves.toBe('accepted')
    await expect(answer('2026-13')).resolves.toBe('23514')
    await expect(answer('2026-1')).resolves.toBe('23514')
    await expect(defer(PROPERTY, '2026-11')).resolves.toBe('accepted')
    await expect(defer(PROPERTY, '2026-13')).resolves.toBe('23514')
    await expect(defer(PROPERTY, '2026-00')).resolves.toBe('23514')
  })

  it('refuses an end record on an active goal', async () => {
    const end = (status: string, at: string | null, by: string | null) =>
      refusedCode(
        `UPDATE goal_programs SET status = $1, ended_at = $2, ended_by = $3 WHERE id = $4`,
        [status, at, by, PROGRAM],
      )

    await expect(end('active', '2026-10-17T09:00:00Z', 'manager-1')).resolves.toBe(
      '23514',
    )
    await expect(end('ended', '2026-10-17T09:00:00Z', null)).resolves.toBe('23514')
    await expect(end('ended', null, 'manager-1')).resolves.toBe('23514')
    // An old web server ends a goal and names neither.
    await expect(end('ended', null, null)).resolves.toBe('accepted')
    await expect(end('ended', '2026-10-17T09:00:00Z', 'manager-1')).resolves.toBe(
      'accepted',
    )
  })

  it('deferrals go with their Property', async () => {
    await expect(defer(SPARE_PROPERTY, '2026-11')).resolves.toBe('accepted')
    await held.client.query(
      `INSERT INTO portal_goal_prompt_deferrals (organization_id, property_id, month,
         deferred_by, deferred_at)
       VALUES ($1, $2, '2026-11', 'manager-1', now())`,
      [ORG, SPARE_PROPERTY],
    )
    // A Property is named within its own Organization only.
    await expect(defer(OTHER_PROPERTY, '2026-11')).resolves.toBe('23503')
    // One row per Property.
    await expect(defer(SPARE_PROPERTY, '2026-12')).resolves.toBe('23505')

    await held.client.query(`DELETE FROM properties WHERE id = $1`, [SPARE_PROPERTY])

    const { rows } = await held.client.query(
      `SELECT count(*)::int AS left FROM portal_goal_prompt_deferrals
       WHERE property_id = $1`,
      [SPARE_PROPERTY],
    )
    expect(rows).toEqual([{ left: 0 }])
  })
})
