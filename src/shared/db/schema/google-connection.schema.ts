// Integration context — Drizzle schema for google_connections table

import { sql } from 'drizzle-orm'
import { createdAtColumn, updatedAtColumn } from '../columns'
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  integer,
  text,
  pgEnum,
  uniqueIndex,
  check,
  index,
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
export const googleCredentialUseStateEnum = pgEnum('google_credential_use_state', [
  'active',
  'cleanup_only',
  'none',
])

export const googleConnections = pgTable(
  'google_connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    googleSubject: varchar('google_subject', { length: 255 }),
    // Canonical signed OIDC subject.
    encryptedAccessToken: text('encrypted_access_token').notNull(),
    encryptedRefreshToken: text('encrypted_refresh_token').notNull(),
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }).notNull(),
    scopes: text('scopes').array().notNull(),
    connectedBy: varchar('connected_by', { length: 255 }).notNull(),
    visibility: connectionVisibilityEnum('visibility').notNull().default('private'),
    status: connectionStatusEnum('status').notNull().default('active'),
    credentialUseState: googleCredentialUseStateEnum('credential_use_state')
      .notNull()
      .default('active'),
    cleanupMaterialDeadlineAt: timestamp('cleanup_material_deadline_at', {
      withTimezone: true,
    }),
    lifecycleVersion: integer('lifecycle_version').notNull().default(1),
    accessVersion: integer('access_version').notNull().default(1),
    credentialGeneration: integer('credential_generation').notNull().default(1),
    // B1.6: Token key versioning + health tracking (migration 0010)
    encryptionKeyId: varchar('encryption_key_id', { length: 50 }).notNull().default('v1'),
    lastSuccessfulSyncAt: timestamp('last_successful_sync_at', { withTimezone: true }),
    statusReason: text('status_reason'),
    statusChangedAt: timestamp('status_changed_at', { withTimezone: true }).defaultNow(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex('google_connections_org_id_key').on(t.organizationId, t.id),
    // v2 identity: the signed OIDC subject is globally unique when present.
    uniqueIndex('google_connections_google_subject_idx')
      .on(t.googleSubject)
      .where(sql`${t.googleSubject} IS NOT NULL`),
    check(
      'google_connections_identity_check',
      sql`${t.googleSubject} IS NOT NULL OR ${t.status} = 'disconnected'`,
    ),
    check(
      'google_connections_versions_check',
      sql`${t.lifecycleVersion} >= 1 AND ${t.accessVersion} >= 1 AND ${t.credentialGeneration} >= 1`,
    ),
    // Migration 0010: connections needing attention (reauth, degraded, …) —
    // anything outside the two steady states (active / disconnected).
    index('google_connections_status_idx')
      .on(t.status)
      .where(sql`${t.status} NOT IN ('active', 'disconnected')`),
  ],
)
