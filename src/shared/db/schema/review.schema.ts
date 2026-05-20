// Review context — Drizzle schema for reviews & replies tables

import { createdAtColumn, updatedAtColumn } from '../columns'
import {
  pgTable,
  uuid,
  varchar,
  integer,
  real,
  text,
  timestamp,
  pgEnum,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core'
import { properties } from './property.schema'
import { googleConnections } from './google-connection.schema'

export const reviewPlatformEnum = pgEnum('review_platform', ['google'])

export const replyStatusEnum = pgEnum('reply_status', [
  'draft',
  'pending_approval',
  'approved',
  'published',
  'rejected',
])

export const replySourceEnum = pgEnum('reply_source', ['google_sync', 'internal'])

export const reviews = pgTable(
  'reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    platform: reviewPlatformEnum('platform').notNull(),
    externalId: varchar('external_id', { length: 500 }).notNull(),
    externalLocationId: varchar('external_location_id', { length: 500 }).notNull(),
    googleConnectionId: uuid('google_connection_id').references(
      () => googleConnections.id,
    ),
    reviewerName: varchar('reviewer_name', { length: 255 }),
    reviewerProfilePhotoUrl: varchar('reviewer_profile_photo_url', { length: 1000 }),
    rating: integer('rating').notNull(),
    text: text('text'),
    languageCode: varchar('language_code', { length: 10 }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    sentimentLabel: varchar('sentiment_label', { length: 20 }),
    sentimentScore: real('sentiment_score'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex('reviews_platform_external_unique').on(
      t.platform,
      t.externalId,
      t.organizationId,
    ),
    index('reviews_property_idx').on(t.propertyId),
    index('reviews_org_idx').on(t.organizationId),
    index('reviews_expires_idx').on(t.expiresAt),
  ],
)

export const replies = pgTable(
  'replies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reviewId: uuid('review_id')
      .notNull()
      .references(() => reviews.id, { onDelete: 'cascade' }),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    text: text('text').notNull(),
    status: replyStatusEnum('status').notNull(),
    source: replySourceEnum('source').notNull(),
    createdBy: varchar('created_by', { length: 255 }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  // TODO(Phase 12): Add partial unique index so only one published reply per review:
  //   CREATE UNIQUE INDEX replies_one_published_per_review ON replies (review_id) WHERE status = 'published'
  //   Drizzle partial unique index support tracked in Phase 12.
  (t) => [
    uniqueIndex('replies_review_source_unique').on(
      t.reviewId,
      t.source,
      t.organizationId,
    ),
    index('replies_review_idx').on(t.reviewId),
    index('replies_org_idx').on(t.organizationId),
  ],
)
