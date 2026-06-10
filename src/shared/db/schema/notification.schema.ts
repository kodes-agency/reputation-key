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
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

// ── Notification types ──────────────────────────────────────────────
// Kept as varchar, not enum, so new types can be added without migration.

// ── In-app notifications ────────────────────────────────────────────

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: varchar('user_id', { length: 255 }).notNull(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    type: varchar('type', { length: 64 }).notNull(),
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
    status: varchar('status', { length: 16 }).notNull().default('pending'),
    priority: varchar('priority', { length: 16 }).notNull().default('normal'),

    sentAt: timestamp('sent_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    retryCount: integer('retry_count').notNull().default(0),

    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    // Query: digest job fetches pending normal-priority emails for orgs at 8am
    index('email_queue_status_priority_idx').on(t.status, t.priority, t.organizationId),
    // Query: urgent emails pending
    index('email_queue_urgent_idx').on(t.status, t.priority, t.createdAt),
    // Prevent duplicate email rows per notification
    uniqueIndex('email_queue_notification_unique').on(t.notificationId),
  ],
)

// ── Notification preferences ────────────────────────────────────────
// Sparse: only opted-out preferences exist. Absent row = enabled (default-on).

export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: varchar('user_id', { length: 255 }).notNull(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    type: varchar('type', { length: 64 }).notNull(),
    emailEnabled: boolean('email_enabled').notNull().default(true),
    inAppEnabled: boolean('in_app_enabled').notNull().default(true),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    // One preference row per user per org per type
    uniqueIndex('notification_prefs_user_type_unique').on(
      t.userId,
      t.organizationId,
      t.type,
    ),
  ],
)
