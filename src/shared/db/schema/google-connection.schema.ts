// Integration context — Drizzle schema for google_connections table

import { createdAtColumn, updatedAtColumn } from '../columns'
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  text,
  pgEnum,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

export const connectionVisibilityEnum = pgEnum('connection_visibility', [
  'private',
  'organization',
])
export const connectionStatusEnum = pgEnum('connection_status', [
  'active',
  'disconnected',
])

export const googleConnections = pgTable(
  'google_connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    googleAccountId: varchar('google_account_id', { length: 255 }).notNull(),
    googleEmail: varchar('google_email', { length: 255 }).notNull(),
    encryptedAccessToken: text('encrypted_access_token').notNull(),
    encryptedRefreshToken: text('encrypted_refresh_token').notNull(),
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }).notNull(),
    scopes: text('scopes').array().notNull(),
    connectedBy: varchar('connected_by', { length: 255 }).notNull(),
    visibility: connectionVisibilityEnum('visibility').notNull().default('private'),
    status: connectionStatusEnum('status').notNull().default('active'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex('google_connections_org_account_idx').on(
      t.organizationId,
      t.googleAccountId,
    ),
  ],
)
