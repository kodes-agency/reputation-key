import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { getDb, type Database } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { createInboxOrganizationExportContributor } from './inbox-organization-export.adapter'

const ORG_ID = 'org-inbox-export-0000000000000001'
const OTHER_ORG_ID = 'org-inbox-export-0000000000000002'
const PROPERTY_ID = '6a000000-0000-4000-8000-000000000001'
const REVIEW_ID = '6a000000-0000-4000-8000-000000000002'
const REVIEW_ITEM_ID = '6a000000-0000-4000-8000-000000000003'
const FEEDBACK_ITEM_ID = '6a000000-0000-4000-8000-000000000004'
const FEEDBACK_ID = '6a000000-0000-4000-8000-000000000005'
const OUTCOME_ID = '6a000000-0000-4000-8000-000000000006'
const NOTE_ID = '6a000000-0000-4000-8000-000000000007'
const ACTOR_ID = 'user-inbox-export-actor-000000001'
const ASSIGNEE_ID = 'user-inbox-export-assignee-00001'
const AT = new Date('2026-08-26T10:00:00.000Z')
const DUE_AT = new Date('2026-08-28T10:00:00.000Z')
const COMPLETED_AT = new Date('2026-08-27T10:00:00.000Z')
const EXPIRES_AT = new Date('2027-08-26T10:00:00.000Z')
const DIGEST = 'b'.repeat(64)

// The comma forces CSV quoting, so the human view is exercised too.
const NOTE_TEXT = 'Rang the guest, agreed a follow-up, then logged it'
const REOPEN_EXPLANATION = 'Reopened because the guest called back the next morning'
const OUTCOME_INTERNAL_NOTE = 'Duty manager handled it personally'
/** Denormalized source copies and personal state that must never be exported. */
const NEVER_EXPORT_SNIPPET = 'GUEST_PRIVATE_FEEDBACK_NEVER_EXPORT'
const NEVER_EXPORT_REVIEWER = 'GUEST_NAME_NEVER_EXPORT'

const db: Database = getDb()
let pool: Pool

/**
 * Reminder rows are append-only behind an ALWAYS trigger, and they cascade from
 * `inbox_items`, so fixture teardown has to lift the guard for the duration of
 * the delete. This escape hatch exists only in test code against the isolated,
 * single-worker integration database; no runtime path disables it.
 */
async function withReminderGuardDisabled(work: () => Promise<void>): Promise<void> {
  await pool.query(
    'ALTER TABLE inbox_response_target_reminders DISABLE TRIGGER "inbox_response_target_reminders_terminal_guard"',
  )
  try {
    await work()
  } finally {
    await pool.query(
      'ALTER TABLE inbox_response_target_reminders ENABLE ALWAYS TRIGGER "inbox_response_target_reminders_terminal_guard"',
    )
  }
}

async function clean(): Promise<void> {
  await withReminderGuardDisabled(async () => {
    for (const org of [ORG_ID, OTHER_ORG_ID]) {
      await pool.query('DELETE FROM inbox_user_views WHERE organization_id = $1', [org])
      await pool.query(
        'DELETE FROM inbox_response_target_reminders WHERE organization_id = $1',
        [org],
      )
      await pool.query(
        'DELETE FROM inbox_private_feedback_target_property_overrides WHERE organization_id = $1',
        [org],
      )
      await pool.query(
        'DELETE FROM inbox_response_target_organization_policies WHERE organization_id = $1',
        [org],
      )
      await pool.query('DELETE FROM inbox_items WHERE organization_id = $1', [org])
      await pool.query(
        'DELETE FROM material_review_revisions WHERE organization_id = $1',
        [org],
      )
      await pool.query('DELETE FROM reviews WHERE organization_id = $1', [org])
      await pool.query('DELETE FROM properties WHERE organization_id = $1', [org])
    }
  })
  await deleteTestOrganizations(pool, [ORG_ID, OTHER_ORG_ID])
}

