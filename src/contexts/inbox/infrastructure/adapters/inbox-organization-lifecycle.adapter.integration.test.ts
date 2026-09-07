// LIF-01 T12/T13/T14 — Inbox lifecycle contributor against real PostgreSQL.
//
// The unit test proves the decision logic. Only a real schema can prove the
// three claims the program actually rests on:
//   * closing STOPS EFFECTS and DELETES NOTHING — every Inbox table has the
//     same row count before and after;
//   * readiness is READ ONLY — row counts and row contents are byte-identical
//     across the call, and it fails closed on an unfenced reminder;
//   * purge really removes the Organization's handling record, including the
//     append-only history that is reachable ONLY through an item cascade,
//     without touching a second Organization's rows.

import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import { getDb, type Database } from '#/shared/db'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import type { OrganizationLifecycleContributionInput } from '#/contexts/identity/application/ports/organization-lifecycle-contributor.port'
import { createInboxOrganizationLifecycleContributor } from './inbox-organization-lifecycle.adapter'

const ORG_ID = 'org-inbox-lifecycle-000000000001'
const OTHER_ORG_ID = 'org-inbox-lifecycle-000000000002'
const PROPERTY_ID = '7b000000-0000-4000-8000-000000000001'
const OTHER_PROPERTY_ID = '7b000000-0000-4000-8000-00000000000a'
const REVIEW_ID = '7b000000-0000-4000-8000-000000000002'
const REVIEW_ITEM_ID = '7b000000-0000-4000-8000-000000000003'
const FEEDBACK_ITEM_ID = '7b000000-0000-4000-8000-000000000004'
const FEEDBACK_ID = '7b000000-0000-4000-8000-000000000005'
const OUTCOME_ID = '7b000000-0000-4000-8000-000000000006'
const NOTE_ID = '7b000000-0000-4000-8000-000000000007'
const OTHER_ITEM_ID = '7b000000-0000-4000-8000-00000000000b'
const OTHER_FEEDBACK_ID = '7b000000-0000-4000-8000-00000000000c'
const ACTOR_ID = 'user-inbox-lifecycle-actor-00001'
const ASSIGNEE_ID = 'user-inbox-lifecycle-assignee-01'
const AT = new Date('2026-08-26T10:00:00.000Z')
const DUE_AT = new Date('2026-08-28T10:00:00.000Z')
const REMINDER_AT = new Date('2026-08-27T10:00:00.000Z')
const EXPIRES_AT = new Date('2027-08-26T10:00:00.000Z')
const RECOVERABLE_UNTIL = new Date('2026-09-27T00:00:00.000Z')
const OCCURRED_AT = new Date('2026-08-28T12:00:00.000Z')
const DIGEST = 'c'.repeat(64)

/** Every Inbox table the purge plan is responsible for emptying. */
const INBOX_TABLES = Object.freeze([
  'inbox_items',
  'inbox_handling_cycles',
  'inbox_handling_cycle_heads',
  'inbox_handling_cycle_transitions',
  'inbox_handling_cycle_response_targets',
  'inbox_response_target_reminders',
  'inbox_feedback_handling_outcomes',
  'inbox_assignment_history',
  'inbox_escalation_history',
  'inbox_notes',
  'inbox_response_target_organization_policies',
  'inbox_private_feedback_target_property_overrides',
  'inbox_user_views',
] as const)

const db: Database = getDb()
let pool: Pool

/**
 * The real closure path. PostgreSQL enforces the state machine, the reason
 * code on each edge, and a revision that advances by exactly one, so the
 * fixture cannot jump straight to a phase's required state — and the request
 * it hands back therefore carries the lineage and revision the receipt store
 * will actually demand.
 */
const CLOSURE_PATH = Object.freeze([
  ['closure_requested', 'test_workspace'],
  ['closing', 'closing_prepared'],
  ['purge_pending', 'recovery_window_elapsed'],
  ['purging', 'irreversible_purge_authorized'],
] as const)

