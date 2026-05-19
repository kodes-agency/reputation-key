// Inbox context — Drizzle schema for inbox_items & inbox_notes tables

import { createdAtColumn, updatedAtColumn } from '../columns'
import {
  pgTable,
  uuid,
  varchar,
  integer,
  text,
  timestamp,
  pgEnum,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core'

export const inboxSourceTypeEnum = pgEnum('inbox_source_type', ['review', 'feedback'])

export const inboxStatusEnum = pgEnum('inbox_status', [
  'new',
  'read',
  'addressed',
  'escalated',
  'archived',
])

export const inboxItems = pgTable(
  'inbox_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: varchar('property_id', { length: 255 }).notNull(),
    sourceType: inboxSourceTypeEnum('source_type').notNull(),
    sourceId: uuid('source_id').notNull(),
    status: inboxStatusEnum('status').notNull().default('new'),
    rating: integer('rating'),
    sourceDate: timestamp('source_date', { withTimezone: true }).notNull(),
    platform: varchar('platform', { length: 255 }),
    snippet: text('snippet'),
    assignedTo: varchar('assigned_to', { length: 255 }),
    readAt: timestamp('read_at', { withTimezone: true }),
    escalatedAt: timestamp('escalated_at', { withTimezone: true }),
    addressedAt: timestamp('addressed_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
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
    authorUserId: varchar('author_user_id', { length: 255 }).notNull(),
    text: text('text').notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [index('inbox_notes_item_idx').on(t.inboxItemId)],
)