async function seedScope(): Promise<void> {
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Inbox Export Test', 'inbox-export-0001', NOW())`,
    [ORG_ID],
  )
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Inbox Export Other', 'inbox-export-0002', NOW())`,
    [OTHER_ORG_ID],
  )
  await pool.query(
    `INSERT INTO properties (
       id, organization_id, name, slug, timezone, source_epoch, created_at, updated_at
     ) VALUES ($1, $2, 'Export Property', 'inbox-export-property', 'UTC', 0, NOW(), NOW())`,
    [PROPERTY_ID, ORG_ID],
  )
  await pool.query(
    `INSERT INTO reviews (
       id, organization_id, property_id, platform, external_id,
       external_location_id, rating, reviewed_at, expires_at,
       source_epoch, source_revision, source_observation_sequence,
       analysis_sequence, ai_source_byte_length, ai_source_digest,
       source_content_state, created_at, updated_at
     ) VALUES ($1, $2, $3, 'google', $4, 'locations/inbox-export', 4, $5, $6,
               0, 1, 1, 1, 1, $7, 'active', $5, $5)`,
    [REVIEW_ID, ORG_ID, PROPERTY_ID, `external-${REVIEW_ID}`, AT, EXPIRES_AT, DIGEST],
  )
  await pool.query(
    `INSERT INTO material_review_revisions (
       review_id, revision, organization_id, property_id, source_epoch,
       normalization_version, source_digest, normalized_digest, rating,
       normalized_text, content_state, created_at, updated_at
     ) VALUES ($1, 1, $2, $3, 0, 'review-material-v1', $4, $4, 4, 'material text',
               'active', $5, $5)`,
    [REVIEW_ID, ORG_ID, PROPERTY_ID, DIGEST, AT],
  )
}

