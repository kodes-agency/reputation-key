// Guest context — Drizzle schema for scan_events, ratings, feedback tables
// Per architecture: schemas live in shared/db/schema/ because Drizzle needs a single barrel.
// snake_case columns, camelCase field names.

import { sql } from 'drizzle-orm'
import {
  pgTable,
  uuid,
  varchar,
  integer,
  text,
  boolean,
  timestamp,
  uniqueIndex,
  index,
  foreignKey,
  check,
} from 'drizzle-orm/pg-core'
import { portals } from './portal.schema'
import { createdAtColumn, updatedAtColumn, deletedAtColumn } from '../columns'

export const scanEvents = pgTable(
  'scan_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    portalId: uuid('portal_id')
      .notNull()
      .references(() => portals.id, { onDelete: 'restrict' }),
    propertyId: varchar('property_id', { length: 255 }).notNull(),
    source: varchar('source', { length: 10 }).notNull(),
    sessionId: varchar('session_id', { length: 255 }).notNull(),
    ipHash: text('ip_hash').notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => ({
    sessionIdx: index('scan_events_session_idx').on(t.sessionId),
    portalIdx: index('scan_events_portal_idx').on(t.portalId),
  }),
)

export const ratings = pgTable(
  'ratings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    portalId: uuid('portal_id')
      .notNull()
      .references(() => portals.id, { onDelete: 'restrict' }),
    propertyId: varchar('property_id', { length: 255 }).notNull(),
    sessionId: varchar('session_id', { length: 255 }).notNull(),
    value: integer('value').notNull(),
    source: varchar('source', { length: 10 }).notNull(),
    ipHash: text('ip_hash').notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => ({
    uniqueSessionPortal: uniqueIndex('ratings_session_portal_unique').on(
      t.sessionId,
      t.portalId,
    ),
    portalIdx: index('ratings_portal_idx').on(t.portalId),
  }),
)

export const feedback = pgTable(
  'feedback',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    portalId: uuid('portal_id')
      .notNull()
      .references(() => portals.id, { onDelete: 'restrict' }),
    propertyId: varchar('property_id', { length: 255 }).notNull(),
    sessionId: varchar('session_id', { length: 255 }).notNull(),
    ratingId: uuid('rating_id').references(() => ratings.id, { onDelete: 'set null' }),
    comment: text('comment').notNull(),
    source: varchar('source', { length: 10 }).notNull(),
    ipHash: text('ip_hash').notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => ({
    // F162: Unique constraint prevents duplicate feedback from same session+portal
    sessionPortalUnique: uniqueIndex('feedback_session_portal_unique').on(
      t.sessionId,
      t.portalId,
    ),
    portalIdx: index('feedback_portal_idx').on(t.portalId),
  }),
)

/**
 * Canonical guest response aggregate. The legacy ratings/feedback tables remain
 * read-only migration sources; new public writes target this table.
 */
