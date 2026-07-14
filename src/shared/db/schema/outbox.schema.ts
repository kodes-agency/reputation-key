import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

// ── outbox_events ───────────────────────────────────────────────────

export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventType: text('event_type').notNull(),
    eventVersion: integer('event_version').notNull().default(1),
    payload: jsonb('payload').notNull(),
    organizationId: text('organization_id').notNull(),
    propertyId: text('property_id'),
    sourceContext: text('source_context').notNull(),
    sourceAggregateId: text('source_aggregate_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    leaseOwner: text('lease_owner'),
    leasedAt: timestamp('leased_at', { withTimezone: true }),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
  },
  (table) => [
    index('outbox_events_unpublished_idx')
      .on(table.createdAt)
      .where(sql`${table.publishedAt} IS NULL AND ${table.leaseExpiresAt} IS NULL`),
    index('outbox_events_lease_expires_idx')
      .on(table.leaseExpiresAt)
      .where(sql`${table.publishedAt} IS NULL`),
    index('outbox_events_org_created_idx').on(table.organizationId, table.createdAt),
  ],
)

// ── event_consumer_receipts ─────────────────────────────────────────

export const eventConsumerReceipts = pgTable(
  'event_consumer_receipts',
  {
    eventId: uuid('event_id')
      .notNull()
      .references(() => outboxEvents.id, { onDelete: 'cascade' }),
    consumerName: text('consumer_name').notNull(),
    status: text('status').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.eventId, table.consumerName] })],
)

// ── Row types ───────────────────────────────────────────────────────

export type OutboxEventRow = typeof outboxEvents.$inferSelect
export type OutboxEventInsert = typeof outboxEvents.$inferInsert
export type ConsumerReceiptRow = typeof eventConsumerReceipts.$inferSelect
export type ConsumerReceiptInsert = typeof eventConsumerReceipts.$inferInsert

// ── Receipt status ──────────────────────────────────────────────────

export const RECEIPT_STATUS = {
  applied: 'applied',
  duplicate: 'duplicate',
  obsolete: 'obsolete',
} as const

export type ReceiptStatus = (typeof RECEIPT_STATUS)[keyof typeof RECEIPT_STATUS]
