import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { createdAtColumn, updatedAtColumn } from '../columns'
import { googleConnections } from './google-connection.schema'
import { properties } from './property.schema'

export const googleImportV2ParentStatusEnum = pgEnum('google_import_v2_parent_status', [
  'queued',
  'processing',
  'completed',
  'completed_with_issues',
  'failed',
  'cancelled',
])

export const googleImportV2ItemStatusEnum = pgEnum('google_import_v2_item_status', [
  'pending',
  'processing',
  'imported',
  'relinked',
  'already_exists',
  'region_unavailable',
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
  'region_unavailable',
  'active_binding_conflict',
  'stale_binding',
  'reauthentication_required',
  'reconnect_required',
  'authorization_changed',
  'policy_disabled',
  'organization_suspended',
  'property_suspended',
  'property_deleted',
  'temporarily_unavailable',
  'cleanup_required',
  'internal_error',
])

const replayVersion = (name: string) => varchar(name, { length: 32 })
const replayDigest = (name: string) => varchar(name, { length: 43 })
const timestamptz = (name: string) => timestamp(name, { withTimezone: true })

export const gbpImportRequests = pgTable(
  'gbp_import_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    requestId: uuid('request_id').notNull(),
    initiatedBy: varchar('initiated_by', { length: 255 }).notNull(),
    status: googleImportV2ParentStatusEnum('status').notNull().default('queued'),
    totalCount: integer('total_count').notNull(),
    processedCount: integer('processed_count').notNull().default(0),
    pendingCount: integer('pending_count').notNull(),
    processingCount: integer('processing_count').notNull().default(0),
    importedCount: integer('imported_count').notNull().default(0),
    relinkedCount: integer('relinked_count').notNull().default(0),
    alreadyExistsCount: integer('already_exists_count').notNull().default(0),
    regionUnavailableCount: integer('region_unavailable_count').notNull().default(0),
    failedCount: integer('failed_count').notNull().default(0),
    cancelledCount: integer('cancelled_count').notNull().default(0),
    deletionFence: integer('deletion_fence').notNull().default(0),
    wireReplayKeyVersion: replayVersion('wire_replay_key_version'),
    wireReplayDigest: replayDigest('wire_replay_digest'),
    semanticReplayKeyVersion: replayVersion('semantic_replay_key_version'),
    semanticReplayDigest: replayDigest('semantic_replay_digest'),
    firstTerminalAt: timestamptz('first_terminal_at'),
    purgeAt: timestamptz('purge_at'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => ({
    organizationRequestUnique: uniqueIndex('gbp_import_requests_org_request_unique').on(
      t.organizationId,
      t.requestId,
    ),
    organizationIdKey: uniqueIndex('gbp_import_requests_org_id_key').on(
      t.organizationId,
      t.id,
    ),
    initiatedRequestIdx: index('gbp_import_requests_initiated_request_idx').on(
      t.organizationId,
      t.initiatedBy,
      t.requestId,
    ),
    purgeIdx: index('gbp_import_requests_purge_idx')
      .on(t.purgeAt, t.id)
      .where(sql`${t.purgeAt} IS NOT NULL`),
    replayPairsCheck: check(
      'gbp_import_requests_replay_pairs_valid',
      sql`(
        (${t.wireReplayKeyVersion} IS NULL) = (${t.wireReplayDigest} IS NULL)
        AND (${t.semanticReplayKeyVersion} IS NULL) = (${t.semanticReplayDigest} IS NULL)
        AND (${t.wireReplayDigest} IS NULL) = (${t.semanticReplayDigest} IS NULL)
      )`,
    ),
    replayEncodingCheck: check(
      'gbp_import_requests_replay_encoding_valid',
      sql`(
        ${t.wireReplayDigest} IS NULL OR (
          ${t.wireReplayKeyVersion} ~ '^[a-z][a-z0-9_-]{0,31}$'
          AND ${t.semanticReplayKeyVersion} ~ '^[a-z][a-z0-9_-]{0,31}$'
          AND ${t.wireReplayDigest} ~ '^[A-Za-z0-9_-]{43}$'
          AND ${t.semanticReplayDigest} ~ '^[A-Za-z0-9_-]{43}$'
        )
      )`,
    ),
    terminalTimesCheck: check(
      'gbp_import_requests_terminal_times_valid',
      sql`(
        (${t.firstTerminalAt} IS NULL) = (${t.purgeAt} IS NULL)
        AND (${t.firstTerminalAt} IS NULL OR ${t.purgeAt} = ${t.firstTerminalAt} + interval '30 days')
        AND (${t.status} IN ('queued', 'processing') OR ${t.firstTerminalAt} IS NOT NULL)
      )`,
    ),
    countsCheck: check(
      'gbp_import_requests_counts_valid',
      sql`(
        ${t.totalCount} BETWEEN 1 AND 100
        AND ${t.deletionFence} >= 0
        AND ${t.pendingCount} >= 0
        AND ${t.processingCount} >= 0
        AND ${t.importedCount} >= 0
        AND ${t.relinkedCount} >= 0
        AND ${t.alreadyExistsCount} >= 0
        AND ${t.regionUnavailableCount} >= 0
        AND ${t.failedCount} >= 0
        AND ${t.cancelledCount} >= 0
        AND ${t.processedCount} = ${t.importedCount} + ${t.relinkedCount} + ${t.alreadyExistsCount} + ${t.regionUnavailableCount} + ${t.failedCount} + ${t.cancelledCount}
        AND ${t.totalCount} = ${t.pendingCount} + ${t.processingCount} + ${t.processedCount}
      )`,
    ),
  }),
)

export const gbpImportRequestItems = pgTable(
  'gbp_import_request_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    importJobId: uuid('import_job_id').notNull(),
    connectionId: uuid('connection_id'),
    existingPropertyId: uuid('existing_property_id'),
    destinationPropertyId: uuid('destination_property_id'),
    providerAccountSuffix: varchar('provider_account_suffix', { length: 255 }),
    providerLocationSuffix: varchar('provider_location_suffix', { length: 255 }),
    expectedConnectionLifecycleVersion: integer('expected_connection_lifecycle_version'),
    expectedConnectionAccessVersion: integer('expected_connection_access_version'),
    expectedCredentialGeneration: integer('expected_credential_generation'),
    approvalBindingId: varchar('approval_binding_id', { length: 255 }),
    expectedExecutionPolicyVersion: varchar('expected_execution_policy_version', {
      length: 32,
    }),
    expectedGoogleContentPolicyVersion: integer('expected_google_content_policy_version'),
    expectedEmergencyKillVersion: integer('expected_emergency_kill_version'),
    expectedActorRole: varchar('expected_actor_role', { length: 50 }),
    expectedPermissionDigest: varchar('expected_permission_digest', { length: 64 }),
    expectedSourceEpoch: integer('expected_source_epoch'),
    expectedProfileVersion: integer('expected_profile_version'),
    action: googleImportV2ActionEnum('action').notNull(),
    updateExistingProfile: boolean('update_existing_profile').notNull(),
    propertyName: varchar('property_name', { length: 100 }).notNull(),
    propertyAddress: text('property_address'),
    countryCode: varchar('country_code', { length: 2 }),
    timezone: varchar('timezone', { length: 64 }).notNull(),
    processingRegion: text('processing_region').notNull(),
    routingPolicyVersion: integer('routing_policy_version').notNull(),
    status: googleImportV2ItemStatusEnum('status').notNull().default('pending'),
    outcomeCode: googleImportV2OutcomeEnum('outcome_code'),
    effectDeadlineAt: timestamptz('effect_deadline_at').notNull(),
    retryRevision: integer('retry_revision').notNull().default(0),
    highestAttemptForRevision: integer('highest_attempt_for_revision')
      .notNull()
      .default(0),
    claimFence: uuid('claim_fence'),
    claimLeaseExpiresAt: timestamptz('claim_lease_expires_at'),
    firstTerminalAt: timestamptz('first_terminal_at'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => ({
    organizationIdKey: uniqueIndex('gbp_import_request_items_org_id_key').on(
      t.organizationId,
      t.id,
    ),
    parentTenantFk: foreignKey({
      name: 'gbp_import_request_items_parent_tenant_fk',
      columns: [t.organizationId, t.importJobId],
      foreignColumns: [gbpImportRequests.organizationId, gbpImportRequests.id],
    })
      .onDelete('cascade')
      .onUpdate('no action'),
    connectionTenantFk: foreignKey({
      name: 'gbp_import_request_items_connection_tenant_fk',
      columns: [t.organizationId, t.connectionId],
      foreignColumns: [googleConnections.organizationId, googleConnections.id],
    })
      .onDelete('restrict')
      .onUpdate('no action'),
    propertyTenantFk: foreignKey({
      name: 'gbp_import_request_items_property_tenant_fk',
      columns: [t.organizationId, t.existingPropertyId],
      foreignColumns: [properties.organizationId, properties.id],
    })
      .onDelete('restrict')
      .onUpdate('no action'),
    parentStatusIdx: index('gbp_import_request_items_parent_status_idx').on(
      t.organizationId,
      t.importJobId,
      t.status,
      t.retryRevision,
    ),
    effectDeadlineIdx: index('gbp_import_request_items_effect_deadline_idx')
      .on(t.effectDeadlineAt, t.id)
      .where(sql`${t.status} IN ('pending', 'processing')`),
    routingIdx: index('gbp_import_request_items_routing_idx')
      .on(t.organizationId, t.id, t.status)
      .where(sql`${t.status} IN ('pending', 'processing')`),
    profileCheck: check(
      'gbp_import_request_items_profile_valid',
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
          AND ${t.destinationPropertyId} IS NULL
          AND ${t.expectedSourceEpoch} IS NULL
          AND ${t.expectedProfileVersion} IS NULL
        )
          )
      )`,
    ),
    generationCheck: check(
      'gbp_import_request_items_generations_valid',
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
        AND ${t.routingPolicyVersion} >= 1
        AND ${t.retryRevision} >= 0
      )`,
    ),
    authorizationSnapshotCheck: check(
      'gbp_import_request_items_authorization_snapshot_valid',
      sql`(
        (
          ${t.approvalBindingId} IS NULL
          AND ${t.expectedExecutionPolicyVersion} IS NULL
          AND ${t.expectedGoogleContentPolicyVersion} IS NULL
          AND ${t.expectedEmergencyKillVersion} IS NULL
          AND ${t.expectedActorRole} IS NULL
          AND ${t.expectedPermissionDigest} IS NULL
        )
        OR (
          char_length(${t.approvalBindingId}) BETWEEN 1 AND 255
          AND char_length(${t.expectedExecutionPolicyVersion}) BETWEEN 1 AND 32
          AND ${t.expectedGoogleContentPolicyVersion} >= 0
          AND ${t.expectedEmergencyKillVersion} >= 0
          AND char_length(${t.expectedActorRole}) BETWEEN 1 AND 50
          AND ${t.expectedPermissionDigest} ~ '^[a-f0-9]{64}$'
        )
      )`,
    ),
    attemptFenceCheck: check(
      'gbp_import_request_items_attempt_fence_valid',
      sql`(
        ${t.highestAttemptForRevision} BETWEEN 0 AND 5
        AND (${t.claimFence} IS NULL) = (${t.claimLeaseExpiresAt} IS NULL)
        AND (
          ${t.status} <> 'processing'
          OR (${t.claimFence} IS NOT NULL AND ${t.highestAttemptForRevision} BETWEEN 1 AND 5)
        )
      )`,
    ),
    statusOutcomeCheck: check(
      'gbp_import_request_items_status_outcome_valid',
      sql`(
        (${t.status} IN ('pending', 'processing') AND ${t.outcomeCode} IS NULL)
        OR (${t.status} = 'imported' AND ${t.outcomeCode} = 'imported')
        OR (${t.status} = 'relinked' AND ${t.outcomeCode} = 'relinked')
        OR (${t.status} = 'already_exists' AND ${t.outcomeCode} = 'already_exists')
        OR (${t.status} = 'region_unavailable' AND ${t.outcomeCode} = 'region_unavailable')
        OR (${t.status} = 'failed' AND ${t.outcomeCode} IN ('active_binding_conflict', 'stale_binding', 'reauthentication_required', 'reconnect_required', 'temporarily_unavailable', 'cleanup_required', 'internal_error'))
        OR (${t.status} = 'cancelled' AND ${t.outcomeCode} IN ('authorization_changed', 'policy_disabled', 'organization_suspended', 'property_suspended', 'property_deleted'))
      )`,
    ),
    terminalCheck: check(
      'gbp_import_request_items_terminal_valid',
      sql`${t.outcomeCode} IS NULL OR ${t.firstTerminalAt} IS NOT NULL`,
    ),
    deadlineCheck: check(
      'gbp_import_request_items_deadline_valid',
      sql`${t.effectDeadlineAt} = ${t.createdAt} + interval '24 hours'`,
    ),
    routingRetentionCheck: check(
      'gbp_import_request_items_routing_retention_valid',
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
    providerSuffixCheck: check(
      'gbp_import_request_items_provider_suffix_valid',
      sql`(
        (${t.providerAccountSuffix} IS NULL OR ${t.providerAccountSuffix} !~ '[/?#[:space:][:cntrl:]]')
        AND (${t.providerLocationSuffix} IS NULL OR ${t.providerLocationSuffix} !~ '[/?#[:space:][:cntrl:]]')
      )`,
    ),
  }),
)