type ClosureState = (typeof CLOSURE_PATH)[number][0]

let closureLineageId: string
let closureStep: number

function contribution(): OrganizationLifecycleContributionInput {
  return {
    organizationId: ORG_ID,
    closureLineageId,
    lifecycleRevision: closureStep,
    recoverableUntil: RECOVERABLE_UNTIL,
    occurredAt: OCCURRED_AT,
  }
}

/** Walks the authority forward from wherever this test left it. */
async function advanceAuthorityTo(
  target: ClosureState,
): Promise<OrganizationLifecycleContributionInput> {
  const targetStep = CLOSURE_PATH.findIndex(([state]) => state === target) + 1
  while (closureStep < targetStep) {
    const [state, reasonCode] = CLOSURE_PATH[closureStep]!
    if (closureStep === 0) {
      await pool.query(
        `UPDATE organization_lifecycle_authority
         SET state = $1, revision = revision + 1, closure_lineage_id = $2,
             closure_requested_at = $3, recoverable_until = $4,
             reactivation_required = true,
             requested_by = 'admin:inbox-lifecycle-test',
             request_reason_code = 'test_workspace',
             request_support_evidence_ref = 'test:inbox-lifecycle',
             last_transition_at = $3, last_actor_id = 'admin:inbox-lifecycle-test',
             last_reason_code = $5,
             last_support_evidence_ref = 'test:inbox-lifecycle'
         WHERE organization_id = $6`,
        [state, closureLineageId, AT, RECOVERABLE_UNTIL, reasonCode, ORG_ID],
      )
    } else {
      // Crossing into `purging` must stamp the irreversible boundary; the
      // state-shape CHECK constraint refuses the row without it.
      await pool.query(
        `UPDATE organization_lifecycle_authority
         SET state = $1, revision = revision + 1, last_reason_code = $2,
             last_transition_at = $3, last_actor_id = 'admin:inbox-lifecycle-test',
             last_support_evidence_ref = 'test:inbox-lifecycle',
             irreversible_at = CASE WHEN $1 = 'purging' THEN $3 ELSE irreversible_at END
         WHERE organization_id = $4`,
        [state, reasonCode, AT, ORG_ID],
      )
    }
    closureStep += 1
  }
  return contribution()
}

/**
 * Drops this context's event so the SAME phase re-executes its SQL instead of
 * replaying the recorded outcome. Production cannot do this because the
 * append-only event trigger refuses mutation.
 */
async function forgetInboxReceipt(): Promise<void> {
  await withGuardsDisabled(async () => {
    await pool.query(
      `DELETE FROM organization_lifecycle_events
       WHERE organization_id = $1 AND context = 'inbox'
         AND kind LIKE 'organization_lifecycle_contribution:%'`,
      [ORG_ID],
    )
  })
}

/**
 * Reminder and history rows sit behind ALWAYS triggers that accept a delete
 * only as an item cascade. Fixture teardown lifts the reminder guard, exactly
 * as the Inbox export fixture does; no runtime path disables a trigger.
 */
async function withGuardsDisabled(work: () => Promise<void>): Promise<void> {
  await pool.query(
    'ALTER TABLE inbox_response_target_reminders DISABLE TRIGGER "inbox_response_target_reminders_terminal_guard"',
  )
  await pool.query(
    'ALTER TABLE organization_lifecycle_events DISABLE TRIGGER organization_lifecycle_events_append_only',
  )
  try {
    await work()
  } finally {
    await pool.query(
      'ALTER TABLE organization_lifecycle_events ENABLE ALWAYS TRIGGER organization_lifecycle_events_append_only',
    )
    await pool.query(
      'ALTER TABLE inbox_response_target_reminders ENABLE ALWAYS TRIGGER "inbox_response_target_reminders_terminal_guard"',
    )
  }
}

