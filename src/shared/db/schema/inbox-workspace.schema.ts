// Inbox context — the notes a person writes on an item and the per-user last-visit
// stamp. Both hang off `inbox_items`; this file imports it and nothing points
// back, so there is no cycle. Moved out of inbox.schema.ts unchanged, so that file
// stays within its length ratchet.

import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { createdAtColumn, updatedAtColumn } from '../columns'
import { inboxItems } from './inbox.schema'

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

// Per-user last-visit timestamp (ADR 0057) — replaces the org-level "new" badge.
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
