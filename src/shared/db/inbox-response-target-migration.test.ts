import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getTableConfig } from 'drizzle-orm/pg-core'
import {
  inboxHandlingCycleResponseTargets,
  inboxPrivateFeedbackTargetPropertyOverrides,
  inboxResponseTargetReminders,
} from './schema/inbox.schema'
import {
  materialReviewRevisions,
  reviewProviderSnapshotRuns,
} from './schema/review.schema'

const migration = readFileSync(
  resolve(process.cwd(), 'drizzle/0158_inbox_response_targets.sql'),
  'utf8',
)
const provenanceMigration = readFileSync(
  resolve(process.cwd(), 'drizzle/0166_review_response_target_provenance.sql'),
  'utf8',
)
const terminalOutcomeMigration = readFileSync(
  resolve(process.cwd(), 'drizzle/0167_inbox_response_target_terminal_outcomes.sql'),
  'utf8',
)
const journal = JSON.parse(
  readFileSync(resolve(process.cwd(), 'drizzle/meta/_journal.json'), 'utf8'),
) as { entries: Array<{ idx: number; when: number; tag: string }> }

describe('0158 Inbox Response Targets', () => {
  it('journals the expand-only migration in sequence', () => {
    expect(journal.entries).toContainEqual(
      expect.objectContaining({
        idx: 158,
        when: 1790352000029,
        tag: '0158_inbox_response_targets',
      }),
    )
    expect(migration).not.toMatch(/DROP\s+(TABLE|COLUMN)/iu)
  })

  it('has no Portal override key and binds every target to an exact Handling Cycle', () => {
    const overrideColumns = getTableConfig(
      inboxPrivateFeedbackTargetPropertyOverrides,
    ).columns.map((column) => column.name)
    expect(overrideColumns).toContain('property_id')
    expect(overrideColumns).not.toContain('portal_id')

    const target = getTableConfig(inboxHandlingCycleResponseTargets)
    expect(
      target.foreignKeys.find(
        (foreignKey) =>
          foreignKey.getName() === 'inbox_handling_cycle_response_targets_cycle_scope_fk',
      ),
    ).toBeDefined()
    expect(target.primaryKeys[0]?.columns.map((column) => column.name)).toEqual([
      'inbox_item_id',
      'cycle_number',
    ])
  })

  it('pins two bounded reminder kinds and always-on immutability guards', () => {
    const reminder = getTableConfig(inboxResponseTargetReminders)
    expect(reminder.primaryKeys[0]?.columns.map((column) => column.name)).toEqual([
      'inbox_item_id',
      'cycle_number',
      'reminder_kind',
    ])
    expect(migration).toContain("reminder_kind\" IN ('halfway', 'target_passed')")
    expect(migration).toContain(
      'ENABLE ALWAYS TRIGGER "inbox_handling_cycle_response_targets_terminal_guard"',
    )
    expect(migration).toContain(
      'ENABLE ALWAYS TRIGGER "inbox_response_target_reminders_terminal_guard"',
    )
    expect(migration).toContain(
      'ENABLE ALWAYS TRIGGER "inbox_response_target_reminders_schedule_guard"',
    )
    expect(migration).toContain(
      'NEW.scheduled_for <> target_start + make_interval(secs => target_duration * 30)',
    )
    expect(migration).toContain(
      '"target_kind" = \'private_feedback_handling\' OR "policy_source" <> \'property_override\'',
    )
  })
})

describe('0166 Review Response Target provenance', () => {
  it('journals an expand-only provenance migration in sequence', () => {
    expect(journal.entries).toContainEqual(
      expect.objectContaining({
        idx: 166,
        tag: '0166_review_response_target_provenance',
      }),
    )
    expect(provenanceMigration).not.toMatch(/DROP\s+(TABLE|COLUMN)/iu)
  })

  it('keeps older provider runs and material revisions explicitly unmeasured', () => {
    expect(provenanceMigration).toContain(
      'ADD COLUMN "observation_origin" varchar(32) DEFAULT \'legacy_unknown\' NOT NULL',
    )
    expect(provenanceMigration).toContain(
      'ADD COLUMN "response_target_eligibility" varchar(32) DEFAULT \'legacy_unknown\' NOT NULL',
    )
    expect(provenanceMigration).toContain(
      'ADD COLUMN "response_target_start_at" timestamp with time zone',
    )

    const runColumns = getTableConfig(reviewProviderSnapshotRuns).columns.map(
      (column) => column.name,
    )
    const revisionColumns = getTableConfig(materialReviewRevisions).columns.map(
      (column) => column.name,
    )
    expect(runColumns).toContain('observation_origin')
    expect(revisionColumns).toEqual(
      expect.arrayContaining(['response_target_eligibility', 'response_target_start_at']),
    )
  })

  it('requires an exact start only for measured material revisions', () => {
    expect(provenanceMigration).toContain(
      "\"response_target_eligibility\" IN ('measured', 'legacy_unknown', 'historical_onboarding')",
    )
    expect(provenanceMigration).toContain(
      '("response_target_eligibility" = \'measured\' AND "response_target_start_at" IS NOT NULL)',
    )
    expect(provenanceMigration).toContain(
      '("response_target_eligibility" <> \'measured\' AND "response_target_start_at" IS NULL)',
    )
  })
})

describe('0167 Inbox Response Target terminal outcomes', () => {
  it('journals an additive constraint replacement after provenance', () => {
    expect(journal.entries).toContainEqual(
      expect.objectContaining({
        idx: 167,
        tag: '0167_inbox_response_target_terminal_outcomes',
      }),
    )
    expect(terminalOutcomeMigration).not.toMatch(/DROP\s+(TABLE|COLUMN)/iu)
  })

  it('allows explicit non-performance endings without treating them as responses', () => {
    expect(terminalOutcomeMigration).toContain("'superseded_by_source_revision'")
    expect(terminalOutcomeMigration).toContain("'source_ineligible'")
    expect(terminalOutcomeMigration).toContain('"result" = \'cancelled\'')
    expect(terminalOutcomeMigration).toContain("\"result\" IN ('on_time', 'late')")
  })
})
