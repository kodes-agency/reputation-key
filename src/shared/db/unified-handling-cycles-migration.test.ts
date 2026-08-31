import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import {
  inboxHandlingCycleHeads,
  inboxHandlingCycleTransitions,
  inboxHandlingCycles,
} from './schema/inbox.schema'
import { guestResponses } from './schema/guest.schema'

const ROOT = process.cwd()
const migration = readFileSync(
  resolve(ROOT, 'drizzle/0132_unified_source_handling_cycles.sql'),
  'utf8',
)
const journal = JSON.parse(
  readFileSync(resolve(ROOT, 'drizzle/meta/_journal.json'), 'utf8'),
) as { entries: Array<Record<string, unknown>> }

describe('0132 unified source Handling Cycles', () => {
  it('expands, backfills, and only then contracts canonical source columns', () => {
    const addSource = migration.indexOf('ADD COLUMN "source_type" "inbox_source_type";')
    const backfillReview = migration.indexOf(
      'UPDATE "inbox_handling_cycles"\nSET "source_type" = \'review\'',
    )
    const backfillFeedback = migration.indexOf(
      'INSERT INTO "inbox_handling_cycles"',
      backfillReview,
    )
    const contract = migration.indexOf('ALTER COLUMN "source_type" SET NOT NULL')
    expect(addSource).toBeGreaterThanOrEqual(0)
    expect(backfillReview).toBeGreaterThan(addSource)
    expect(backfillFeedback).toBeGreaterThan(backfillReview)
    expect(contract).toBeGreaterThan(backfillFeedback)
    expect(migration).toContain('DISABLE TRIGGER "inbox_handling_cycles_immutable"')
    expect(migration).toContain('ENABLE ALWAYS TRIGGER "inbox_handling_cycles_immutable"')
  })

  it('creates source-scoped append-only evidence before installing its FKs', () => {
    const table = migration.indexOf('CREATE TABLE "inbox_handling_cycle_transitions"')
    const evidence = migration.indexOf('INSERT INTO "inbox_handling_cycle_transitions"')
    const uniqueScope = migration.indexOf(
      'CREATE UNIQUE INDEX "inbox_items_cycle_source_scope_unique"',
    )
    const sourceFk = migration.indexOf(
      'ADD CONSTRAINT "inbox_handling_cycle_transitions_source_scope_fk"',
    )
    expect(table).toBeGreaterThanOrEqual(0)
    expect(evidence).toBeGreaterThan(table)
    expect(uniqueScope).toBeGreaterThan(evidence)
    expect(sourceFk).toBeGreaterThan(uniqueScope)
    for (const reason of [
      'feedback_submitted',
      'guest_withdrawn',
      'material_revision_changed',
      'provider_reply_deleted',
      'private_feedback_handled',
    ]) {
      expect(migration).toContain(`'${reason}'`)
    }
  })

  it('derives historical Guest feedback revision from correction event time', () => {
    expect(migration).toContain(
      'WHEN "feedback_submitted_at" >= "corrected_at" THEN "correction_count" + 1',
    )
    expect(migration).toContain(
      "MESSAGE = 'guest feedback submission revision backfill is ambiguous'",
    )
    expect(migration).toContain(
      'OR ("correction_count" > 1 AND "feedback_submitted_at" < "corrected_at")',
    )
    expect(migration).toContain(
      "DETAIL = format('%s row(s) require correction-history repair before 0132'",
    )
    expect(migration).not.toContain('SET "feedback_submission_revision" = 1\nWHERE')
  })

  it('registers exactly one journal step 0132 and the matching schema contract', () => {
    expect(journal.entries.filter((entry) => entry.idx === 132)).toEqual([
      {
        idx: 132,
        version: '7',
        when: 1790352000003,
        tag: '0132_unified_source_handling_cycles',
        breakpoints: true,
      },
    ])
    expect(
      getTableConfig(inboxHandlingCycles).columns.map((column) => column.name),
    ).toEqual(expect.arrayContaining(['source_type', 'source_id', 'source_revision']))
    expect(
      getTableConfig(inboxHandlingCycleHeads).columns.map((column) => column.name),
    ).toEqual(
      expect.arrayContaining(['source_type', 'source_id', 'current_source_revision']),
    )
    expect(getTableConfig(inboxHandlingCycleTransitions).name).toBe(
      'inbox_handling_cycle_transitions',
    )
    expect(getTableConfig(guestResponses).columns.map((column) => column.name)).toContain(
      'feedback_submission_revision',
    )
    expect(() =>
      JSON.parse(readFileSync(resolve(ROOT, 'drizzle/meta/0132_snapshot.json'), 'utf8')),
    ).not.toThrow()
  })
})