async function clean(): Promise<void> {
  await withGuardsDisabled(async () => {
    for (const org of [ORG_ID, OTHER_ORG_ID]) {
      await pool.query(
        'DELETE FROM organization_lifecycle_events WHERE organization_id = $1',
        [org],
      )
      for (const table of INBOX_TABLES) {
        await pool.query(`DELETE FROM ${table} WHERE organization_id = $1`, [org])
      }
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
     VALUES ($1, 'Inbox Lifecycle Test', 'inbox-lifecycle-0001', $2)`,
    [ORG_ID, AT],
  )
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Inbox Lifecycle Other', 'inbox-lifecycle-0002', $2)`,
    [OTHER_ORG_ID, AT],
  )
  for (const [propertyId, org, slug] of [
    [PROPERTY_ID, ORG_ID, 'inbox-lifecycle-property'],
    [OTHER_PROPERTY_ID, OTHER_ORG_ID, 'inbox-lifecycle-other-property'],
  ] as const) {
    await pool.query(
      `INSERT INTO properties (
         id, organization_id, name, slug, timezone, source_epoch, created_at, updated_at
       ) VALUES ($1, $2, 'Lifecycle Property', $3, 'UTC', 0, $4, $4)`,
      [propertyId, org, slug, AT],
    )
  }
  await pool.query(
    `INSERT INTO reviews (
       id, organization_id, property_id, platform, external_id,
       external_location_id, rating, reviewed_at, expires_at,
       source_epoch, source_revision, source_observation_sequence,
       analysis_sequence, ai_source_byte_length, ai_source_digest,
       source_content_state, created_at, updated_at
     ) VALUES ($1, $2, $3, 'google', $4, 'locations/inbox-lifecycle', 4, $5, $6,
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

/** A full handling record: item, cycles, targets, an open reminder, history. */
async function seedInboxWork(): Promise<void> {
  await pool.query(
    `INSERT INTO inbox_items (
       id, organization_id, property_id, source_type, source_id, status,
       source_date, platform, command_revision, created_at, updated_at
     ) VALUES ($1, $2, $3, 'review', $4, 'open', $5, 'google', 1, $5, $5)`,
    [REVIEW_ITEM_ID, ORG_ID, PROPERTY_ID, REVIEW_ID, AT],
  )
  await pool.query(
    `INSERT INTO inbox_items (
       id, organization_id, property_id, source_type, source_id, status,
       is_escalated, escalated_at, escalated_by, assigned_to, source_date,
       platform, command_revision, created_at, updated_at
     ) VALUES ($1, $2, $3, 'feedback', $4, 'open', true, $5, $6, $7, $5,
               'portal', 4, $5, $5)`,
    [FEEDBACK_ITEM_ID, ORG_ID, PROPERTY_ID, FEEDBACK_ID, AT, ACTOR_ID, ASSIGNEE_ID],
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
    `INSERT INTO inbox_handling_cycle_heads (
       inbox_item_id, organization_id, property_id, source_type, source_id,
       current_source_revision, review_id, current_cycle_number,
       current_material_review_revision, state_revision, status,
       created_at, updated_at
     ) VALUES ($1, $2, $3, 'review', $4, 1, $4, 1, 1, 1, 'open', $5, $5)`,
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
  // The closing transition the append-only outcome row below must point at.
  await pool.query(
    `INSERT INTO inbox_handling_cycle_transitions (
       inbox_item_id, state_revision, cycle_number, organization_id, property_id,
       source_type, source_id, source_revision, kind, transition_reason,
       actor_type, actor_user_id, transitioned_at, created_at
     ) VALUES ($1, 2, 1, $2, $3, 'feedback', $4, 1, 'closed',
               'private_feedback_handled', 'user', $5, $6, $6)`,
    [FEEDBACK_ITEM_ID, ORG_ID, PROPERTY_ID, FEEDBACK_ID, ACTOR_ID, DUE_AT],
  )
  await pool.query(
    `INSERT INTO inbox_handling_cycle_response_targets (
       inbox_item_id, cycle_number, organization_id, property_id, source_type,
       source_id, source_revision, target_kind, performance_eligibility,
       duration_minutes, policy_source, policy_version, start_at, due_at,
       created_at, updated_at
     ) VALUES ($1, 1, $2, $3, 'feedback', $4, 1, 'private_feedback_handling',
               'measured', 2880, 'organization_policy', 1, $5, $6, $5, $5)`,
    [FEEDBACK_ITEM_ID, ORG_ID, PROPERTY_ID, FEEDBACK_ID, AT, DUE_AT],
  )
  // The one background effect Inbox owns: an open, deliverable reminder slot.
  await pool.query(
    `INSERT INTO inbox_response_target_reminders (
       inbox_item_id, cycle_number, reminder_kind, organization_id, property_id,
       target_kind, scheduled_for, created_at, updated_at
     ) VALUES ($1, 1, 'halfway', $2, $3, 'private_feedback_handling', $4, $5, $5)`,
    [FEEDBACK_ITEM_ID, ORG_ID, PROPERTY_ID, REMINDER_AT, AT],
  )
  await pool.query(
    `INSERT INTO inbox_feedback_handling_outcomes (
       id, inbox_item_id, cycle_number, outcome_revision, organization_id,
       property_id, source_type, feedback_id, source_revision, outcome,
       internal_note, recorded_by, recorded_at, completion_at,
       completion_state_revision, deadline_result, resulting_command_revision,
       created_at
     ) VALUES ($1, $2, 1, 1, $3, $4, 'feedback', $5, 1, 'follow_up_completed',
               'duty manager handled it', $6, $7, $7, 2, 'on_time', 2, $7)`,
    [OUTCOME_ID, FEEDBACK_ITEM_ID, ORG_ID, PROPERTY_ID, FEEDBACK_ID, ACTOR_ID, DUE_AT],
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
     ) VALUES ($1, 4, $2, $3, 1, 'escalated', $4, $5, $5)`,
    [FEEDBACK_ITEM_ID, ORG_ID, PROPERTY_ID, ACTOR_ID, AT],
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
     VALUES ($1, $2, $3, $4, 'rang the guest back', $5)`,
    [NOTE_ID, FEEDBACK_ITEM_ID, ORG_ID, ACTOR_ID, AT],
  )
  await pool.query(
    `INSERT INTO inbox_user_views (organization_id, user_id, last_inbox_view, updated_at)
     VALUES ($1, $2, $3, $3)`,
    [ORG_ID, ACTOR_ID, AT],
  )
  // A second tenant with its own item and open reminder. Nothing this adapter
  // does may touch it.
  await pool.query(
    `INSERT INTO inbox_items (
       id, organization_id, property_id, source_type, source_id, status,
       source_date, platform, command_revision, created_at, updated_at
     ) VALUES ($1, $2, $3, 'feedback', $4, 'open', $5, 'portal', 1, $5, $5)`,
    [OTHER_ITEM_ID, OTHER_ORG_ID, OTHER_PROPERTY_ID, OTHER_FEEDBACK_ID, AT],
  )
  await pool.query(
    `INSERT INTO inbox_handling_cycles (
       inbox_item_id, cycle_number, organization_id, property_id, source_type,
       source_id, source_revision, opened_reason, opened_by, opened_at, created_at
     ) VALUES ($1, 1, $2, $3, 'feedback', $4, 1, 'feedback_submitted', NULL, $5, $5)`,
    [OTHER_ITEM_ID, OTHER_ORG_ID, OTHER_PROPERTY_ID, OTHER_FEEDBACK_ID, AT],
  )
  await pool.query(
    `INSERT INTO inbox_handling_cycle_response_targets (
       inbox_item_id, cycle_number, organization_id, property_id, source_type,
       source_id, source_revision, target_kind, performance_eligibility,
       duration_minutes, policy_source, policy_version, start_at, due_at,
       created_at, updated_at
     ) VALUES ($1, 1, $2, $3, 'feedback', $4, 1, 'private_feedback_handling',
               'measured', 2880, 'organization_policy', 1, $5, $6, $5, $5)`,
    [OTHER_ITEM_ID, OTHER_ORG_ID, OTHER_PROPERTY_ID, OTHER_FEEDBACK_ID, AT, DUE_AT],
  )
  await pool.query(
    `INSERT INTO inbox_response_target_reminders (
       inbox_item_id, cycle_number, reminder_kind, organization_id, property_id,
       target_kind, scheduled_for, created_at, updated_at
     ) VALUES ($1, 1, 'halfway', $2, $3, 'private_feedback_handling', $4, $5, $5)`,
    [OTHER_ITEM_ID, OTHER_ORG_ID, OTHER_PROPERTY_ID, REMINDER_AT, AT],
  )
}

async function rowCounts(organizationId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  for (const table of INBOX_TABLES) {
    const result = await pool.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM ${table} WHERE organization_id = $1`,
      [organizationId],
    )
    counts[table] = Number(result.rows[0]!.total)
  }
  return counts
}

/** A stable content fingerprint of everything Inbox holds for the tenant. */
async function contentSnapshot(organizationId: string): Promise<string> {
  const parts: string[] = []
  for (const table of INBOX_TABLES) {
    const result = await pool.query<{ dump: string | null }>(
      `SELECT string_agg(row_dump, '|' ORDER BY row_dump) AS dump
       FROM (SELECT t::text AS row_dump FROM ${table} t
             WHERE t.organization_id = $1) AS rows`,
      [organizationId],
    )
    parts.push(`${table}=${result.rows[0]?.dump ?? ''}`)
  }
  return parts.join('\n')
}

async function openReminderCount(organizationId: string): Promise<number> {
  const result = await pool.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM inbox_response_target_reminders
     WHERE organization_id = $1 AND delivered_at IS NULL AND cancelled_at IS NULL`,
    [organizationId],
  )
  return Number(result.rows[0]!.total)
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
  closureLineageId = randomUUID()
  closureStep = 0
})

describe.sequential('Inbox Organization lifecycle contributor (PostgreSQL)', () => {
  it('stops reminder delivery at closing and deletes nothing', async () => {
    await seedInboxWork()
    const request = await advanceAuthorityTo('closure_requested')
    const before = await rowCounts(ORG_ID)
    expect(await openReminderCount(ORG_ID)).toBe(1)

    const result =
      await createInboxOrganizationLifecycleContributor(db).prepareClosing(request)

    expect(result.outcome).toBe('complete')
    // STOP EFFECTS: the reminder can no longer be released.
    expect(await openReminderCount(ORG_ID)).toBe(0)
    // KEEP DATA: closure is recoverable, so not one row may disappear.
    expect(await rowCounts(ORG_ID)).toEqual(before)
    // The second tenant's reminder is untouched.
    expect(await openReminderCount(OTHER_ORG_ID)).toBe(1)
  })

  it('records exactly one content-free receipt per phase', async () => {
    await seedInboxWork()
    const request = await advanceAuthorityTo('closure_requested')

    await createInboxOrganizationLifecycleContributor(db).prepareClosing(request)

    const receipts = await pool.query(
      `SELECT context, phase, payload->>'outcome' AS outcome,
              payload->>'evidenceRef' AS evidence_ref,
              (payload->>'lifecycleRevision')::integer AS lifecycle_revision
       FROM organization_lifecycle_events
       WHERE organization_id = $1 AND payload->>'closureLineageId' = $2
         AND kind LIKE 'organization_lifecycle_contribution:%'`,
      [ORG_ID, request.closureLineageId],
    )
    expect(receipts.rows).toEqual([
      {
        context: 'inbox',
        phase: 'closing',
        outcome: 'complete',
        evidence_ref: expect.stringMatching(/^inbox-lifecycle:closing:/u),
        lifecycle_revision: 1,
      },
    ])
    // Content-free: no manager note, guest text or actor id may appear.
    const evidenceRef = (receipts.rows[0] as { evidence_ref: string }).evidence_ref
    expect(evidenceRef).toMatch(/^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$/u)
    expect(evidenceRef).not.toContain(ACTOR_ID)
  })

  it('verifies purge readiness without mutating a single row', async () => {
    await seedInboxWork()
    const closing = await advanceAuthorityTo('closure_requested')
    await createInboxOrganizationLifecycleContributor(db).prepareClosing(closing)

    const readiness = await advanceAuthorityTo('closing')
    const before = await contentSnapshot(ORG_ID)

    const result =
      await createInboxOrganizationLifecycleContributor(db).verifyPurgeReadiness(
        readiness,
      )

    expect(result.outcome).toBe('complete')
    expect(await contentSnapshot(ORG_ID)).toBe(before)
  })

  it('fails closed while a reminder slot is still schedulable', async () => {
    await seedInboxWork()
    const readiness = await advanceAuthorityTo('closing')

    await expect(
      createInboxOrganizationLifecycleContributor(db).verifyPurgeReadiness(readiness),
    ).rejects.toThrow('unfenced_response_target_reminders=1')
    // A blocked readiness records no receipt, so the coordinator cannot
    // mistake it for a phase that completed.
    const receipts = await pool.query(
      `SELECT 1 FROM organization_lifecycle_events
       WHERE organization_id = $1 AND context = 'inbox'
         AND kind LIKE 'organization_lifecycle_contribution:%'`,
      [ORG_ID],
    )
    expect(receipts.rowCount).toBe(0)
  })

  it('purges the whole handling record and leaves other tenants intact', async () => {
    await seedInboxWork()
    const otherBefore = await rowCounts(OTHER_ORG_ID)
    const request = await advanceAuthorityTo('purging')

    const result = await createInboxOrganizationLifecycleContributor(db).purge(request)

    expect(result.outcome).toBe('complete')
    const after = await rowCounts(ORG_ID)
    for (const table of INBOX_TABLES) {
      expect({ table, rows: after[table] }).toEqual({ table, rows: 0 })
    }
    expect(await rowCounts(OTHER_ORG_ID)).toEqual(otherBefore)
    // The content-free receipt is the evidence that survives the scrub.
    const receipts = await pool.query(
      `SELECT phase FROM organization_lifecycle_events
       WHERE organization_id = $1 AND context = 'inbox'
         AND kind LIKE 'organization_lifecycle_contribution:%'`,
      [ORG_ID],
    )
    expect(receipts.rows).toEqual([{ phase: 'purge' }])
  })

  it('re-runs the purge safely against an already scrubbed Organization', async () => {
    await seedInboxWork()
    const request = await advanceAuthorityTo('purging')
    await createInboxOrganizationLifecycleContributor(db).purge(request)

    // Forgetting the receipt forces the SQL to run a second time instead of
    // replaying the recorded outcome, which is what proves the statements
    // themselves converge on an already-scrubbed Organization.
    await forgetInboxReceipt()
    const result = await createInboxOrganizationLifecycleContributor(db).purge(request)

    // Nothing is left, so the honest answer is affirmative absence.
    expect(result.outcome).toBe('no_data')
    for (const table of INBOX_TABLES) {
      expect((await rowCounts(ORG_ID))[table]).toBe(0)
    }
  })

  it('answers no_data for an Organization that never used Inbox', async () => {
    const request = await advanceAuthorityTo('closure_requested')

    const result =
      await createInboxOrganizationLifecycleContributor(db).prepareClosing(request)

    expect(result.outcome).toBe('no_data')
    const receipts = await pool.query(
      `SELECT payload->>'outcome' AS outcome FROM organization_lifecycle_events
       WHERE organization_id = $1 AND context = 'inbox'
         AND kind LIKE 'organization_lifecycle_contribution:%'`,
      [ORG_ID],
    )
    // Affirmative absence, never an omitted contributor.
    expect(receipts.rows).toEqual([{ outcome: 'no_data' }])
  })
})