async function seedInboxWork(): Promise<void> {
  await pool.query(
    `INSERT INTO inbox_items (
       id, organization_id, property_id, source_type, source_id, status,
       source_date, platform, command_revision, created_at, updated_at
     ) VALUES ($1, $2, $3, 'review', $4, 'open', $5, 'google', 1, $5, $5)`,
    [REVIEW_ITEM_ID, ORG_ID, PROPERTY_ID, REVIEW_ID, AT],
  )
  // The feedback item deliberately still carries the legacy denormalized guest
  // content copies; the export must not reach for them.
  await pool.query(
    `INSERT INTO inbox_items (
       id, organization_id, property_id, source_type, source_id, status,
       is_escalated, escalated_at, escalated_by, rating, snippet, reviewer_name,
       assigned_to, source_date, platform, closed_at, command_revision,
       created_at, updated_at
     ) VALUES ($1, $2, $3, 'feedback', $4, 'open', true, $5, $6, 2, $7, $8, $9,
               $5, 'portal', NULL, 4, $5, $5)`,
    [
      FEEDBACK_ITEM_ID,
      ORG_ID,
      PROPERTY_ID,
      FEEDBACK_ID,
      AT,
      ACTOR_ID,
      NEVER_EXPORT_SNIPPET,
      NEVER_EXPORT_REVIEWER,
      ASSIGNEE_ID,
    ],
  )

  await pool.query(
    `INSERT INTO inbox_handling_cycles (
       inbox_item_id, cycle_number, organization_id, property_id, source_type,
       source_id, source_revision, review_id, material_review_revision,
       opened_reason, opened_by, opened_at, created_at
     ) VALUES ($1, 1, $2, $3, 'review', $4, 1, $4, 1, 'review_observed', NULL, $5, $5)`,
    [REVIEW_ITEM_ID, ORG_ID, PROPERTY_ID, REVIEW_ID, AT],
  )
  await pool.query(
    `INSERT INTO inbox_handling_cycles (
       inbox_item_id, cycle_number, organization_id, property_id, source_type,
       source_id, source_revision, opened_reason, opened_by, opened_at, created_at
     ) VALUES ($1, 1, $2, $3, 'feedback', $4, 1, 'feedback_submitted', NULL, $5, $5)`,
    [FEEDBACK_ITEM_ID, ORG_ID, PROPERTY_ID, FEEDBACK_ID, AT],
  )
  await pool.query(
    `INSERT INTO inbox_handling_cycles (
       inbox_item_id, cycle_number, organization_id, property_id, source_type,
       source_id, source_revision, opened_reason, manual_reopen_reason,
       manual_reopen_explanation, supersedes_cycle_number, opened_by,
       opened_at, created_at
     ) VALUES ($1, 2, $2, $3, 'feedback', $4, 1, 'manual_reopen', 'other', $5, 1,
               $6, $7, $7)`,
    [
      FEEDBACK_ITEM_ID,
      ORG_ID,
      PROPERTY_ID,
      FEEDBACK_ID,
      REOPEN_EXPLANATION,
      ACTOR_ID,
      COMPLETED_AT,
    ],
  )

  await pool.query(
    `INSERT INTO inbox_handling_cycle_heads (
       inbox_item_id, organization_id, property_id, source_type, source_id,
       current_source_revision, review_id, current_cycle_number,
       current_material_review_revision, state_revision, status,
       created_at, updated_at
     ) VALUES ($1, $2, $3, 'review', $4, 1, $4, 1, 1, 1, 'open', $5, $5)`,
    [REVIEW_ITEM_ID, ORG_ID, PROPERTY_ID, REVIEW_ID, AT],
  )
  await pool.query(
    `INSERT INTO inbox_handling_cycle_heads (
       inbox_item_id, organization_id, property_id, source_type, source_id,
       current_source_revision, current_cycle_number, state_revision, status,
       created_at, updated_at
     ) VALUES ($1, $2, $3, 'feedback', $4, 1, 2, 3, 'open', $5, $5)`,
    [FEEDBACK_ITEM_ID, ORG_ID, PROPERTY_ID, FEEDBACK_ID, AT],
  )

  await pool.query(
    `INSERT INTO inbox_handling_cycle_transitions (
       inbox_item_id, state_revision, cycle_number, organization_id, property_id,
       source_type, source_id, source_revision, kind, transition_reason,
       actor_type, actor_user_id, transitioned_at, created_at
     ) VALUES ($1, 1, 1, $2, $3, 'review', $4, 1, 'opened', 'review_observed',
               'provider', NULL, $5, $5)`,
    [REVIEW_ITEM_ID, ORG_ID, PROPERTY_ID, REVIEW_ID, AT],
  )
  await pool.query(
    `INSERT INTO inbox_handling_cycle_transitions (
       inbox_item_id, state_revision, cycle_number, organization_id, property_id,
       source_type, source_id, source_revision, kind, transition_reason,
       actor_type, actor_user_id, transitioned_at, created_at
     ) VALUES ($1, 1, 1, $2, $3, 'feedback', $4, 1, 'opened', 'feedback_submitted',
               'guest', NULL, $5, $5)`,
    [FEEDBACK_ITEM_ID, ORG_ID, PROPERTY_ID, FEEDBACK_ID, AT],
  )
  await pool.query(
    `INSERT INTO inbox_handling_cycle_transitions (
       inbox_item_id, state_revision, cycle_number, organization_id, property_id,
       source_type, source_id, source_revision, kind, transition_reason,
       actor_type, actor_user_id, transitioned_at, created_at
     ) VALUES ($1, 2, 1, $2, $3, 'feedback', $4, 1, 'closed',
               'private_feedback_handled', 'user', $5, $6, $6)`,
    [FEEDBACK_ITEM_ID, ORG_ID, PROPERTY_ID, FEEDBACK_ID, ACTOR_ID, COMPLETED_AT],
  )
  await pool.query(
    `INSERT INTO inbox_handling_cycle_transitions (
       inbox_item_id, state_revision, cycle_number, organization_id, property_id,
       source_type, source_id, source_revision, kind, transition_reason,
       actor_type, actor_user_id, transitioned_at, created_at
     ) VALUES ($1, 3, 2, $2, $3, 'feedback', $4, 1, 'reopened', 'other',
               'user', $5, $6, $6)`,
    [FEEDBACK_ITEM_ID, ORG_ID, PROPERTY_ID, FEEDBACK_ID, ACTOR_ID, COMPLETED_AT],
  )

  await pool.query(
    `INSERT INTO inbox_handling_cycle_response_targets (
       inbox_item_id, cycle_number, organization_id, property_id, source_type,
       source_id, source_revision, target_kind, performance_eligibility,
       duration_minutes, policy_source, policy_version, start_at, due_at,
       completion_at, result, stop_reason, created_at, updated_at
     ) VALUES ($1, 1, $2, $3, 'feedback', $4, 1, 'private_feedback_handling',
               'measured', 2880, 'organization_policy', 1, $5, $6, $7, 'on_time',
               'private_feedback_handled', $5, $5)`,
    [FEEDBACK_ITEM_ID, ORG_ID, PROPERTY_ID, FEEDBACK_ID, AT, DUE_AT, COMPLETED_AT],
  )
  // A reminder slot: control-plane scheduling that must never reach the archive.
  await pool.query(
    `INSERT INTO inbox_response_target_reminders (
       inbox_item_id, cycle_number, reminder_kind, organization_id, property_id,
       target_kind, scheduled_for, created_at, updated_at
     ) VALUES ($1, 1, 'halfway', $2, $3, 'private_feedback_handling', $4, $5, $5)`,
    [FEEDBACK_ITEM_ID, ORG_ID, PROPERTY_ID, COMPLETED_AT, AT],
  )

  await pool.query(
    `INSERT INTO inbox_feedback_handling_outcomes (
       id, inbox_item_id, cycle_number, outcome_revision, organization_id,
       property_id, source_type, feedback_id, source_revision, outcome,
       internal_note, recorded_by, recorded_at, completion_at,
       completion_state_revision, deadline_result, resulting_command_revision,
       created_at
     ) VALUES ($1, $2, 1, 1, $3, $4, 'feedback', $5, 1, 'follow_up_completed',
               $6, $7, $8, $8, 2, 'on_time', 2, $8)`,
    [
      OUTCOME_ID,
      FEEDBACK_ITEM_ID,
      ORG_ID,
      PROPERTY_ID,
      FEEDBACK_ID,
      OUTCOME_INTERNAL_NOTE,
      ACTOR_ID,
      COMPLETED_AT,
    ],
  )

  await pool.query(
    `INSERT INTO inbox_assignment_history (
       inbox_item_id, resulting_command_revision, organization_id, property_id,
       handling_cycle_number, previous_assignee, next_assignee, reason,
       actor_user_id, occurred_at, created_at
     ) VALUES ($1, 3, $2, $3, 1, NULL, $4, 'assign', $5, $6, $6)`,
    [FEEDBACK_ITEM_ID, ORG_ID, PROPERTY_ID, ASSIGNEE_ID, ACTOR_ID, AT],
  )
  await pool.query(
    `INSERT INTO inbox_escalation_history (
       inbox_item_id, resulting_command_revision, organization_id, property_id,
       handling_cycle_number, kind, actor_user_id, occurred_at, created_at
     ) VALUES ($1, 4, $2, $3, 2, 'escalated', $4, $5, $5)`,
    [FEEDBACK_ITEM_ID, ORG_ID, PROPERTY_ID, ACTOR_ID, COMPLETED_AT],
  )

  await pool.query(
    `INSERT INTO inbox_response_target_organization_policies (
       organization_id, target_kind, duration_minutes, policy_version,
       updated_by, created_at, updated_at
     ) VALUES ($1, 'private_feedback_handling', 2880, 1, $2, $3, $3)`,
    [ORG_ID, ACTOR_ID, AT],
  )
  await pool.query(
    `INSERT INTO inbox_private_feedback_target_property_overrides (
       organization_id, property_id, enabled, duration_minutes, policy_version,
       updated_by, created_at, updated_at
     ) VALUES ($1, $2, true, 1440, 1, $3, $4, $4)`,
    [ORG_ID, PROPERTY_ID, ACTOR_ID, AT],
  )

  await pool.query(
    `INSERT INTO inbox_notes (id, inbox_item_id, organization_id, author_user_id,
                              text, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [NOTE_ID, FEEDBACK_ITEM_ID, ORG_ID, ACTOR_ID, NOTE_TEXT, AT],
  )
  // Personal read state: never tenant-visible export material.
  await pool.query(
    `INSERT INTO inbox_user_views (organization_id, user_id, last_inbox_view, updated_at)
     VALUES ($1, $2, $3, $3)`,
    [ORG_ID, ACTOR_ID, AT],
  )
}

beforeAll(async () => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 4 })
  const client = await pool.connect()
  client.release()
})

afterAll(async () => {
  await clean()
  await pool.end()
})

beforeEach(async () => {
  await clean()
  await seedScope()
})

describe.sequential('Inbox Organization Export contributor (PostgreSQL)', () => {
  it('exports the manager handling record deterministically and by disclosure class', async () => {
    await seedInboxWork()
    const contributor = createInboxOrganizationExportContributor(db)
    const asOf = new Date(Date.now() - 1000)

    const first = await contributor.contribute({
      organizationId: ORG_ID,
      requestId: randomUUID(),
      asOf,
    })
    const replay = await contributor.contribute({
      organizationId: ORG_ID,
      requestId: randomUUID(),
      asOf,
    })

    expect(first).toEqual(replay)
    expect(first.coverage).toBe('complete')
    expect(first.entries.map((entry) => entry.path)).toEqual([
      'inbox/assignment-history.csv',
      'inbox/assignment-history.json',
      'inbox/escalation-history.csv',
      'inbox/escalation-history.json',
      'inbox/handling-cycles.csv',
      'inbox/handling-cycles.json',
      'inbox/handling-notes.csv',
      'inbox/handling-notes.json',
      'inbox/handling-outcomes.csv',
      'inbox/handling-outcomes.json',
      'inbox/items.csv',
      'inbox/items.json',
      'inbox/notes.csv',
      'inbox/notes.json',
      'inbox/response-target-policies.csv',
      'inbox/response-target-policies.json',
    ])
    expect(
      first.entries
        .filter((entry) => entry.classification === 'manager_authored')
        .map((entry) => entry.path),
    ).toEqual([
      'inbox/handling-notes.csv',
      'inbox/handling-notes.json',
      'inbox/notes.csv',
      'inbox/notes.json',
    ])

    const items = JSON.parse(
      Buffer.from(
        first.entries.find((e) => e.path === 'inbox/items.json')!.bytes,
      ).toString('utf8'),
    ) as { items: readonly Record<string, unknown>[] }
    expect(items.items.map((item) => item.id).sort()).toEqual(
      [FEEDBACK_ITEM_ID, REVIEW_ITEM_ID].sort(),
    )

    const cycles = JSON.parse(
      Buffer.from(
        first.entries.find((e) => e.path === 'inbox/handling-cycles.json')!.bytes,
      ).toString('utf8'),
    ) as {
      cycles: readonly Record<string, unknown>[]
      transitions: readonly Record<string, unknown>[]
      responseTargets: readonly Record<string, unknown>[]
    }
    expect(cycles.cycles).toHaveLength(3)
    expect(cycles.transitions).toHaveLength(4)
    expect(cycles.responseTargets).toHaveLength(1)
    // The superseded cycle keeps its own opening fact; nothing is rewritten.
    expect(cycles.cycles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          cycle_number: '1',
          opened_reason: 'feedback_submitted',
        }),
        expect.objectContaining({ cycle_number: '2', opened_reason: 'manual_reopen' }),
      ]),
    )

    const escalations = JSON.parse(
      Buffer.from(
        first.entries.find((e) => e.path === 'inbox/escalation-history.json')!.bytes,
      ).toString('utf8'),
    ) as { escalations: readonly Record<string, unknown>[] }
    expect(escalations.escalations).toEqual([
      expect.objectContaining({ kind: 'escalated', actor_user_id: ACTOR_ID }),
    ])
  })

  it('excludes personal view state, reminder schedules, and denormalized source copies', async () => {
    await seedInboxWork()
    const contributor = createInboxOrganizationExportContributor(db)

    const contribution = await contributor.contribute({
      organizationId: ORG_ID,
      requestId: randomUUID(),
      asOf: new Date(Date.now() - 1000),
    })

    const archiveText = contribution.entries
      .map(({ bytes }) => Buffer.from(bytes).toString('utf8'))
      .join('\n')
    expect(archiveText).not.toContain(NEVER_EXPORT_SNIPPET)
    expect(archiveText).not.toContain(NEVER_EXPORT_REVIEWER)
    expect(archiveText).not.toContain('last_inbox_view')
    expect(archiveText).not.toContain('reminder_kind')
    expect(archiveText).not.toContain('halfway')
    // The manager's own words survive, in the manager-authored files only.
    expect(archiveText).toContain(NOTE_TEXT)
    expect(archiveText).toContain(REOPEN_EXPLANATION)
    expect(archiveText).toContain(OUTCOME_INTERNAL_NOTE)
    for (const entry of contribution.entries) {
      if (entry.classification === 'manager_authored') continue
      const text = Buffer.from(entry.bytes).toString('utf8')
      expect(text).not.toContain(NOTE_TEXT)
      expect(text).not.toContain(REOPEN_EXPLANATION)
      expect(text).not.toContain(OUTCOME_INTERNAL_NOTE)
    }
  })

  it('is tenant-fenced: another Organization sees none of this Inbox work', async () => {
    await seedInboxWork()
    const contributor = createInboxOrganizationExportContributor(db)

    const contribution = await contributor.contribute({
      organizationId: OTHER_ORG_ID,
      requestId: randomUUID(),
      asOf: new Date(Date.now() - 1000),
    })

    expect(contribution).toEqual({
      context: 'inbox',
      coverage: 'no_data',
      omissionCodes: [],
      entries: [],
    })
  })

  it('fails closed when a queued request is outside the bounded snapshot window', async () => {
    await seedInboxWork()
    const contributor = createInboxOrganizationExportContributor(db)

    await expect(
      contributor.contribute({
        organizationId: ORG_ID,
        requestId: randomUUID(),
        asOf: new Date(Date.now() - 16 * 60 * 1000),
      }),
    ).rejects.toThrow(/snapshot window is unavailable/)
  })
})
