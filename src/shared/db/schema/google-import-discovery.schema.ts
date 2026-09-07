import { sql } from 'drizzle-orm'
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { createdAtColumn, updatedAtColumn } from '../columns'
import { googleConnections } from './google-connection.schema'
import { properties } from './property.schema'

export type GoogleImportDiscoveryAuthorizationVector = Readonly<
  Record<string, string | number | boolean | null>
>

/**
 * Durable, server-side pre-confirmation discovery checkpoints.
 *
 * Browser-visible handles contain a random nonce. Only its HMAC-derived key is
 * stored. Provider identifiers and display content stay in the credential-home
 * database, expire after the bounded discovery window, and never enter URLs,
 * logs, events, or the browser's durable storage.
 */
export const googleImportDiscoveryRecords = pgTable(
  'google_import_discovery_records',
  {
    referenceKey: varchar('reference_key', { length: 43 }).primaryKey(),
    keyVersion: varchar('key_version', { length: 32 }).notNull(),
    audience: varchar('audience', { length: 32 }).notNull(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    userId: varchar('user_id', { length: 255 }).notNull(),
    connectionId: uuid('connection_id').notNull(),
    connectionLifecycleVersion: integer('connection_lifecycle_version').notNull(),
    connectionAccessVersion: integer('connection_access_version').notNull(),
    credentialGeneration: integer('credential_generation').notNull(),
    authorizationVector: jsonb('authorization_vector')
      .$type<GoogleImportDiscoveryAuthorizationVector>()
      .notNull(),
    payload: jsonb('payload').$type<Readonly<Record<string, unknown>>>().notNull(),
    affectedPropertyId: uuid('affected_property_id'),
    remainingRedemptions: integer('remaining_redemptions'),
    claimRequestId: uuid('claim_request_id'),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    foreignKey({
      name: 'google_import_discovery_records_connection_tenant_fk',
      columns: [t.organizationId, t.connectionId],
      foreignColumns: [googleConnections.organizationId, googleConnections.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'google_import_discovery_records_property_tenant_fk',
      columns: [t.organizationId, t.affectedPropertyId],
      foreignColumns: [properties.organizationId, properties.id],
    }).onDelete('cascade'),
    index('google_import_discovery_records_scope_idx').on(
      t.organizationId,
      t.userId,
      t.connectionId,
    ),
    index('google_import_discovery_records_property_idx')
      .on(t.organizationId, t.affectedPropertyId)
      .where(sql`${t.affectedPropertyId} IS NOT NULL`),
    index('google_import_discovery_records_expiry_idx').on(t.expiresAt, t.referenceKey),
    check(
      'google_import_discovery_records_key_valid',
      sql`${t.referenceKey} ~ '^[A-Za-z0-9_-]{43}$' AND ${t.keyVersion} ~ '^[a-z][a-z0-9_-]{0,31}$'`,
    ),
    check(
      'google_import_discovery_records_audience_valid',
      sql`${t.audience} IN ('account_selection', 'accounts_cursor', 'locations_cursor', 'import_candidate')`,
    ),
    check(
      'google_import_discovery_records_versions_valid',
      sql`${t.connectionLifecycleVersion} >= 1 AND ${t.connectionAccessVersion} >= 1 AND ${t.credentialGeneration} >= 1`,
    ),
    check(
      'google_import_discovery_records_window_valid',
      sql`${t.expiresAt} > ${t.issuedAt} AND ${t.expiresAt} <= ${t.issuedAt} + interval '24 hours'`,
    ),
    check(
      'google_import_discovery_records_cursor_budget_valid',
      sql`(
        (${t.audience} IN ('accounts_cursor', 'locations_cursor') AND ${t.remainingRedemptions} BETWEEN 0 AND 50)
        OR (${t.audience} NOT IN ('accounts_cursor', 'locations_cursor') AND ${t.remainingRedemptions} IS NULL)
      )`,
    ),
    check(
      'google_import_discovery_records_claim_valid',
      sql`(${t.claimRequestId} IS NULL AND ${t.claimedAt} IS NULL) OR (${t.audience} = 'import_candidate' AND ${t.claimRequestId} IS NOT NULL AND ${t.claimedAt} IS NOT NULL)`,
    ),
  ],
)
