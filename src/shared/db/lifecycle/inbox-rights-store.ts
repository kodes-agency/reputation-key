// SQL behind the Inbox rights executor (src/shared/ops/rights): the handling
// history and manager text an Organization holds in Inbox, and the closure
// purge. Every statement is scoped to one organization_id.
//
// Export is an explicit allowlist. Personal last-view watermarks, reminder
// schedule rows, the denormalized source copies on inbox_items (review and
// guest feedback text belong to their originating context) and command-revision
// fences are never selected.

import { sql, type SQL } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type { Tx } from '#/shared/outbox/commit'

export const INBOX_EXPORT_VERSION = 'inbox-rights-export/v1'

const UTC = 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'

/** `column` and `alias` come from literals in this file, never from input. */
function utc(column: string, alias = column.split('.').pop() as string): SQL {
  return sql`to_char(${sql.raw(column)} AT TIME ZONE 'UTC', ${UTC}) AS ${sql.raw(alias)}`
}

export const INBOX_EXCLUDED_RECORD_CLASSES = Object.freeze([
  { recordClass: 'inbox_personal_last_view_state', reasonCode: 'personal_read_state' },
  {
    recordClass: 'inbox_response_target_reminder_schedule',
    reasonCode: 'content_free_control_plane',
  },
  {
    recordClass: 'inbox_denormalized_source_content_copies',
    reasonCode: 'source_content_owned_by_originating_context',
  },
  {
    recordClass: 'inbox_transient_projection_fences',
    reasonCode: 'content_free_control_plane',
  },
])

type Row = Readonly<Record<string, unknown>>

const REPORT_TABLES = Object.freeze([
  'inbox_items',
  'inbox_handling_cycles',
  'inbox_notes',
  'inbox_response_target_organization_policies',
  'inbox_private_feedback_target_property_overrides',
  'inbox_user_views',
] as const)

