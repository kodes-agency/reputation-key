// Notification context — Drizzle schemas
// Per architecture: schemas live in shared/db/schema/ because Drizzle needs a single barrel.
// snake_case columns, camelCase field names.
//
// Two tables per ADR 0011 and grilling decisions (Q10):
// - notifications: in-app notification records (unread/read/dismissed)
// - notificationEmailQueue: email delivery tracking (pending/sent/failed/skipped)

import { createdAtColumn, updatedAtColumn } from '../columns'
import {
  pgTable,
  uuid,
  varchar,
  text,
  jsonb,
  boolean,
  integer,
  timestamp,
  time,
  date,
  index,
  uniqueIndex,
  foreignKey,
  check,
  primaryKey,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { properties } from './property.schema'

// ── Notification types ──────────────────────────────────────────────
// Kept as varchar, not enum, so new types can be added without migration.

// ── In-app notifications ────────────────────────────────────────────

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: varchar('user_id', { length: 255 }).notNull(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    // Null only for Organization-scoped mandatory account/security notices.
    propertyId: uuid('property_id'),
    type: varchar('type', { length: 64 }).notNull(),
    category: varchar('category', { length: 40 }).notNull(),
    priority: varchar('priority', { length: 16 }).notNull().default('normal'),
    status: varchar('status', { length: 16 }).notNull().default('unread'),

    resourceType: varchar('resource_type', { length: 50 }).notNull(),
    resourceId: varchar('resource_id', { length: 255 }).notNull(),

    eventId: varchar('event_id', { length: 255 }).notNull(),

    title: varchar('title', { length: 255 }).notNull(),
    body: text('body'),

    // ADR 0046 r.8 — content-free render metadata; title/body above are a
    // rendered snapshot of (type, payload). Nullable: legacy rows have none.
    payload: jsonb('payload'),
    // ADR 0046 r.2 — coalescing counters for the single unread row per
    // (user, type, resource).
    coalescedCount: integer('coalesced_count').notNull().default(1),
    coalescedLatestAt: timestamp('coalesced_latest_at', { withTimezone: true }),

    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    // ADR 0046 r.2: at most one UNREAD row per (user, type, resource).
    // Replaces the event-ID-keyed uniqueness, which made every event a new row.
    uniqueIndex('notifications_unread_resource_unique')
      .on(t.userId, t.type, t.resourceId)
      .where(sql`status = 'unread'`),
    // Query: unread count + list by user
    index('notifications_user_status_idx').on(t.userId, t.status, t.createdAt),
    // Query: list by org (admin views)
    index('notifications_org_idx').on(t.organizationId, t.createdAt),
    foreignKey({
      columns: [t.organizationId, t.propertyId],
      foreignColumns: [properties.organizationId, properties.id],
      name: 'notifications_property_tenant_fk',
    }).onDelete('cascade'),
    check(
      'notifications_source_content_free_check',
      sql`NOT (COALESCE(${t.payload}, '{}'::jsonb) ? 'rating') AND CASE WHEN COALESCE(${t.payload}, '{}'::jsonb) ? 'guestRating' THEN COALESCE(${t.payload}->>'platform' = 'portal' AND jsonb_typeof(${t.payload}->'guestRating') = 'number' AND ${t.payload}->>'guestRating' = ANY (ARRAY['1', '2', '3', '4', '5']::text[]), false) ELSE true END`,
    ),
    check(
      'notifications_mandatory_scope_check',
      sql`(
        ${t.category} = 'mandatory'
        AND ${t.propertyId} IS NULL
        AND ${t.resourceType} = 'organization'
      ) OR (
        ${t.category} <> 'mandatory'
        AND ${t.propertyId} IS NOT NULL
        AND ${t.resourceType} <> 'organization'
      )`,
    ),
  ],
)

// ── Email delivery tracking ─────────────────────────────────────────

