// Guest context — Drizzle schema for scan_events, ratings, feedback tables
// Per architecture: schemas live in shared/db/schema/ because Drizzle needs a single barrel.
// snake_case columns, camelCase field names.

import {
  pgTable,
  uuid,
  varchar,
  integer,
  text,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core'
import { portals } from './portal.schema'
import { createdAtColumn } from '../columns'

export const scanEvents = pgTable(
  'scan_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    portalId: uuid('portal_id')
      .notNull()
      .references(() => portals.id),
    propertyId: varchar('property_id', { length: 255 }).notNull(),
    source: varchar('source', { length: 10 }).notNull(),
    sessionId: varchar('session_id', { length: 255 }).notNull(),
    ipHash: text('ip_hash').notNull(),
    staffId: varchar('staff_id', { length: 255 }),
    createdAt: createdAtColumn(),
  },
  (t) => ({
    sessionIdx: index('scan_events_session_idx').on(t.sessionId),
    staffIdx: index('scan_events_staff_idx').on(t.staffId),
  }),
)

export const ratings = pgTable(
  'ratings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    portalId: uuid('portal_id')
      .notNull()
      .references(() => portals.id),
    propertyId: varchar('property_id', { length: 255 }).notNull(),
    sessionId: varchar('session_id', { length: 255 }).notNull(),
    value: integer('value').notNull(),
    source: varchar('source', { length: 10 }).notNull(),
    ipHash: text('ip_hash').notNull(),
    staffId: varchar('staff_id', { length: 255 }),
    createdAt: createdAtColumn(),
  },
  (t) => ({
    uniqueSessionPortal: uniqueIndex('ratings_session_portal_unique').on(
      t.sessionId,
      t.portalId,
    ),
    staffIdx: index('ratings_staff_idx').on(t.staffId),
  }),
)

export const feedback = pgTable(
  'feedback',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    portalId: uuid('portal_id')
      .notNull()
      .references(() => portals.id),
    propertyId: varchar('property_id', { length: 255 }).notNull(),
    sessionId: varchar('session_id', { length: 255 }).notNull(),
    ratingId: uuid('rating_id').references(() => ratings.id),
    comment: text('comment').notNull(),
    source: varchar('source', { length: 10 }).notNull(),
    ipHash: text('ip_hash').notNull(),
    staffId: varchar('staff_id', { length: 255 }),
    createdAt: createdAtColumn(),
  },
  (t) => ({
    staffIdx: index('feedback_staff_idx').on(t.staffId),
  }),
)
