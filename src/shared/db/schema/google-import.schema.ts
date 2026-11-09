import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  foreignKey,
  integer,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { createdAtColumn, updatedAtColumn } from '../columns'
import { googleConnections } from './google-connection.schema'
import { properties } from './property.schema'

// The enum names are persisted contracts shared with the running import store.
export const googleImportV2ItemStatusEnum = pgEnum('google_import_v2_item_status', [
  'pending',
  'processing',
  'imported',
  'relinked',
  'already_exists',
  'failed',
  'cancelled',
])

export const googleImportV2ActionEnum = pgEnum('google_import_v2_action', [
  'create',
  'relink',
])

export const googleImportV2OutcomeEnum = pgEnum('google_import_v2_outcome', [
  'imported',
  'relinked',
  'already_exists',
  'active_binding_conflict',
  'stale_binding',
  'reauthentication_required',
  'reconnect_required',
  'authorization_changed',
  'user_cancelled',
  'policy_disabled',
  'organization_suspended',
  'property_suspended',
  'property_deleted',
  'temporarily_unavailable',
  'cleanup_required',
  'internal_error',
  'tenant_profile_invalid',
])

const timestamptz = (name: string) => timestamp(name, { withTimezone: true })

/**
 * Integration owns these checkpoints. Delete the whole import and its items
 * 30 days after its first terminal completion; retries must not renew that deadline.
 * Progress is derived from the items rather than stored in parent counters.
 */