export const gbpImportItemRetryReceipts = pgTable(
  'gbp_import_item_retry_receipts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    initiatingUserId: varchar('initiating_user_id', { length: 255 }).notNull(),
    itemId: uuid('item_id').notNull(),
    retryRequestId: uuid('retry_request_id').notNull(),
    requestDigestKeyVersion: replayVersion('request_digest_key_version').notNull(),
    requestDigest: replayDigest('request_digest').notNull(),
    acceptedRetryRevision: integer('accepted_retry_revision').notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => ({
    requestUnique: uniqueIndex('gbp_import_item_retry_receipts_request_unique').on(
      t.organizationId,
      t.initiatingUserId,
      t.itemId,
      t.retryRequestId,
    ),
    itemTenantFk: foreignKey({
      name: 'gbp_import_item_retry_receipts_item_tenant_fk',
      columns: [t.organizationId, t.itemId],
      foreignColumns: [gbpImportRequestItems.organizationId, gbpImportRequestItems.id],
    })
      .onDelete('cascade')
      .onUpdate('no action'),
    receiptCheck: check(
      'gbp_import_item_retry_receipts_values_valid',
      sql`(
        ${t.requestDigestKeyVersion} ~ '^[a-z][a-z0-9_-]{0,31}$'
        AND ${t.requestDigest} ~ '^[A-Za-z0-9_-]{43}$'
        AND ${t.acceptedRetryRevision} >= 1
      )`,
    ),
  }),
)
