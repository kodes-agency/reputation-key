import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core'
import { createdAtColumn, updatedAtColumn } from '../columns'

export const googleCredentialRoutingDirectoryState = pgTable(
  'google_credential_routing_directory_state',
  {
    singleton: boolean('singleton').primaryKey().default(true),
    currentRevision: bigint('current_revision', { mode: 'number' }).notNull().default(0),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    check(
      'google_credential_routing_directory_state_valid',
      sql`${t.singleton} = TRUE AND ${t.currentRevision} BETWEEN 0 AND '9007199254740991'::bigint`,
    ),
  ],
)

export const googleCredentialRoutingDirectorySnapshots = pgTable(
  'google_credential_routing_directory_snapshots',
  {
    revision: bigint('revision', { mode: 'number' }).primaryKey(),
    cataloguePolicyVersion: integer('catalogue_policy_version').notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    digestSha256: varchar('digest_sha256', { length: 64 }).notNull(),
    signatureKeyVersion: varchar('signature_key_version', { length: 32 }).notNull(),
    signature: varchar('signature', { length: 43 }).notNull(),
    directory: jsonb('directory').notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [
    check(
      'google_credential_routing_directory_snapshot_valid',
      sql`${t.revision} BETWEEN 1 AND '9007199254740991'::bigint AND ${t.cataloguePolicyVersion} >= 1 AND ${t.expiresAt} > ${t.issuedAt} AND ${t.digestSha256} ~ '^[a-f0-9]{64}$' AND ${t.signature} ~ '^[A-Za-z0-9_-]{43}$'`,
    ),
    index('google_credential_routing_directory_expiry_idx').on(t.expiresAt),
  ],
)

export const googleCredentialBrokerReplay = pgTable(
  'google_credential_broker_replay',
  {
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    lookupKeyVersion: varchar('lookup_key_version', { length: 32 }).notNull(),
    grantIdHmac: varchar('grant_id_hmac', { length: 43 }).notNull(),
    oneUseNonceHmac: varchar('one_use_nonce_hmac', { length: 43 }).notNull(),
    connectionId: varchar('connection_id', { length: 255 }).notNull(),
    propertyId: varchar('property_id', { length: 255 }).notNull(),
    homeCellId: varchar('home_cell_id', { length: 16 }).notNull(),
    targetCellId: varchar('target_cell_id', { length: 16 }).notNull(),
    targetGatewayIdentity: varchar('target_gateway_identity', { length: 255 }).notNull(),
    routeKey: varchar('route_key', { length: 96 }).notNull(),
    credentialHomeAuthorityGeneration: integer(
      'credential_home_authority_generation',
    ).notNull(),
    connectionLifecycleVersion: integer('connection_lifecycle_version').notNull(),
    connectionAccessVersion: integer('connection_access_version').notNull(),
    credentialGeneration: integer('credential_generation').notNull(),
    propertySourceEpoch: integer('property_source_epoch').notNull(),
    requestDigestSha256: varchar('request_digest_sha256', { length: 64 }).notNull(),
    credentialBindingSha256: varchar('credential_binding_sha256', {
      length: 64,
    }).notNull(),
    routingDirectoryRevision: bigint('routing_directory_revision', {
      mode: 'number',
    }).notNull(),
    routingPolicyVersion: integer('routing_policy_version').notNull(),
    materialLocator: varchar('material_locator', { length: 255 }).notNull(),
    materialEncryptionKeyId: varchar('material_encryption_key_id', {
      length: 255,
    }).notNull(),
    materialBindingSha256: varchar('material_binding_sha256', {
      length: 64,
    }).notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    state: varchar('state', { length: 16 }).notNull(),
    redeemedAt: timestamp('redeemed_at', { withTimezone: true }),
    createdAt: createdAtColumn(),
  },
  (t) => [
    primaryKey({
      name: 'google_credential_broker_replay_pk',
      columns: [t.organizationId, t.lookupKeyVersion, t.grantIdHmac],
    }),
    check(
      'google_credential_broker_replay_values_valid',
      sql`${t.lookupKeyVersion} ~ '^[a-z][a-z0-9_-]{0,31}$' AND ${t.grantIdHmac} ~ '^[A-Za-z0-9_-]{43}$' AND ${t.oneUseNonceHmac} ~ '^[A-Za-z0-9_-]{43}$' AND ${t.requestDigestSha256} ~ '^[a-f0-9]{64}$' AND ${t.credentialBindingSha256} ~ '^[a-f0-9]{64}$' AND ${t.materialBindingSha256} ~ '^[a-f0-9]{64}$' AND ${t.homeCellId} IN ('us', 'europe', 'global') AND ${t.targetCellId} IN ('us', 'europe', 'global') AND ${t.homeCellId} <> ${t.targetCellId} AND ${t.credentialHomeAuthorityGeneration} >= 1 AND ${t.connectionLifecycleVersion} >= 1 AND ${t.connectionAccessVersion} >= 1 AND ${t.credentialGeneration} >= 1 AND ${t.propertySourceEpoch} >= 0 AND ${t.routingDirectoryRevision} BETWEEN 1 AND '9007199254740991'::bigint AND ${t.routingPolicyVersion} >= 1 AND ${t.expiresAt} > ${t.issuedAt} AND ${t.state} IN ('issued', 'redeemed') AND ((${t.state} = 'issued' AND ${t.redeemedAt} IS NULL) OR (${t.state} = 'redeemed' AND ${t.redeemedAt} IS NOT NULL))`,
    ),
    index('google_credential_broker_replay_expiry_idx').on(t.expiresAt),
  ],
)
