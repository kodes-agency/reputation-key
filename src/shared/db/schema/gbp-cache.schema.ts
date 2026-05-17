// Integration context — Drizzle schema for gbp_cache table

import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  text,
  pgEnum,
  jsonb,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { properties } from './property.schema'

export const gbpCacheDataTypeEnum = pgEnum('gbp_cache_data_type', ['location'])

export const gbpCache = pgTable(
  'gbp_cache',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    gbpPlaceId: varchar('gbp_place_id', { length: 500 }).notNull(),
    dataType: gbpCacheDataTypeEnum('data_type').notNull(),
    payload: jsonb('payload').notNull(),
    googleAttribution: text('google_attribution'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    // NOTE: gbp_cache unique index does not include organizationId.
    // Tenant isolation relies on the property→organization FK chain.
    // If gbp_cache is ever queried directly by organizationId, add the column.
    uniqueIndex('gbp_cache_property_type_unique').on(t.propertyId, t.dataType),
  ],
)
