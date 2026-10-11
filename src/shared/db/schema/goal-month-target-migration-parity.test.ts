// Migration 0054 is hand-written SQL (drizzle/meta stops at 0013), so what it
// wrote is pinned here as literals. It also restates one function,
// guard_goal_monthly_result_v1, which a fresh database gets from the constructs
// file instead: the three copies are compared so an upgraded database and a
// fresh one enforce the same lock.
// `pnpm check:schema-drift` proves the model matches a migrated database.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(import.meta.dirname, '..', '..', '..', '..')
const read = (...path: readonly string[]): string =>
  readFileSync(join(ROOT, ...path), 'utf8')

const MIGRATION = read('drizzle', '0054_goal_month_target.sql')
const CONSTRUCTS = read('src', 'shared', 'db', 'db-constructs.sql')
const CONSTRUCTS_MIGRATION = read('drizzle', '0001_db_constructs.sql')
const JOURNAL = JSON.parse(read('drizzle', 'meta', '_journal.json')) as {
  entries: ReadonlyArray<{ idx: number; tag: string; when: number }>
}

const GUARD_HEADER = 'CREATE OR REPLACE FUNCTION public.guard_goal_monthly_result_v1()'
const FUNCTION_END = '$function$\n;'

/** The whole CREATE OR REPLACE statement of the guard, as one file wrote it. */
function guardFunction(sql: string): string {
  const start = sql.indexOf(GUARD_HEADER)
  expect(start, 'the guard function is defined').toBeGreaterThanOrEqual(0)
  expect(sql.indexOf(GUARD_HEADER, start + 1), 'the guard is defined once').toBe(-1)
  const end = sql.indexOf(FUNCTION_END, start)
  expect(end, 'the guard function is terminated').toBeGreaterThan(start)
  return sql.slice(start, end + FUNCTION_END.length)
}

/** The migration without its comments, which may name a type in prose. */
const MIGRATION_SQL = MIGRATION.split('\n')
  .filter((line) => !line.trimStart().startsWith('-- '))
  .map((line) => line.replace(/\s+-- .*$/u, ''))
  .join('\n')

const statements = MIGRATION.split('--> statement-breakpoint')
  .map((statement) => statement.trim())
  .filter((statement) => statement.length > 0)

const statementContaining = (fragment: string): string => {
  const found = statements.filter((statement) => statement.includes(fragment))
  expect(found, fragment).toHaveLength(1)
  return found[0] as string
}

describe('migration 0054 goal month target', () => {
  it('is journalled above every earlier migration', () => {
    const position = JOURNAL.entries.findIndex(
      (candidate) => candidate.tag === '0054_goal_month_target',
    )
    const entry = JOURNAL.entries[position]
    expect(entry?.idx).toBe(54)
    const previous = JOURNAL.entries.find((candidate) => candidate.idx === 53)
    expect(entry && previous && entry.when > previous.when).toBe(true)
    // drizzle skips an entry whose `when` is not above the last applied one.
    for (const earlier of JOURNAL.entries.slice(0, position)) {
      expect(earlier.idx, earlier.tag).toBeLessThan(54)
      expect(earlier.when, earlier.tag).toBeLessThan(entry?.when ?? 0)
    }
  })

  it('adds a nullable month target that is positive when set', () => {
    expect(MIGRATION).toContain(
      'ALTER TABLE "goal_monthly_results" ADD COLUMN "target_value" numeric(30, 10);',
    )
    expect(statementContaining('"goal_monthly_results_target_value_check"')).toContain(
      'CHECK ("goal_monthly_results"."target_value" IS NULL OR "goal_monthly_results"."target_value" > 0)',
    )
  })

  it('stores every log number with the precision the model reads back', () => {
    const table = statementContaining('CREATE TABLE "goal_month_target_changes"')
    expect(table).toContain('"previous_target_value" numeric(30, 10) NOT NULL')
    expect(table).toContain('"new_target_value" numeric(30, 10) NOT NULL')
    // A bare `numeric` reads back with another scale and fails schema drift.
    expect(MIGRATION_SQL).not.toMatch(/numeric(?!\(30, 10\))/u)
  })

  it('closes the outcome list, bounds the note and refuses a change to the same value', () => {
    const table = statementContaining('CREATE TABLE "goal_month_target_changes"')
    expect(table).toContain(
      `"following_outcome" IN ('applied', 'replaced_scheduled_change', 'kept_scheduled_change', 'not_applied', 'not_requested')`,
    )
    expect(table).toContain(
      'char_length(btrim("goal_month_target_changes"."note")) BETWEEN 1 AND 500',
    )
    expect(table).toContain(
      '"goal_month_target_changes"."new_target_value" <> "goal_month_target_changes"."previous_target_value"',
    )
  })

  it('ties every log reference to a row of the same Organization and Property', () => {
    for (const [constraint, target, columns, referenced] of [
      [
        'goal_month_target_changes_result_fk',
        'goal_monthly_results',
        '"organization_id","property_id","program_id","monthly_result_id"',
        '"organization_id","property_id","program_id","id"',
      ],
      [
        'goal_month_target_changes_program_fk',
        'goal_programs',
        '"organization_id","property_id","program_id"',
        '"organization_id","property_id","id"',
      ],
      [
        'goal_month_target_changes_following_version_fk',
        'goal_program_versions',
        '"organization_id","property_id","program_id","following_version_id"',
        '"organization_id","property_id","program_id","id"',
      ],
    ] as const) {
      const statement = statementContaining(`ADD CONSTRAINT "${constraint}"`)
      expect(statement).toContain(`FOREIGN KEY (${columns})`)
      expect(statement).toContain(`REFERENCES "public"."${target}"(${referenced})`)
      expect(statement).toContain('ON DELETE restrict')
    }
  })

  it('gives the month and the version the key that ties a change to its own Program', () => {
    // The month and the following version a change names must belong to the
    // Program it names. A foreign key needs a unique key over the columns it
    // references; a unique index is enough and does not block readers.
    for (const table of ['goal_monthly_results', 'goal_program_versions']) {
      expect(
        statementContaining(`CREATE UNIQUE INDEX "${table}_target_change_fk_key"`),
      ).toContain(
        `ON "${table}" USING btree ("organization_id","property_id","program_id","id")`,
      )
    }
  })

  it('logs a month once for each command', () => {
    expect(statementContaining('CREATE TABLE "goal_month_target_changes"')).toContain(
      'CONSTRAINT "goal_month_target_changes_change_result_key" UNIQUE("change_id","monthly_result_id")',
    )
  })

  it('locks Programs, then versions, then months, as every goal write does', () => {
    // The whole migration is one transaction. A goal command writes its
    // Program first and its months last; taking the tables in another order
    // could deadlock with a command or the maintenance job mid-deploy.
    const order = [
      'ADD CONSTRAINT "goal_month_target_changes_program_fk"',
      'CREATE UNIQUE INDEX "goal_program_versions_target_change_fk_key"',
      'ADD CONSTRAINT "goal_month_target_changes_following_version_fk"',
      'ALTER TABLE "goal_monthly_results" ADD COLUMN "target_value"',
      'ADD CONSTRAINT "goal_monthly_results_target_value_check"',
      'CREATE UNIQUE INDEX "goal_monthly_results_target_change_fk_key"',
      'ADD CONSTRAINT "goal_month_target_changes_result_fk"',
    ].map((fragment) => statements.indexOf(statementContaining(fragment)))
    expect(order).toEqual([...order].sort((left, right) => left - right))
    expect(new Set(order).size).toBe(order.length)
    // Nothing before the Program reference touches a table goal writes use.
    expect(statements.slice(0, order[0])).toEqual([
      statementContaining('CREATE TABLE "goal_month_target_changes"'),
    ])
  })

  it('puts no guard trigger on the log', () => {
    // A trigger there would need a bypass in the Organization purge, and the
    // log records a value from before the month closed, not closed evidence.
    expect(MIGRATION).not.toContain('CREATE TRIGGER')
    expect(CONSTRUCTS).not.toContain('goal_month_target_changes')
  })
})

