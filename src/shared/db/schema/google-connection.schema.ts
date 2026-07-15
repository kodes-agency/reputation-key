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
  'pending',
  'active',
  'degraded',
  'reauth_required',
  'disconnecting',
  'disconnected',
  'failed',
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
    // B1.6: Token key versioning + health tracking (migration 0010)
    encryptionKeyId: varchar('encryption_key_id', { length: 50 }).notNull().default('v1'),
    lastSuccessfulSyncAt: timestamp('last_successful_sync_at', { withTimezone: true }),
    statusReason: text('status_reason'),
    statusChangedAt: timestamp('status_changed_at', { withTimezone: true }).defaultNow(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    // One Google account belongs to exactly one org: GBP's notificationSetting is
    // per-account, so an account spread across orgs would share one notification
    // config. Global uniqueness enforces the 1:1 account↔org invariant.
    uniqueIndex('google_connections_google_account_idx').on(t.googleAccountId),
  ],
)
