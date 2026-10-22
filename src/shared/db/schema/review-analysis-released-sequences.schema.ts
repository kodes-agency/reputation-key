// Review AI-analysis sequences that were allocated and then given back
// (migration 0068). Model for review_ai_analysis_released_sequences.

import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  foreignKey,
  integer,
  primaryKey,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { properties } from './property.schema'

/** Why an allocated analysis sequence was given back. */
export const RELEASED_SEQUENCE_REASONS = [
  'replayed_observation',
  'out_of_order_observation',
  'operator_repair',
] as const

export type ReleasedSequenceReason = (typeof RELEASED_SEQUENCE_REASONS)[number]

/**
 * An analysis sequence that `lock_review_ai_analysis_head_v1` handed out and
 * that no Review will ever hold or announce: the observation it was allocated
 * for turned out to be a replay or an older version of what is stored, so the
 * transaction committed with the head one higher and no event. Coverage counts
 * `head_sequence - analysis_start_sequence` sequences as owed a settlement;
 * every row here is one of them that is not owed, so it is subtracted.
 *
 * Content-free: ids, two integers, an enum and an instant. Kept with
 * `review_ai_analysis_heads` (same lifetime, same tenant FK, cascade with the
 * Property; the Review Organization purge deletes it explicitly); never exported.
 */
export const reviewAiAnalysisReleasedSequences = pgTable(
  'review_ai_analysis_released_sequences',
  {
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    sourceEpoch: integer('source_epoch').notNull(),
    analysisSequence: bigint('analysis_sequence', { mode: 'number' }).notNull(),
    reason: varchar('reason', { length: 32 }).notNull(),
    releasedAt: timestamp('released_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({
      name: 'review_ai_analysis_released_sequences_pk',
      columns: [t.organizationId, t.propertyId, t.sourceEpoch, t.analysisSequence],
    }),
    foreignKey({
      name: 'review_ai_analysis_released_sequences_property_tenant_fk',
      columns: [t.organizationId, t.propertyId],
      foreignColumns: [properties.organizationId, properties.id],
    }).onDelete('cascade'),
    check(
      'review_ai_analysis_released_sequences_source_epoch_safe',
      sql`${t.sourceEpoch} BETWEEN 0 AND 2147483647`,
    ),
    check(
      'review_ai_analysis_released_sequences_sequence_safe',
      sql`${t.analysisSequence} BETWEEN 1 AND '9007199254740991'::bigint`,
    ),
    check(
      'review_ai_analysis_released_sequences_reason_valid',
      sql`${t.reason} IN ('replayed_observation', 'out_of_order_observation', 'operator_repair')`,
    ),
  ],
)
