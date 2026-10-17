// Review context — the verified reputation facts a completed Google provider
// snapshot writes, kept apart from the Review identities in ./review.schema.ts.
//
// A fact names a Property, a source epoch and Google's own count and average,
// and nothing else: no Review ID, provider identifier, reviewer, rating
// distribution or text (Review CONTEXT, invariant 12). Moved here unchanged
// from ./review.schema.ts on 2026-10-17.

import { sql } from 'drizzle-orm'
import {
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { createdAtColumn } from '../columns'
import { properties } from './property.schema'

/** Append-only, content-minimal proof emitted only when one Google provider
 * snapshot has completed both scans and its bounded deletion reconciliation. */
export const reviewGoogleReputationSnapshotFacts = pgTable(
  'review_google_reputation_snapshot_facts',
  {
    runId: uuid('run_id').primaryKey(),
    eventId: uuid('event_id').notNull(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    sourceEpoch: integer('source_epoch').notNull(),
    reviewCount: integer('review_count').notNull(),
    averageRating: doublePrecision('average_rating'),
    evaluatedAt: timestamp('evaluated_at', { withTimezone: true }).notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex('review_google_reputation_snapshot_event_unique').on(t.eventId),
    index('review_google_reputation_snapshot_scope_idx').on(
      t.organizationId,
      t.propertyId,
      t.sourceEpoch,
      t.evaluatedAt.desc(),
    ),
    foreignKey({
      name: 'review_google_reputation_snapshot_property_tenant_fk',
      columns: [t.organizationId, t.propertyId],
      foreignColumns: [properties.organizationId, properties.id],
    }).onDelete('cascade'),
    check(
      'review_google_reputation_snapshot_source_epoch_valid',
      sql`${t.sourceEpoch} BETWEEN 0 AND 2147483647`,
    ),
    check(
      'review_google_reputation_snapshot_value_valid',
      sql`(${t.reviewCount} = 0 AND ${t.averageRating} IS NULL)
        OR (${t.reviewCount} BETWEEN 1 AND 10000
          AND ${t.averageRating} BETWEEN 0 AND 5)`,
    ),
  ],
)
