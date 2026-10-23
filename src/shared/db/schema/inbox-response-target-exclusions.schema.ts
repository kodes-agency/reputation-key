// Response Targets that must not count (migration 0070). Model for
// inbox_response_target_exclusions.

import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  foreignKey,
  pgTable,
  primaryKey,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { inboxHandlingCycleResponseTargets } from './inbox.schema'

/** Why a Response Target is left out of reporting, reminders and waiting time. */
export const RESPONSE_TARGET_EXCLUSION_REASONS = ['provider_restatement'] as const

export type ResponseTargetExclusionReason =
  (typeof RESPONSE_TARGET_EXCLUSION_REASONS)[number]

/**
 * One Handling Cycle whose Response Target is excluded from every count. The
 * target, the cycle and the transitions around it are immutable history
 * (ADR 0055; a database trigger refuses any rewrite of a completed target), so
 * an exclusion is a separate append-only fact beside the target, never an
 * edit of it.
 *
 * Written only by `pnpm ops inbox exclude-restated-revision-targets`, for a
 * cycle whose Material Review Revision Google only restated (its `updateTime`
 * never moved), so no guest edit opened the cycle and its clock measures
 * nothing. The target keeps working: a later real reply still closes the cycle
 * and the item; the completion is simply not counted.
 *
 * The scope foreign key points at the target, so the row lives and dies with
 * it (an Organization purge deletes items, and the cascade reaches this table).
 * The trigger `inbox_response_target_exclusions_append_only_guard` refuses
 * UPDATE, and DELETE unless it is that cascade. Content-free: ids, an enum, the
 * operator, an optional ticket and an instant.
 */
export const inboxResponseTargetExclusions = pgTable(
  'inbox_response_target_exclusions',
  {
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    inboxItemId: uuid('inbox_item_id').notNull(),
    cycleNumber: bigint('cycle_number', { mode: 'number' }).notNull(),
    targetKind: varchar('target_kind', { length: 48 }).notNull(),
    reason: varchar('reason', { length: 32 }).notNull(),
    correlationId: uuid('correlation_id').notNull(),
    operatorId: varchar('operator_id', { length: 255 }).notNull(),
    ticket: varchar('ticket', { length: 200 }),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({
      name: 'inbox_response_target_exclusions_pk',
      columns: [t.inboxItemId, t.cycleNumber],
    }),
    foreignKey({
      name: 'inbox_response_target_exclusions_target_scope_fk',
      columns: [
        t.inboxItemId,
        t.cycleNumber,
        t.organizationId,
        t.propertyId,
        t.targetKind,
      ],
      foreignColumns: [
        inboxHandlingCycleResponseTargets.inboxItemId,
        inboxHandlingCycleResponseTargets.cycleNumber,
        inboxHandlingCycleResponseTargets.organizationId,
        inboxHandlingCycleResponseTargets.propertyId,
        inboxHandlingCycleResponseTargets.targetKind,
      ],
    }).onDelete('cascade'),
    // PostgreSQL stores a one-value IN as an equality, so the reason is written
    // as one. A second reason turns both lines into an IN list and a pairing
    // with the kinds it applies to.
    check(
      'inbox_response_target_exclusions_values_valid',
      sql`${t.cycleNumber} BETWEEN 1 AND '9007199254740991'::bigint
        AND ${t.reason} = 'provider_restatement'
        AND ${t.targetKind} = 'google_review_response'
        AND char_length(btrim(${t.operatorId})) BETWEEN 1 AND 255
        AND (${t.ticket} IS NULL OR char_length(btrim(${t.ticket})) BETWEEN 1 AND 200)`,
    ),
  ],
)