export const guestResponses = pgTable(
  'guest_responses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    portalId: uuid('portal_id').notNull(),
    sessionId: uuid('session_id').notNull(),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    rating: integer('rating'),
    categoryId: uuid('category_id'),
    responseText: text('response_text'),
    responseConsent: boolean('response_consent').notNull().default(false),
    textConsent: boolean('text_consent').notNull().default(false),
    mediaConsent: boolean('media_consent').notNull().default(false),
    correctionCount: integer('correction_count').notNull().default(0),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    correctedAt: timestamp('corrected_at', { withTimezone: true }),
    moderatedAt: timestamp('moderated_at', { withTimezone: true }),
    retentionDeadline: timestamp('retention_deadline', { withTimezone: true }).notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    deletedAt: deletedAtColumn(),
  },
  (t) => ({
    orgIdKey: uniqueIndex('guest_responses_org_id_key').on(t.organizationId, t.id),
    scopeIdKey: uniqueIndex('guest_responses_scope_id_key').on(
      t.organizationId,
      t.propertyId,
      t.portalId,
      t.id,
    ),
    sessionPortalUnique: uniqueIndex('guest_responses_session_portal_unique').on(
      t.organizationId,
      t.portalId,
      t.sessionId,
    ),
    portalStatusIdx: index('guest_responses_portal_status_idx').on(
      t.organizationId,
      t.propertyId,
      t.portalId,
      t.status,
    ),
    portalTenantFk: foreignKey({
      name: 'guest_responses_portal_tenant_fk',
      columns: [t.organizationId, t.portalId],
      foreignColumns: [portals.organizationId, portals.id],
    }).onDelete('restrict'),
    portalPropertyTenantFk: foreignKey({
      name: 'guest_responses_portal_property_tenant_fk',
      columns: [t.organizationId, t.propertyId, t.portalId],
      foreignColumns: [portals.organizationId, portals.propertyId, portals.id],
    }).onDelete('restrict'),
    statusCheck: check(
      'guest_responses_status_valid',
      sql`${t.status} IN ('pending', 'submitted', 'corrected', 'moderated', 'deleted', 'expired')`,
    ),
    ratingCheck: check(
      'guest_responses_rating_valid',
      sql`${t.rating} IS NULL OR (${t.rating} >= 1 AND ${t.rating} <= 5)`,
    ),
    correctionCheck: check(
      'guest_responses_correction_count_valid',
      sql`${t.correctionCount} >= 0 AND ${t.correctionCount} <= 1`,
    ),
  }),
)

/**
 * One durable row per media upload issuance. State transitions use a processing
 * lease so withdrawal/moderation deletion wins races with object confirmation.
 */
export const guestResponseMedia = pgTable(
  'guest_response_media',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    portalId: uuid('portal_id').notNull(),
    responseId: uuid('response_id').notNull(),
    sessionId: uuid('session_id').notNull(),
    objectKey: varchar('object_key', { length: 700 }).notNull(),
    contentType: varchar('content_type', { length: 40 }).notNull(),
    declaredSizeBytes: integer('declared_size_bytes').notNull(),
    status: varchar('status', { length: 24 }).notNull().default('issued'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    processingLease: uuid('processing_lease'),
    processingStartedAt: timestamp('processing_started_at', { withTimezone: true }),
    publicUrl: varchar('public_url', { length: 1000 }),
    readyAt: timestamp('ready_at', { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    deletedAt: deletedAtColumn(),
  },
  (t) => ({
    objectKeyUnique: uniqueIndex('guest_response_media_object_key_unique').on(
      t.objectKey,
    ),
    responseStatusIdx: index('guest_response_media_response_status_idx').on(
      t.organizationId,
      t.responseId,
      t.status,
    ),
    responseTenantFk: foreignKey({
      name: 'guest_response_media_response_tenant_fk',
      columns: [t.organizationId, t.responseId],
      foreignColumns: [guestResponses.organizationId, guestResponses.id],
    }).onDelete('restrict'),
    responsePropertyTenantFk: foreignKey({
      name: 'guest_response_media_response_property_tenant_fk',
      columns: [t.organizationId, t.propertyId, t.portalId, t.responseId],
      foreignColumns: [
        guestResponses.organizationId,
        guestResponses.propertyId,
        guestResponses.portalId,
        guestResponses.id,
      ],
    }).onDelete('restrict'),
    portalTenantFk: foreignKey({
      name: 'guest_response_media_portal_tenant_fk',
      columns: [t.organizationId, t.portalId],
      foreignColumns: [portals.organizationId, portals.id],
    }).onDelete('restrict'),
    portalPropertyTenantFk: foreignKey({
      name: 'guest_response_media_portal_property_tenant_fk',
      columns: [t.organizationId, t.propertyId, t.portalId],
      foreignColumns: [portals.organizationId, portals.propertyId, portals.id],
    }).onDelete('restrict'),
    statusCheck: check(
      'guest_response_media_status_valid',
      sql`${t.status} IN ('issued', 'processing', 'ready', 'purge_pending', 'deleted', 'quarantined', 'expired')`,
    ),
    sizeCheck: check(
      'guest_response_media_size_valid',
      sql`${t.declaredSizeBytes} > 0 AND ${t.declaredSizeBytes} <= 10485760`,
    ),
  }),
)
