// Inbox triage decisions: who escalated an item, and who set its priority.
// Both are append-only logs keyed by the item command revision they produced.
// `inboxEscalationHistory` moved here unchanged from inbox.schema.ts when
// `inboxPriorityHistory` arrived (migration 0077, ADR 0071), so that file stays
// within its length ratchet. This file imports `inbox_items` and the priority
// enum from it; nothing points back, so there is no cycle.

import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  index,
  pgTable,
  primaryKey,
  timestamp,
  uuid,
  varchar,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'
import { createdAtColumn } from '../columns'
import { inboxItems, inboxPriorityLevelEnum } from './inbox.schema'

/**
 * The key every triage decision log shares: the item, the item command revision
 * the decision produced (the row's identity), the tenant and Property it was
 * made in, and the Handling Cycle it landed in. A function, so each table gets
 * builders of its own.
 */
const triageDecisionKey = () => ({
  inboxItemId: uuid('inbox_item_id')
    .notNull()
    .references(() => inboxItems.id, { onDelete: 'cascade' }),
  resultingCommandRevision: bigint('resulting_command_revision', {
    mode: 'number',
  }).notNull(),
  organizationId: varchar('organization_id', { length: 255 }).notNull(),
  propertyId: varchar('property_id', { length: 255 }).notNull(),
  handlingCycleNumber: bigint('handling_cycle_number', { mode: 'number' }),
})

/** A decision is the command after the item's first revision, in a real cycle. */
const revisionSafe = (
  revision: AnyPgColumn,
  cycle: AnyPgColumn,
) => sql`${revision} BETWEEN 2 AND '9007199254740991'::bigint
        AND (${cycle} IS NULL OR ${cycle} BETWEEN 1 AND '9007199254740991'::bigint)`

/**
 * Append-only escalation decisions (IBX-01).
 *
 * `inboxItems` keeps only the latest escalation flags, which cannot answer
 * "who escalated this, when, and how often". Like `inboxAssignmentHistory`,
 * the resulting item command revision is the history identity, so a row here
 * always names the exact command that committed the flag change.
 *
 * Per ADR 0055 escalation is orthogonal to status: this table intentionally
 * holds no status, no assignee and no permission, and writing to it neither
 * grants access nor moves an item between open and closed.
 *
 * `handlingCycleNumber` is nullable for the same expand-period reason as
 * assignment history: legacy items whose Handling Cycle head is still awaiting
 * repair must still be able to append their escalation fact.
 */
export const inboxEscalationHistory = pgTable(
  'inbox_escalation_history',
  {
    ...triageDecisionKey(),
    kind: varchar('kind', { length: 16 }).notNull(),
    actorUserId: varchar('actor_user_id', { length: 255 }),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [
    primaryKey({
      name: 'inbox_escalation_history_pk',
      columns: [t.inboxItemId, t.resultingCommandRevision],
    }),
    index('inbox_escalation_history_scope_idx').on(
      t.organizationId,
      t.propertyId,
      t.occurredAt,
      t.inboxItemId,
    ),
    index('inbox_escalation_history_item_idx').on(t.inboxItemId, t.occurredAt),
    check(
      'inbox_escalation_history_revision_safe',
      revisionSafe(t.resultingCommandRevision, t.handlingCycleNumber),
    ),
    check(
      'inbox_escalation_history_kind_valid',
      sql`${t.kind} IN ('escalated', 'resolved')`,
    ),
  ],
)

/**
 * Append-only manager priority decisions (ADR 0071, migration 0077).
 *
 * `inboxItems.managerPriority` keeps only the level in force; this table says
 * who chose each level and when. A row is a person's decision and nothing
 * else: `actorUserId` is NOT NULL because only a signed-in manager's command
 * writes here, `priority` NULL is a reset ("Back to suggestion" or "Remove
 * priority"), and a repeat of the level already set writes no row
 * (`inbox_priority_history_changes_priority`).
 *
 * It deliberately holds no AI level, no "matched the suggestion" flag and no
 * free text: the suggestion stays the AI context's own, live and erasable
 * (ADR 0031), and the history is never described as audit-grade (ADR 0056).
 * Rows go with their item (ON DELETE CASCADE).
 */
export const inboxPriorityHistory = pgTable(
  'inbox_priority_history',
  {
    ...triageDecisionKey(),
    priority: inboxPriorityLevelEnum('priority'),
    previousPriority: inboxPriorityLevelEnum('previous_priority'),
    actorUserId: varchar('actor_user_id', { length: 255 }).notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [
    primaryKey({
      name: 'inbox_priority_history_pk',
      columns: [t.inboxItemId, t.resultingCommandRevision],
    }),
    index('inbox_priority_history_scope_idx').on(
      t.organizationId,
      t.propertyId,
      t.occurredAt,
      t.inboxItemId,
    ),
    index('inbox_priority_history_item_idx').on(t.inboxItemId, t.occurredAt),
    check(
      'inbox_priority_history_revision_safe',
      revisionSafe(t.resultingCommandRevision, t.handlingCycleNumber),
    ),
    check(
      'inbox_priority_history_changes_priority',
      sql`${t.priority} IS DISTINCT FROM ${t.previousPriority}`,
    ),
  ],
)
