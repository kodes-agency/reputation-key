// Review context — the verified reputation facts a completed Google provider
// snapshot writes, kept apart from the Review identities in ./review.schema.ts.
//
// A fact names a Property, a source epoch and Google's own count and average,
// and nothing else: no Review ID, provider identifier, reviewer, rating
// distribution or text (Review CONTEXT, invariant 12). Moved here unchanged
// from ./review.schema.ts on 2026-10-17.

import { sql } from 'drizzle-orm'
import {
  boolean,
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
    /**
     * Whether the fact proves a completed listing. Every completed provider
     * snapshot run writes true; a head check that stores (migration 0067) writes
     * false: Google's own count and average from one read of its newest page.
     * Readers that mean "a completed reconciliation / the history was listed"
     * filter on it.
     */
    listingComplete: boolean('listing_complete').notNull().default(true),
    /**
     * When Google's count and average were read: the run's start for a snapshot
     * (when it froze them), the read itself for a head fact. Null only on a row
     * an older process wrote; readers of Google's numbers order by
     * COALESCE(numbers_observed_at, evaluated_at).
     */
    numbersObservedAt: timestamp('numbers_observed_at', { withTimezone: true }),
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
    // The readers of Google's numbers (Goals' shown-number history, the head
    // check's newest-fact probe) order and range by when the numbers were READ,
    // so they walk this one rather than the scope index above.
    index('review_google_reputation_snapshot_observed_idx').on(
      t.organizationId,
      t.propertyId,
      t.sourceEpoch,
      sql`COALESCE(${t.numbersObservedAt}, ${t.evaluatedAt}) DESC`,
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
