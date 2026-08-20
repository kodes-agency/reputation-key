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
  boolean,
  integer,
  timestamp,
  time,
  index,
  uniqueIndex,
  foreignKey,
  check,
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
    propertyId: uuid('property_id').notNull(),
    type: varchar('type', { length: 64 }).notNull(),
    category: varchar('category', { length: 40 }).notNull(),
    priority: varchar('priority', { length: 16 }).notNull().default('normal'),
    status: varchar('status', { length: 16 }).notNull().default('unread'),

    resourceType: varchar('resource_type', { length: 50 }).notNull(),
    resourceId: varchar('resource_id', { length: 255 }).notNull(),

    eventId: varchar('event_id', { length: 255 }).notNull(),

    title: varchar('title', { length: 255 }).notNull(),
    body: text('body'),

    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    // Idempotency: one notification per user per event per type+resource
    uniqueIndex('notifications_user_event_unique').on(
      t.userId,
      t.type,
      t.resourceId,
      t.eventId,
    ),
    // Query: unread count + list by user
    index('notifications_user_status_idx').on(t.userId, t.status, t.createdAt),
    // Query: list by org (admin views)
    index('notifications_org_idx').on(t.organizationId, t.createdAt),
    foreignKey({
      columns: [t.organizationId, t.propertyId],
      foreignColumns: [properties.organizationId, properties.id],
      name: 'notifications_property_tenant_fk',
    }).onDelete('cascade'),
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
    propertyId: uuid('property_id').notNull(),
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
    uniqueIndex('email_queue_idempotency_unique').on(
      t.organizationId,
      t.propertyId,
      t.idempotencyKey,
    ),
    uniqueIndex('email_queue_notification_unique').on(t.notificationId),
    foreignKey({
      columns: [t.organizationId, t.propertyId],
      foreignColumns: [properties.organizationId, properties.id],
      name: 'notification_email_queue_property_tenant_fk',
    }).onDelete('cascade'),
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

export const notificationGovernanceQuarantine = pgTable(
  'notification_governance_quarantine',
  {
    notificationId: uuid('notification_id').primaryKey(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    reason: varchar('reason', { length: 64 }).notNull(),
    quarantinedAt: timestamp('quarantined_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
)

export const notificationPreferenceGovernanceQuarantine = pgTable(
  'notification_preference_governance_quarantine',
  {
    legacyPreferenceId: uuid('legacy_preference_id').primaryKey(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    reason: varchar('reason', { length: 64 }).notNull(),
    quarantinedAt: timestamp('quarantined_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
)