export const notificationEmailQueue = pgTable(
  'notification_email_queue',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    notificationId: uuid('notification_id').notNull(),
    userId: varchar('user_id', { length: 255 }).notNull(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    // Null only for Organization-scoped mandatory account/security notices.
    propertyId: uuid('property_id'),
    category: varchar('category', { length: 40 }).notNull(),
    cadence: varchar('cadence', { length: 16 }).notNull().default('daily'),
    status: varchar('status', { length: 16 }).notNull().default('pending'),
    priority: varchar('priority', { length: 16 }).notNull().default('normal'),
    idempotencyKey: varchar('idempotency_key', { length: 255 }).notNull(),
    providerMessageId: varchar('provider_message_id', { length: 255 }),
    providerState: varchar('provider_state', { length: 24 }),
    lastErrorClass: varchar('last_error_class', { length: 24 }),
    suppressionReason: varchar('suppression_reason', { length: 255 }),
    notBefore: timestamp('not_before', { withTimezone: true }),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    attemptedAt: timestamp('attempted_at', { withTimezone: true }),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    bouncedAt: timestamp('bounced_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    retryCount: integer('retry_count').notNull().default(0),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index('email_queue_due_idx').on(t.status, t.cadence, t.notBefore, t.nextAttemptAt),
    index('email_queue_property_digest_idx').on(
      t.organizationId,
      t.propertyId,
      t.status,
      t.cadence,
    ),
    index('notification_email_queue_immediate_acceptance_health_idx')
      .on(t.createdAt.desc(), t.id)
      .where(sql`${t.cadence} = 'immediate' AND ${t.notBefore} IS NULL`),
    uniqueIndex('email_queue_property_idempotency_unique')
      .on(t.organizationId, t.propertyId, t.idempotencyKey)
      .where(sql`${t.propertyId} IS NOT NULL`),
    uniqueIndex('email_queue_organization_idempotency_unique')
      .on(t.organizationId, t.idempotencyKey)
      .where(sql`${t.propertyId} IS NULL`),
    uniqueIndex('email_queue_notification_unique').on(t.notificationId),
    uniqueIndex('email_queue_id_tenant_recipient_unique').on(
      t.id,
      t.organizationId,
      t.userId,
    ),
    foreignKey({
      columns: [t.organizationId, t.propertyId],
      foreignColumns: [properties.organizationId, properties.id],
      name: 'notification_email_queue_property_tenant_fk',
    }).onDelete('cascade'),
    check(
      'notification_email_queue_mandatory_scope_check',
      sql`(
        ${t.category} = 'mandatory'
        AND ${t.propertyId} IS NULL
        AND ${t.cadence} = 'immediate'
      ) OR (
        ${t.category} <> 'mandatory'
        AND ${t.propertyId} IS NOT NULL
      )`,
    ),
  ],
)

// ── Immutable daily-digest attempts ────────────────────────────────

/**
 * A provider idempotency key belongs to one immutable recipient batch. Open
 * batches survive worker crashes; retries reconstruct only their persisted
 * members and verify the provider-visible content digest before sending.
 */
export const notificationDigestBatches = pgTable(
  'notification_digest_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    userId: varchar('user_id', { length: 255 }).notNull(),
    localDate: date('local_date').notNull(),
    sequence: integer('sequence').notNull(),
    memberDigest: varchar('member_digest', { length: 64 }).notNull(),
    contentDigest: varchar('content_digest', { length: 64 }).notNull(),
    providerIdempotencyKey: varchar('provider_idempotency_key', {
      length: 96,
    }).notNull(),
    // Provider retries must reproduce the exact List-Unsubscribe header even
    // when the active signing key changes between attempts.
    unsubscribeKeyVersion: varchar('unsubscribe_key_version', { length: 32 })
      .notNull()
      .default('legacy'),
    state: varchar('state', { length: 16 }).notNull().default('prepared'),
    providerMessageId: varchar('provider_message_id', { length: 255 }),
    outcomeClass: varchar('outcome_class', { length: 24 }),
    terminalReason: varchar('terminal_reason', { length: 64 }),
    retryCount: integer('retry_count').notNull().default(0),
    attemptedAt: timestamp('attempted_at', { withTimezone: true }),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex('notification_digest_batches_sequence_unique').on(
      t.organizationId,
      t.userId,
      t.localDate,
      t.sequence,
    ),
    uniqueIndex('notification_digest_batches_provider_key_unique').on(
      t.providerIdempotencyKey,
    ),
    uniqueIndex('notification_digest_batches_id_tenant_recipient_unique').on(
      t.id,
      t.organizationId,
      t.userId,
    ),
    uniqueIndex('notification_digest_batches_open_unique')
      .on(t.organizationId, t.userId)
      .where(sql`state IN ('prepared', 'retryable')`),
    index('notification_digest_batches_retention_idx').on(t.state, t.updatedAt),
    check(
      'notification_digest_batches_state_valid',
      sql`${t.state} IN ('prepared', 'retryable', 'accepted', 'terminal')`,
    ),
    check('notification_digest_batches_sequence_positive', sql`${t.sequence} > 0`),
    check(
      'notification_digest_batches_member_digest_valid',
      sql`${t.memberDigest} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      'notification_digest_batches_content_digest_valid',
      sql`${t.contentDigest} ~ '^[a-f0-9]{64}$'`,
    ),
  ],
)

export const notificationDigestBatchMembers = pgTable(
  'notification_digest_batch_members',
  {
    batchId: uuid('batch_id').notNull(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    userId: varchar('user_id', { length: 255 }).notNull(),
    notificationEmailId: uuid('notification_email_id').notNull(),
    sortIndex: integer('sort_index').notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [
    primaryKey({
      columns: [t.batchId, t.notificationEmailId],
      name: 'notification_digest_batch_members_pk',
    }),
    uniqueIndex('notification_digest_batch_members_email_unique').on(
      t.notificationEmailId,
    ),
    uniqueIndex('notification_digest_batch_members_order_unique').on(
      t.batchId,
      t.sortIndex,
    ),
    foreignKey({
      columns: [t.batchId, t.organizationId, t.userId],
      foreignColumns: [
        notificationDigestBatches.id,
        notificationDigestBatches.organizationId,
        notificationDigestBatches.userId,
      ],
      name: 'notification_digest_batch_members_batch_tenant_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.notificationEmailId, t.organizationId, t.userId],
      foreignColumns: [
        notificationEmailQueue.id,
        notificationEmailQueue.organizationId,
        notificationEmailQueue.userId,
      ],
      name: 'notification_digest_batch_members_email_tenant_fk',
    }).onDelete('cascade'),
    check(
      'notification_digest_batch_members_sort_index_nonnegative',
      sql`${t.sortIndex} >= 0`,
    ),
  ],
)

// ── Notification preferences ────────────────────────────────────────

export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: varchar('user_id', { length: 255 }).notNull(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    category: varchar('category', { length: 40 }).notNull(),
    channel: varchar('channel', { length: 16 }).notNull(),
    enabled: boolean('enabled').notNull().default(true),
    cadence: varchar('cadence', { length: 16 }).notNull().default('daily'),
    urgentBypassEnabled: boolean('urgent_bypass_enabled').notNull().default(false),
    quietHoursStart: time('quiet_hours_start'),
    quietHoursEnd: time('quiet_hours_end'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex('notification_prefs_scope_unique').on(
      t.userId,
      t.organizationId,
      t.propertyId,
      t.category,
      t.channel,
    ),
    foreignKey({
      columns: [t.organizationId, t.propertyId],
      foreignColumns: [properties.organizationId, properties.id],
      name: 'notification_preferences_property_tenant_fk',
    }).onDelete('cascade'),
    check(
      'notification_preferences_channel_valid',
      sql`${t.channel} IN ('in_app', 'email')`,
    ),
    check(
      'notification_preferences_cadence_valid',
      sql`${t.cadence} IN ('immediate', 'daily')`,
    ),
    check(
      'notification_preferences_quiet_pair',
      sql`(${t.quietHoursStart} IS NULL) = (${t.quietHoursEnd} IS NULL)`,
    ),
    check(
      'notification_preferences_required_enabled',
      sql`${t.enabled} OR (
        ${t.category} <> 'mandatory'
        AND NOT (${t.category} = 'urgent_operational' AND ${t.channel} = 'in_app')
      )`,
    ),
    check(
      'notification_preferences_configurable_category_check',
      sql`${t.category} <> 'mandatory'`,
    ),
  ],
)

export const notificationUserSettings = pgTable(
  'notification_user_settings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: varchar('user_id', { length: 255 }).notNull(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    locale: varchar('locale', { length: 35 }).notNull().default('en'),
    timezone: varchar('timezone', { length: 64 }).notNull().default('UTC'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex('notification_user_settings_scope_unique').on(t.userId, t.organizationId),
  ],
)
