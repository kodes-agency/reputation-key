// Inbox context — Drizzle schema for inbox_items, inbox_notes & inbox_user_views
// Per ADR 0023: status is open/closed; escalation is an orthogonal flag.

import { createdAtColumn, updatedAtColumn } from '../columns'
import {
  pgTable,
  uuid,
  varchar,
  integer,
  boolean,
  text,
  timestamp,
  pgEnum,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core'

export const inboxSourceTypeEnum = pgEnum('inbox_source_type', ['review', 'feedback'])

export const inboxStatusEnum = pgEnum('inbox_status', ['open', 'closed'])

export const inboxItems = pgTable(
  'inbox_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: varchar('property_id', { length: 255 }).notNull(),
    sourceType: inboxSourceTypeEnum('source_type').notNull(),
    sourceId: uuid('source_id').notNull(),
    status: inboxStatusEnum('status').notNull().default('open'),
    // Escalation flag — orthogonal to status (ADR 0023)
    isEscalated: boolean('is_escalated').notNull().default(false),
    escalatedAt: timestamp('escalated_at', { withTimezone: true }),
    escalatedBy: varchar('escalated_by', { length: 255 }),
    escalationResolvedAt: timestamp('escalation_resolved_at', { withTimezone: true }),
    escalationResolvedBy: varchar('escalation_resolved_by', { length: 255 }),
    rating: integer('rating'),
    sourceDate: timestamp('source_date', { withTimezone: true }).notNull(),
    platform: varchar('platform', { length: 255 }),
    snippet: text('snippet'),
    reviewerName: varchar('reviewer_name', { length: 255 }),
    assignedTo: varchar('assigned_to', { length: 255 }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    firstReplySubmittedAt: timestamp('first_reply_submitted_at', { withTimezone: true }),
    firstReplyPublishedAt: timestamp('first_reply_published_at', { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index('inbox_items_org_status_idx').on(t.organizationId, t.status),
    index('inbox_items_org_source_date_idx').on(
      t.organizationId,
      t.sourceDate.desc(),
      t.id,
    ),
    index('inbox_items_org_property_idx').on(t.organizationId, t.propertyId),
    // Composite index for attention signal count queries (org + property + status)
    index('inbox_items_org_property_status_idx').on(
      t.organizationId,
      t.propertyId,
      t.status,
    ),
    // Escalated-folder count: active flag (is_escalated AND escalation_resolved_at IS NULL)
    index('inbox_items_org_escalated_active_idx').on(
      t.organizationId,
      t.isEscalated,
      t.escalationResolvedAt,
    ),
    uniqueIndex('inbox_items_source_unique').on(
      t.sourceType,
      t.sourceId,
      t.organizationId,
    ),
  ],
)

export const inboxNotes = pgTable(
  'inbox_notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    inboxItemId: uuid('inbox_item_id')
      .notNull()
      .references(() => inboxItems.id, { onDelete: 'cascade' }),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    userId: varchar('author_user_id', { length: 255 }).notNull(),
    text: text('text').notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [index('inbox_notes_item_idx').on(t.inboxItemId)],
)

// Per-user last-visit timestamp (ADR 0023) — replaces the org-level "new" badge.
export const inboxUserViews = pgTable(
  'inbox_user_views',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    userId: varchar('user_id', { length: 255 }).notNull(),
    lastInboxView: timestamp('last_inbox_view', { withTimezone: true }).notNull(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [uniqueIndex('inbox_user_views_org_user_unique').on(t.organizationId, t.userId)],
)