function toCount(row: Row | undefined, field: string): number {
  const value = Number(row?.[field])
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Inbox rights count is unavailable: ${field}`)
  }
  return value
}

async function organizationExists(tx: Tx, organizationId: string): Promise<boolean> {
  const result = await tx.execute(
    sql`SELECT 1 AS present FROM organization WHERE id = ${organizationId}`,
  )
  return result.rows.length > 0
}

/** Counts only. */
export async function readInboxRightsReport(
  db: Database,
  organizationId: string,
): Promise<ReadonlyArray<string>> {
  return db.transaction(
    async (tx) => {
      if (!(await organizationExists(tx, organizationId))) {
        return ['organization not found']
      }
      const held: string[] = []
      for (const table of REPORT_TABLES) {
        const result = await tx.execute(
          sql`SELECT count(*)::int AS held FROM ${sql.identifier(table)}
              WHERE organization_id = ${organizationId}`,
        )
        held.push(`${table}=${toCount(result.rows[0] as Row | undefined, 'held')}`)
      }
      const reminders = await tx.execute(
        sql`SELECT count(*)::int AS held FROM inbox_response_target_reminders
            WHERE organization_id = ${organizationId}
              AND delivered_at IS NULL AND cancelled_at IS NULL`,
      )
      return [
        held.join(' '),
        `schedulable reminders: ${toCount(reminders.rows[0] as Row | undefined, 'held')}`,
      ]
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  )
}

export async function readInboxRightsExport(db: Database, organizationId: string) {
  return db.transaction(
    async (tx) => {
      const rows = async (query: SQL) => (await tx.execute(query)).rows as Row[]
      return {
        version: INBOX_EXPORT_VERSION,
        organizationId,
        items: await rows(sql`
          SELECT id, property_id, source_type, source_id, status, is_escalated,
            ${utc('escalated_at')}, escalated_by,
            ${utc('escalation_resolved_at')}, escalation_resolved_by,
            ${utc('source_date')}, platform, assigned_to, ${utc('closed_at')},
            ${utc('first_reply_submitted_at')}, ${utc('first_reply_published_at')},
            ${utc('created_at')}, ${utc('updated_at')}, manager_priority,
            manager_priority_set_by, ${utc('manager_priority_set_at')}
          FROM inbox_items
          WHERE organization_id = ${organizationId}
          ORDER BY id`),
        handlingCycleHeads: await rows(sql`
          SELECT inbox_item_id, property_id, source_type, current_cycle_number,
            current_source_revision, status, ${utc('created_at')}, ${utc('updated_at')}
          FROM inbox_handling_cycle_heads
          WHERE organization_id = ${organizationId}
          ORDER BY inbox_item_id`),
        handlingCycles: await rows(sql`
          SELECT inbox_item_id, cycle_number, property_id, source_type, source_revision,
            opened_reason, manual_reopen_reason, manual_reopen_explanation,
            supersedes_cycle_number, opened_by, ${utc('opened_at')}
          FROM inbox_handling_cycles
          WHERE organization_id = ${organizationId}
          ORDER BY inbox_item_id, cycle_number`),
        handlingCycleTransitions: await rows(sql`
          SELECT inbox_item_id, state_revision, cycle_number, property_id, source_type,
            kind, transition_reason, actor_type, actor_user_id,
            ${utc('transitioned_at')}
          FROM inbox_handling_cycle_transitions
          WHERE organization_id = ${organizationId}
          ORDER BY inbox_item_id, state_revision`),
        responseTargets: await rows(sql`
          SELECT target.inbox_item_id, target.cycle_number, target.property_id,
            target.target_kind, target.performance_eligibility, target.duration_minutes,
            target.policy_source, target.policy_version, ${utc('target.start_at')},
            ${utc('target.due_at')}, ${utc('target.completion_at')}, target.result,
            target.stop_reason,
            (SELECT exclusion.reason FROM inbox_response_target_exclusions AS exclusion
              WHERE exclusion.inbox_item_id = target.inbox_item_id
                AND exclusion.cycle_number = target.cycle_number
                AND exclusion.organization_id = ${organizationId}) AS excluded_reason
          FROM inbox_handling_cycle_response_targets AS target
          WHERE target.organization_id = ${organizationId}
          ORDER BY target.inbox_item_id, target.cycle_number`),
        assignmentHistory: await rows(sql`
          SELECT inbox_item_id, resulting_command_revision, property_id,
            handling_cycle_number, previous_assignee, next_assignee, reason,
            actor_user_id, bulk_id, ${utc('occurred_at')}
          FROM inbox_assignment_history
          WHERE organization_id = ${organizationId}
          ORDER BY inbox_item_id, resulting_command_revision`),
        escalationHistory: await rows(sql`
          SELECT inbox_item_id, resulting_command_revision, property_id,
            handling_cycle_number, kind, actor_user_id, ${utc('occurred_at')}
          FROM inbox_escalation_history
          WHERE organization_id = ${organizationId}
          ORDER BY inbox_item_id, resulting_command_revision`),
        priorityHistory: await rows(sql`
          SELECT inbox_item_id, resulting_command_revision, property_id,
            handling_cycle_number, priority, previous_priority, actor_user_id,
            ${utc('occurred_at')}
          FROM inbox_priority_history
          WHERE organization_id = ${organizationId}
          ORDER BY inbox_item_id, resulting_command_revision`),
        feedbackHandlingOutcomes: await rows(sql`
          SELECT id, inbox_item_id, cycle_number, outcome_revision, property_id, outcome,
            internal_note, recorded_by, ${utc('recorded_at')}, ${utc('completion_at')},
            deadline_result, supersedes_outcome_id
          FROM inbox_feedback_handling_outcomes
          WHERE organization_id = ${organizationId}
          ORDER BY inbox_item_id, cycle_number, outcome_revision`),
        responseTargetOrganizationPolicies: await rows(sql`
          SELECT target_kind, duration_minutes, policy_version, updated_by,
            ${utc('created_at')}, ${utc('updated_at')}
          FROM inbox_response_target_organization_policies
          WHERE organization_id = ${organizationId}
          ORDER BY target_kind COLLATE "C"`),
        privateFeedbackTargetPropertyOverrides: await rows(sql`
          SELECT property_id, enabled, duration_minutes, policy_version, updated_by,
            ${utc('created_at')}, ${utc('updated_at')}
          FROM inbox_private_feedback_target_property_overrides
          WHERE organization_id = ${organizationId}
          ORDER BY property_id`),
        notes: await rows(sql`
          SELECT id, inbox_item_id, author_user_id, text, ${utc('created_at')}
          FROM inbox_notes
          WHERE organization_id = ${organizationId}
          ORDER BY id`),
        excludedRecordClasses: INBOX_EXCLUDED_RECORD_CLASSES,
      }
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  )
}

export type InboxClosureOutcome =
  Readonly<{ ok: true; deleted: number }> | Readonly<{ ok: false; error: string }>

async function affected(tx: Tx, statement: SQL): Promise<number> {
  return (await tx.execute(statement)).rowCount ?? 0
}

/** The reason a closure would be refused, or null. Writes nothing. */
export async function inboxClosureRefusal(
  db: Database,
  organizationId: string,
): Promise<string | null> {
  return db.transaction(
    async (tx) =>
      (await organizationExists(tx, organizationId)) ? null : 'organization not found',
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  )
}

/**
 * Cancels schedulable reminders, then deletes the Organization's items and the
 * rows that are not children of an item. Handling history, cycles, targets,
 * reminders, exclusions, notes and outcomes go with their item through
 * ON DELETE CASCADE, the only delete their immutability triggers accept.
 * Runs inside the caller's transaction.
 */
export async function closeInboxInTx(
  tx: Tx,
  organizationId: string,
  now: Date,
): Promise<InboxClosureOutcome> {
  if (!(await organizationExists(tx, organizationId))) {
    return { ok: false, error: 'organization not found' }
  }
  await affected(
    tx,
    sql`UPDATE inbox_response_target_reminders
        SET cancelled_at = ${now}, updated_at = GREATEST(updated_at, ${now}::timestamptz)
        WHERE organization_id = ${organizationId}
          AND delivered_at IS NULL AND cancelled_at IS NULL`,
  )
  let deleted = 0
  for (const table of [
    'inbox_items',
    'inbox_response_target_organization_policies',
    'inbox_private_feedback_target_property_overrides',
    'inbox_user_views',
  ] as const) {
    deleted += await affected(
      tx,
      sql`DELETE FROM ${sql.identifier(table)} WHERE organization_id = ${organizationId}`,
    )
  }
  return { ok: true, deleted }
}

export async function closeInbox(
  db: Database,
  organizationId: string,
  now: Date,
): Promise<InboxClosureOutcome> {
  return db.transaction((tx) => closeInboxInTx(tx, organizationId, now))
}
