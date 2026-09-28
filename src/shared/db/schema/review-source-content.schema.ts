// Review context — the erasable provider-content cache, kept apart from the
// Review identities in ./review.schema.ts.
//
// This is the one Review table whose rows are guest content that expiry,
// provider deletion and erasure remove (data fate `erasable_source_content`);
// every table in ./review.schema.ts is an identity or history that outlives it.

import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { createdAtColumn, updatedAtColumn } from '../columns'
import { googleConnections } from './google-connection.schema'
import { reviewPlatformEnum, reviews } from './review.schema'

/**
 * The independently erasable provider-content cache for a stable Review.
 *
 * During the REV-01 expand phase writers dual-write this row and the nullable
 * compatibility columns on `reviews`. Readers remain on the compatibility
 * columns until shadow parity is sealed. Expiry/provider deletion removes this
 * row and scrubs those columns atomically; the Review, RepKey Reply, Inbox, and
 * audit identities remain.
 */
export const reviewSourceContents = pgTable(
  'review_source_contents',
  {
    reviewId: uuid('review_id').primaryKey(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    platform: reviewPlatformEnum('platform').notNull(),
    externalId: varchar('external_id', { length: 500 }).notNull(),
    externalLocationId: varchar('external_location_id', { length: 500 }).notNull(),
    googleConnectionId: uuid('google_connection_id').references(
      () => googleConnections.id,
      { onDelete: 'set null' },
    ),
    reviewerName: varchar('reviewer_name', { length: 255 }),
    reviewerProfilePhotoUrl: varchar('reviewer_profile_photo_url', { length: 1000 }),
    rating: integer('rating').notNull(),
    text: text('text'),
    translatedText: text('translated_text'),
    languageCode: varchar('language_code', { length: 10 }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }).notNull(),
    sourceCreatedAt: timestamp('source_created_at', { withTimezone: true }),
    sourceUpdatedAt: timestamp('source_updated_at', { withTimezone: true }),
    firstFetchedAt: timestamp('first_fetched_at', { withTimezone: true }),
    lastFetchedAt: timestamp('last_fetched_at', { withTimezone: true }).notNull(),
    contentExpiresAt: timestamp('content_expires_at', { withTimezone: true }).notNull(),
    contentHash: text('content_hash'),
    sourceEpoch: integer('source_epoch').notNull(),
    sourceRevision: bigint('source_revision', { mode: 'number' }).notNull(),
    aiSourceByteLength: integer('ai_source_byte_length').notNull(),
    aiSourceDigest: varchar('ai_source_digest', { length: 64 }).notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    foreignKey({
      name: 'review_source_contents_review_tenant_fk',
      columns: [t.organizationId, t.propertyId, t.reviewId],
      foreignColumns: [reviews.organizationId, reviews.propertyId, reviews.id],
    }).onDelete('cascade'),
    uniqueIndex('review_source_contents_provider_identity_unique').on(
      t.platform,
      t.externalId,
      t.organizationId,
    ),
    index('review_source_contents_expiry_idx').on(t.contentExpiresAt, t.reviewId),
    index('review_source_contents_connection_idx').on(t.googleConnectionId),
    check('review_source_contents_rating_valid', sql`${t.rating} BETWEEN 1 AND 5`),
    check(
      'review_source_contents_epoch_revision_safe',
      sql`${t.sourceEpoch} BETWEEN 0 AND 2147483647
        AND ${t.sourceRevision} BETWEEN 0 AND '9007199254740991'::bigint`,
    ),
    check(
      'review_source_contents_ai_source_valid',
      sql`${t.aiSourceByteLength} BETWEEN 1 AND '4294967295'::bigint
        AND ${t.aiSourceDigest} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
)