describe('guard_goal_monthly_result_v1 after migration 0054', () => {
  const restated = guardFunction(MIGRATION)

  it('locks the month target once the row is not open or its period has ended', () => {
    for (const sql of [restated, CONSTRUCTS]) {
      expect(sql).toContain('NEW."target_value" IS DISTINCT FROM OLD."target_value"')
      expect(sql).toContain(
        `AND (OLD."status" <> 'open' OR clock_timestamp() >= OLD."period_end")`,
      )
      expect(sql).toContain('goal monthly result target is locked once its period ends')
    }
  })

  it('refuses a new month that brings a target unless it is open and still running', () => {
    for (const sql of [restated, CONSTRUCTS]) {
      expect(sql).toContain(`IF TG_OP = 'INSERT'\n    AND NEW."target_value" IS NOT NULL`)
      expect(sql).toContain(
        `AND (NEW."status" <> 'open' OR clock_timestamp() >= NEW."period_end")`,
      )
    }
  })

  it('holds a month target to the rule of its version’s measure', () => {
    for (const sql of [restated, CONSTRUCTS]) {
      expect(sql).toContain('version_metric varchar(40);')
      expect(sql).toContain('version."metric_key"')
      expect(sql).toContain(
        `version_metric IN ('qualified_scans', 'portal_rating_count')`,
      )
      expect(sql).toContain(`version_metric = 'portal_rating_average'`)
      expect(sql).toContain('goal monthly result target breaks its measure rule')
    }
  })

  it('is the same function in the migration, the constructs file and its journal copy', () => {
    expect(restated).toBe(guardFunction(CONSTRUCTS))
    expect(guardFunction(CONSTRUCTS_MIGRATION)).toBe(guardFunction(CONSTRUCTS))
    // Compared as a boolean: a mismatch would print both 3,500-line files.
    expect(
      CONSTRUCTS_MIGRATION === CONSTRUCTS,
      'drizzle/0001_db_constructs.sql is a file copy of db-constructs.sql',
    ).toBe(true)
  })

  it('keeps every refusal the guard made before', () => {
    for (const message of [
      'goal monthly results cannot be deleted',
      'closed goal monthly results are immutable; append a revision',
      'invalid goal monthly result transition: % -> %',
      'goal monthly result assignment is unavailable',
      'goal monthly result timezone does not match its immutable program version',
      'goal monthly result must cover one complete property-local calendar month',
      'goal monthly result falls outside its assignment or version window',
      'goal monthly result cannot reconcile before its period ends',
      'goal monthly result cannot close before the reconciliation window ends',
    ]) {
      expect(restated, message).toContain(message)
    }
  })
})