export const googleImports = pgTable(
  'google_imports',
  {
    id: uuid('id').primaryKey(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    requestId: uuid('request_id').notNull(),
    initiatedBy: varchar('initiated_by', { length: 255 }).notNull(),
    totalCount: integer('total_count').notNull(),
    wireReplayKeyVersion: varchar('wire_replay_key_version', { length: 32 }).notNull(),
    wireReplayDigest: varchar('wire_replay_digest', { length: 43 }).notNull(),
    semanticReplayKeyVersion: varchar('semantic_replay_key_version', {
      length: 32,
    }).notNull(),
    semanticReplayDigest: varchar('semantic_replay_digest', { length: 43 }).notNull(),
    deletionFence: integer('deletion_fence').notNull().default(0),
    firstTerminalAt: timestamptz('first_terminal_at'),
    purgeAt: timestamptz('purge_at'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index('google_imports_purge_idx').on(t.purgeAt, t.id),
    unique('google_imports_org_request_unique').on(t.organizationId, t.requestId),
    unique('google_imports_org_id_key').on(t.organizationId, t.id),
    check(
      'google_imports_counts_valid',
      sql`${t.totalCount} >= 1 AND ${t.deletionFence} >= 0`,
    ),
    check(
      'google_imports_replay_encoding_valid',
      sql`${t.wireReplayKeyVersion} ~ '^[a-z][a-z0-9_-]{0,31}$'
        AND ${t.semanticReplayKeyVersion} ~ '^[a-z][a-z0-9_-]{0,31}$'
        AND ${t.wireReplayDigest} ~ '^[A-Za-z0-9_-]{43}$'
        AND ${t.semanticReplayDigest} ~ '^[A-Za-z0-9_-]{43}$'`,
    ),
    check(
      'google_imports_terminal_times_valid',
      sql`(${t.firstTerminalAt} IS NULL) = (${t.purgeAt} IS NULL)
        AND (${t.firstTerminalAt} IS NULL OR ${t.purgeAt} = ${t.firstTerminalAt} + interval '30 days')`,
    ),
  ],
)

export const googleImportItems = pgTable(
  'google_import_items',
  {
    id: uuid('id').primaryKey(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    importId: uuid('import_id').notNull(),
    connectionId: uuid('connection_id'),
    existingPropertyId: uuid('existing_property_id'),
    destinationPropertyId: uuid('destination_property_id'),
    providerAccountSuffix: varchar('provider_account_suffix', { length: 255 }),
    providerLocationSuffix: varchar('provider_location_suffix', { length: 255 }),
    googleReviewUri: varchar('google_review_uri', { length: 2048 }),
    googlePrimaryCategory: varchar('google_primary_category', { length: 512 }),
    expectedConnectionLifecycleVersion: integer('expected_connection_lifecycle_version'),
    expectedConnectionAccessVersion: integer('expected_connection_access_version'),
    expectedCredentialGeneration: integer('expected_credential_generation'),
    expectedExecutionPolicyVersion: varchar('expected_execution_policy_version', {
      length: 32,
    }),
    expectedActorRole: varchar('expected_actor_role', { length: 50 }),
    expectedPermissionDigest: varchar('expected_permission_digest', { length: 64 }),
    expectedPrincipalKind: varchar('expected_principal_kind', { length: 32 }),
    expectedPermissionVersion: integer('expected_permission_version'),
    expectedSourceEpoch: integer('expected_source_epoch'),
    expectedProfileVersion: integer('expected_profile_version'),
    action: googleImportV2ActionEnum('action').notNull(),
    updateExistingProfile: boolean('update_existing_profile').notNull(),
    propertyName: varchar('property_name', { length: 100 }).notNull(),
    propertyAddress: text('property_address'),
    countryCode: varchar('country_code', { length: 2 }),
    timezone: varchar('timezone', { length: 64 }).notNull(),
    status: googleImportV2ItemStatusEnum('status').notNull().default('pending'),
    outcomeCode: googleImportV2OutcomeEnum('outcome_code'),
    invalidProfileField: varchar('invalid_profile_field', { length: 16 }),
    effectDeadlineAt: timestamptz('effect_deadline_at').notNull(),
    retryRevision: integer('retry_revision').notNull().default(0),
    dispatchEpoch: integer('dispatch_epoch').notNull().default(0),
    nextDispatchAt: timestamptz('next_dispatch_at'),
    highestAttemptForRevision: integer('highest_attempt_for_revision')
      .notNull()
      .default(0),
    claimFence: uuid('claim_fence'),
    claimLeaseExpiresAt: timestamptz('claim_lease_expires_at'),
    firstTerminalAt: timestamptz('first_terminal_at'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index('google_import_items_parent_idx').on(
      t.organizationId,
      t.importId,
      t.createdAt,
      t.id,
    ),
    index('google_import_items_dispatch_idx').on(t.nextDispatchAt, t.id),
    index('google_import_items_expired_idx').on(t.status, t.effectDeadlineAt, t.id),
    index('google_import_items_connection_idx').on(t.organizationId, t.connectionId),
    index('google_import_items_existing_property_idx').on(
      t.organizationId,
      t.existingPropertyId,
    ),
    index('google_import_items_destination_idx').on(
      t.organizationId,
      t.destinationPropertyId,
      t.createdAt,
      t.id,
    ),
    unique('google_import_items_org_id_key').on(t.organizationId, t.id),
    foreignKey({
      name: 'google_import_items_parent_tenant_fk',
      columns: [t.organizationId, t.importId],
      foreignColumns: [googleImports.organizationId, googleImports.id],
    })
      .onDelete('cascade')
      .onUpdate('no action'),
    foreignKey({
      name: 'google_import_items_connection_tenant_fk',
      columns: [t.organizationId, t.connectionId],
      foreignColumns: [googleConnections.organizationId, googleConnections.id],
    })
      .onDelete('restrict')
      .onUpdate('no action'),
    foreignKey({
      name: 'google_import_items_property_tenant_fk',
      columns: [t.organizationId, t.existingPropertyId],
      foreignColumns: [properties.organizationId, properties.id],
    })
      .onDelete('restrict')
      .onUpdate('no action'),
    check('google_import_items_dispatch_epoch_valid', sql`${t.dispatchEpoch} >= 0`),
    check(
      'google_import_items_checkpoint_state_valid',
      sql`(
        (
          (${t.status} IN ('pending', 'processing') OR ${t.outcomeCode} = 'temporarily_unavailable')
          AND ${t.connectionId} IS NOT NULL
          AND ${t.providerAccountSuffix} IS NOT NULL
          AND ${t.providerLocationSuffix} IS NOT NULL
          AND ${t.expectedConnectionLifecycleVersion} IS NOT NULL
          AND ${t.expectedConnectionAccessVersion} IS NOT NULL
          AND ${t.expectedCredentialGeneration} IS NOT NULL
          AND ${t.expectedExecutionPolicyVersion} IS NOT NULL
          AND ${t.expectedActorRole} IS NOT NULL
          AND ${t.expectedPermissionDigest} IS NOT NULL
          AND ${t.expectedPrincipalKind} IS NOT NULL
          AND ${t.expectedPermissionVersion} IS NOT NULL
        ) OR (
          ${t.status} NOT IN ('pending', 'processing')
          AND ${t.outcomeCode} <> 'temporarily_unavailable'
          AND ${t.connectionId} IS NULL
          AND ${t.providerAccountSuffix} IS NULL
          AND ${t.providerLocationSuffix} IS NULL
          AND ${t.googleReviewUri} IS NULL
          AND ${t.googlePrimaryCategory} IS NULL
          AND ${t.expectedConnectionLifecycleVersion} IS NULL
          AND ${t.expectedConnectionAccessVersion} IS NULL
          AND ${t.expectedCredentialGeneration} IS NULL
          AND ${t.expectedExecutionPolicyVersion} IS NULL
          AND ${t.expectedActorRole} IS NULL
          AND ${t.expectedPermissionDigest} IS NULL
          AND ${t.expectedPrincipalKind} IS NULL
          AND ${t.expectedPermissionVersion} IS NULL
        )
      ) IS TRUE`,
    ),
    check(
      'google_import_items_appointment_valid',
      sql`(${t.status} IN ('pending', 'processing')) = (${t.nextDispatchAt} IS NOT NULL)`,
    ),
    check(
      'google_import_items_profile_valid',
      sql`(
        char_length(btrim(${t.propertyName})) BETWEEN 1 AND 100
        AND char_length(${t.timezone}) BETWEEN 1 AND 64
        AND (${t.countryCode} IS NULL OR ${t.countryCode} ~ '^[A-Z]{2}$')
        AND (
          (
          (${t.action} = 'create' AND ${t.existingPropertyId} IS NULL AND ${t.destinationPropertyId} IS NOT NULL AND ${t.countryCode} IS NOT NULL AND ${t.updateExistingProfile} = true AND ${t.expectedSourceEpoch} IS NULL AND ${t.expectedProfileVersion} IS NULL)
          OR (${t.action} = 'relink' AND ${t.existingPropertyId} IS NOT NULL AND ${t.destinationPropertyId} = ${t.existingPropertyId} AND ${t.expectedSourceEpoch} >= 0 AND ${t.expectedProfileVersion} >= 1)
        )
        OR (
          ${t.status} NOT IN ('pending', 'processing')
          AND ${t.outcomeCode} <> 'temporarily_unavailable'
          AND ${t.existingPropertyId} IS NULL
          AND (${t.status} IN ('imported', 'relinked', 'already_exists') OR ${t.destinationPropertyId} IS NULL)
          AND ${t.expectedSourceEpoch} IS NULL
          AND ${t.expectedProfileVersion} IS NULL
        )
          )
      ) IS TRUE`,
    ),
    check(
      'google_import_items_generations_valid',
      sql`(
        (
          (
          ${t.expectedConnectionLifecycleVersion} >= 1
          AND ${t.expectedConnectionAccessVersion} >= 1
          AND ${t.expectedCredentialGeneration} >= 1
          )
          OR (
          ${t.status} NOT IN ('pending', 'processing')
          AND ${t.outcomeCode} <> 'temporarily_unavailable'
          AND ${t.expectedConnectionLifecycleVersion} IS NULL
          AND ${t.expectedConnectionAccessVersion} IS NULL
          AND ${t.expectedCredentialGeneration} IS NULL
          )
        )
        AND ${t.retryRevision} >= 0
      )`,
    ),
    check(
      'google_import_items_authorization_snapshot_valid',
      sql`(
        (
          ${t.expectedExecutionPolicyVersion} IS NULL
          AND ${t.expectedActorRole} IS NULL
          AND ${t.expectedPermissionDigest} IS NULL
          AND ${t.expectedPrincipalKind} IS NULL
          AND ${t.expectedPermissionVersion} IS NULL
        )
        OR (
          char_length(${t.expectedExecutionPolicyVersion}) BETWEEN 1 AND 32
          AND char_length(${t.expectedActorRole}) BETWEEN 1 AND 50
          AND ${t.expectedPermissionDigest} ~ '^[a-f0-9]{64}$'
          AND char_length(${t.expectedPrincipalKind}) BETWEEN 1 AND 32
          AND ${t.expectedPermissionVersion} >= 0
        )
      )`,
    ),
    check(
      'google_import_items_attempt_fence_valid',
      sql`(
        ${t.highestAttemptForRevision} BETWEEN 0 AND 5
        AND (${t.claimFence} IS NULL) = (${t.claimLeaseExpiresAt} IS NULL)
        AND (${t.status} = 'processing') = (${t.claimFence} IS NOT NULL)
        AND (
          ${t.status} <> 'processing'
          OR (${t.claimFence} IS NOT NULL AND ${t.highestAttemptForRevision} BETWEEN 1 AND 5)
        )
      )`,
    ),
    check(
      'google_import_items_status_outcome_valid',
      sql`(
        (${t.status} IN ('pending', 'processing') AND ${t.outcomeCode} IS NULL)
        OR (${t.status} = 'imported' AND ${t.outcomeCode} = 'imported')
        OR (${t.status} = 'relinked' AND ${t.outcomeCode} = 'relinked')
        OR (${t.status} = 'already_exists' AND ${t.outcomeCode} = 'already_exists')
        OR (${t.status} = 'failed' AND ${t.outcomeCode}::text IN ('active_binding_conflict', 'stale_binding', 'reauthentication_required', 'reconnect_required', 'temporarily_unavailable', 'cleanup_required', 'internal_error', 'tenant_profile_invalid'))
        OR (${t.status} = 'cancelled' AND ${t.outcomeCode}::text IN ('authorization_changed', 'user_cancelled', 'policy_disabled', 'organization_suspended', 'property_suspended', 'property_deleted'))
      )`,
    ),
    check(
      'google_import_items_terminal_valid',
      sql`${t.outcomeCode} IS NULL OR ${t.firstTerminalAt} IS NOT NULL`,
    ),
    check(
      'google_import_items_invalid_profile_field_valid',
      sql`(
        (${t.invalidProfileField} IS NULL AND (${t.outcomeCode} IS NULL OR ${t.outcomeCode}::text <> 'tenant_profile_invalid'))
        OR (${t.outcomeCode}::text = 'tenant_profile_invalid' AND ${t.invalidProfileField} IN ('name', 'timezone', 'country'))
      ) IS TRUE`,
    ),
    check(
      'google_import_items_deadline_valid',
      sql`${t.effectDeadlineAt} = ${t.createdAt} + interval '24 hours'`,
    ),
    check(
      'google_import_items_provider_reference_retention_valid',
      sql`(
        (
          ${t.status} IN ('pending', 'processing')
          AND ${t.connectionId} IS NOT NULL
          AND ${t.providerAccountSuffix} IS NOT NULL
          AND ${t.providerLocationSuffix} IS NOT NULL
        )
        OR (
          ${t.status} NOT IN ('pending', 'processing')
          AND ((${t.providerAccountSuffix} IS NULL) = (${t.providerLocationSuffix} IS NULL))
        )
      )`,
    ),
    check(
      'google_import_items_provider_suffix_valid',
      sql`(
        (${t.providerAccountSuffix} IS NULL OR ${t.providerAccountSuffix} !~ '[/?#[:space:][:cntrl:]]')
        AND (${t.providerLocationSuffix} IS NULL OR ${t.providerLocationSuffix} !~ '[/?#[:space:][:cntrl:]]')
      )`,
    ),
    check(
      'google_import_items_google_review_uri_valid',
      sql`${t.googleReviewUri} IS NULL OR ${t.googleReviewUri} ~ '^https://'`,
    ),
    check(
      'google_import_items_google_primary_category_valid',
      sql`${t.googlePrimaryCategory} IS NULL OR (char_length(${t.googlePrimaryCategory}) BETWEEN 1 AND 512 AND ${t.googlePrimaryCategory} = btrim(${t.googlePrimaryCategory}))`,
    ),
  ],
)
