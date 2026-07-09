import {
  pgTable,
  uuid,
  varchar,
  text,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { createdAtColumn } from '../columns'

export const activityLog = pgTable(
  'activity_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorId: varchar('actor_id', { length: 255 }).notNull(),
    actorName: varchar('actor_name', { length: 255 }).notNull(),
    actorAvatarUrl: text('actor_avatar_url'),
    actorRole: varchar('actor_role', { length: 50 }).notNull(),
    action: varchar('action', { length: 50 }).notNull(),
    resourceType: varchar('resource_type', { length: 50 }).notNull(),
    resourceId: varchar('resource_id', { length: 255 }).notNull(),
    propertyId: varchar('property_id', { length: 255 }),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    payload: jsonb('payload').notNull().default({}),
    eventId: varchar('event_id', { length: 255 }),
    source: varchar('source', { length: 20 }).notNull().default('web'),
    createdAt: createdAtColumn(),
  },
  (t) => [
    index('activity_log_resource_idx').on(t.resourceType, t.resourceId, t.createdAt),
    index('activity_log_org_property_idx').on(
      t.organizationId,
      t.propertyId,
      t.createdAt,
    ),
    index('activity_log_event_id_idx').on(t.eventId),
    index('activity_log_actor_idx').on(t.actorId, t.createdAt),
    // ACT-006: enforce idempotency at the DB level — BullMQ delivers at-least-once,
    // so a unique constraint on (eventId, organizationId) is the TOCTOU-safe guard.
    uniqueIndex('activity_log_event_id_org_uniq').on(t.eventId, t.organizationId),
  ],
)
