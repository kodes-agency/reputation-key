import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
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

import type {
  GoogleContentApprovalRoleDocument,
  GoogleContentEvidenceIndex,
} from '../../auth/google-content-contract'
const timestamptz = (name: string) => timestamp(name, { withTimezone: true })
const generation = (name: string) => bigint(name, { mode: 'number' })

export const googleContentCapabilityEnum = pgEnum('google_content_capability', [
  'property.import_gbp_v2',
  'property.read_gbp_performance',
  'property.connect_gbp',
  'property.publish_reply',
])
export const googleContentApprovalTargetPhaseEnum = pgEnum(
  'google_content_approval_target_phase',
  [
    'local_sandbox',
    'railway_closed_beta',
    'production_expand_canary',
    'production_final',
  ],
)
export const googleContentEnvironmentProfileEnum = pgEnum(
  'google_content_environment_profile',
  ['sandbox', 'railway-closed-beta-1', 'production'],
)
export const googleContentApprovalStatusEnum = pgEnum('google_content_approval_status', [
  'approved',
  'suspended',
  'expired',
  'revoked',
])
export const authorizationExecutionPermitStateEnum = pgEnum(
  'authorization_execution_permit_state',
  ['admitted', 'started', 'completed', 'fenced'],
)
export const authorizationCommitVectorModeEnum = pgEnum(
  'authorization_commit_vector_mode',
  ['full', 'core_credential_projection'],
)
export const googleCredentialSourceKindEnum = pgEnum('google_credential_source_kind', [
  'refresh',
  'reauth',
  'reconnect',
])
export const googleCredentialSourceStateEnum = pgEnum('google_credential_source_state', [
  'registered',
  'provider_started',
  'terminal',
  'provider_outcome_ambiguous',
  'provider_reset_terminal',
])
export const googleSubjectAuthorityGuardStateEnum = pgEnum(
  'google_subject_authority_guard_state',
  [
    'open',
    'source_active',
    'cleanup_pending',
    'drained',
    'provider_reset_required',
    'ambiguous',
    'provider_reset_terminal',
  ],
)
export const credentialRevokePermitStateEnum = pgEnum('credential_revoke_permit_state', [
  'dormant',
  'active',
  'dispatching',
  'consumed_no_revoke',
  'confirmed_not_sent',
  'confirmed_revoked',
  'cleanup_ambiguous',
  'provider_reset_confirmed',
])
export const googleOauthExchangeAttemptStateEnum = pgEnum(
  'google_oauth_exchange_attempt_state',
  [
    'prepared',
    'provider_started',
    'response_preserved',
    'applying',
    'completed',
    'failed',
    'provider_outcome_ambiguous',
    'expired',
  ],
)
export const googleDisconnectRevokeAttemptStateEnum = pgEnum(
  'google_disconnect_revoke_attempt_state',
  [
    'active',
    'dispatching',
    'confirmed_not_sent',
    'confirmed_revoked',
    'cleanup_ambiguous',
  ],
)

export const capabilityComplianceApprovals = pgTable(
  'capability_compliance_approvals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bindingVersion: integer('binding_version').notNull().default(1),
    capability: googleContentCapabilityEnum('capability').notNull(),
    targetPhase: googleContentApprovalTargetPhaseEnum('target_phase').notNull(),
    environmentProfile:
      googleContentEnvironmentProfileEnum('environment_profile').notNull(),
    releaseSha: varchar('release_sha', { length: 128 }).notNull(),
    evidenceManifestSha256: varchar('evidence_manifest_sha256', {
      length: 128,
    }).notNull(),
    evidenceIndexSha256: varchar('evidence_index_sha256', { length: 128 }).notNull(),
    deploymentAttestationSha256: varchar('deployment_attestation_sha256', {
      length: 128,
    }).notNull(),
    adr0050Sha256: varchar('adr_0050_sha256', { length: 128 }).notNull(),
    googleContentPolicyVersion: varchar('google_content_policy_version', {
      length: 100,
    }).notNull(),
    googleOauthContractVersion: varchar('google_oauth_contract_version', {
      length: 100,
    }).notNull(),
    googleProjectAttestationSha256: varchar('google_project_attestation_sha256', {
      length: 128,
    }).notNull(),
    googleOauthClientIdSha256: varchar('google_oauth_client_id_sha256', {
      length: 128,
    }).notNull(),
    googleRedirectUriSha256: varchar('google_redirect_uri_sha256', {
      length: 128,
    }).notNull(),
    providerOriginProfileSha256: varchar('provider_origin_profile_sha256', {
      length: 128,
    }).notNull(),
    runtimeIsolationProfileVersion: varchar('runtime_isolation_profile_version', {
      length: 100,
    }),
    runtimeIsolationProfileSha256: varchar('runtime_isolation_profile_sha256', {
      length: 128,
    }),
    railwayClosedBetaCohort: jsonb('railway_closed_beta_cohort').$type<
      readonly string[]
    >(),
    railwayClosedBetaCohortSha256: varchar('railway_closed_beta_cohort_sha256', {
      length: 128,
    }),
    railwayClosedBetaResidualRiskSha256: varchar(
      'railway_closed_beta_residual_risk_sha256',
      { length: 128 },
    ),
    performanceCatalogVersion: varchar('performance_catalog_version', {
      length: 32,
    }).notNull(),
    // Approval-bound provider route catalogue (route URL, wire dailyMetrics set,
    // dailyRange encoding, page size, response cap). Approval parsing pins it to
    // the compiled GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION, so a catalogue bump
    // makes the persisted row unparseable and the capability denies with
    // approval_unavailable until an operator installs a re-approved bundle.
    routeCatalogueVersion: varchar('route_catalog_version', {
      length: 64,
    }).notNull(),
    capabilityPolicyVersion: varchar('capability_policy_version', {
      length: 32,
    }).notNull(),
    executionPolicyVersion: varchar('execution_policy_version', {
      length: 32,
    }).notNull(),
    migrationHead: varchar('migration_head', { length: 255 }).notNull(),
    evidenceIndex: jsonb('evidence_index')
      .$type<GoogleContentEvidenceIndex & Readonly<{ sha256: string }>>()
      .notNull(),
    imageDigests: jsonb('image_digests')
      .$type<
        Readonly<{
          web: string
          worker: string
          googleExecutionAdmission: string
          googleEgressGateway: string
          providerEphemeralRedis: string
        }>
      >()
      .notNull(),
    roleApprovals: jsonb('role_approvals')
      .$type<
        ReadonlyArray<
          Readonly<{
            sha256: string
            document: GoogleContentApprovalRoleDocument
          }>
        >
      >()
      .notNull(),
    approvedAt: timestamptz('approved_at').notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    status: googleContentApprovalStatusEnum('status').notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    uniqueIndex('capability_compliance_approvals_version_key').on(
      table.capability,
      table.targetPhase,
      table.environmentProfile,
      table.bindingVersion,
    ),
    index('capability_compliance_approvals_active_idx').on(
      table.capability,
      table.status,
      table.expiresAt,
    ),
    check(
      'capability_compliance_approvals_window_check',
      sql`${table.expiresAt} > ${table.approvedAt}`,
    ),
    check(
      'capability_compliance_approvals_phase_profile_check',
      sql`(
        (${table.targetPhase} = 'railway_closed_beta'
          AND ${table.environmentProfile} = 'railway-closed-beta-1'
          AND ${table.runtimeIsolationProfileVersion} IS NULL
          AND ${table.runtimeIsolationProfileSha256} IS NULL
          AND ${table.railwayClosedBetaCohort} IS NOT NULL
          AND ${table.railwayClosedBetaCohortSha256} IS NOT NULL
          AND ${table.railwayClosedBetaResidualRiskSha256} IS NOT NULL)
        OR
        (${table.targetPhase} <> 'railway_closed_beta'
          AND ((${table.targetPhase} = 'local_sandbox' AND ${table.environmentProfile} = 'sandbox')
            OR (${table.targetPhase} IN ('production_expand_canary', 'production_final')
              AND ${table.environmentProfile} = 'production'))
          AND ${table.runtimeIsolationProfileVersion} = 'google-content-egress-1'
          AND ${table.runtimeIsolationProfileSha256} IS NOT NULL
          AND ${table.railwayClosedBetaCohort} IS NULL
          AND ${table.railwayClosedBetaCohortSha256} IS NULL
          AND ${table.railwayClosedBetaResidualRiskSha256} IS NULL)
      )`,
    ),
  ],
)

export const capabilityExecutionControl = pgTable(
  'capability_execution_control',
  {
    capability: googleContentCapabilityEnum('capability').primaryKey(),
    denied: boolean('denied').notNull().default(true),
    emergencyKillVersion: generation('emergency_kill_version').notNull().default(0),
    deniedAt: timestamptz('denied_at'),
    drainedAt: timestamptz('drained_at'),
    cleanupDrainedAt: timestamptz('cleanup_drained_at'),
    operatorId: varchar('operator_id', { length: 255 }),
    reason: varchar('reason', { length: 500 }),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    check(
      'capability_execution_control_denied_check',
      sql`(${table.denied} AND ${table.deniedAt} IS NOT NULL) OR (NOT ${table.denied} AND ${table.deniedAt} IS NULL AND ${table.drainedAt} IS NULL AND ${table.cleanupDrainedAt} IS NULL)`,
    ),
  ],
)

export const authorizationExecutionPermits = pgTable(
  'authorization_execution_permits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    scopeSchemaVersion: integer('scope_schema_version').notNull().default(1),
    capability: googleContentCapabilityEnum('capability').notNull(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id'),
    connectionId: uuid('connection_id'),
    initiatorUserId: varchar('initiator_user_id', { length: 255 }),
    operationKey: varchar('operation_key', { length: 128 }).notNull(),
    routeKey: varchar('route_key', { length: 160 }).notNull(),
    routeCatalogVersion: varchar('route_catalog_version', { length: 64 }).notNull(),
    quotaPolicyId: varchar('quota_policy_id', { length: 128 }).notNull(),
    policyVersion: generation('policy_version').notNull(),
    emergencyKillVersion: generation('emergency_kill_version').notNull(),
    approvalBindingId: uuid('approval_binding_id')
      .notNull()
      .references(() => capabilityComplianceApprovals.id, { onDelete: 'restrict' }),
    permitGeneration: generation('permit_generation').notNull(),
    startVectorMode: authorizationCommitVectorModeEnum('start_vector_mode').notNull(),
    commitVectorMode: authorizationCommitVectorModeEnum('commit_vector_mode').notNull(),
    authorizationVector: jsonb('authorization_vector')
      .$type<Readonly<Record<string, string | number | boolean | null>>>()
      .notNull(),
    state: authorizationExecutionPermitStateEnum('state').notNull(),
    admittedAt: timestamptz('admitted_at').notNull(),
    startDeadlineAt: timestamptz('start_deadline_at').notNull(),
    startedAt: timestamptz('started_at'),
    operationDeadlineAt: timestamptz('operation_deadline_at'),
    completedAt: timestamptz('completed_at'),
    fencedAt: timestamptz('fenced_at'),
    correlationId: varchar('correlation_id', { length: 255 }),
    createdAt: createdAtColumn(),
  },
  (table) => [
    index('authorization_execution_permits_active_idx').on(
      table.capability,
      table.state,
      table.startDeadlineAt,
      table.operationDeadlineAt,
    ),
    index('authorization_execution_permits_scope_idx').on(
      table.organizationId,
      table.propertyId,
      table.connectionId,
    ),
    check(
      'authorization_execution_permits_start_window_check',
      sql`${table.startDeadlineAt} > ${table.admittedAt}`,
    ),
    check(
      'authorization_execution_permits_operation_window_check',
      sql`${table.operationDeadlineAt} IS NULL OR (${table.startedAt} IS NOT NULL AND ${table.operationDeadlineAt} > ${table.startedAt})`,
    ),
    check(
      'authorization_execution_permits_state_check',
      sql`(${table.state} = 'admitted' AND ${table.startedAt} IS NULL AND ${table.operationDeadlineAt} IS NULL AND ${table.completedAt} IS NULL) OR (${table.state} = 'started' AND ${table.startedAt} IS NOT NULL AND ${table.operationDeadlineAt} IS NOT NULL AND ${table.completedAt} IS NULL) OR (${table.state} = 'completed' AND ${table.startedAt} IS NOT NULL AND ${table.operationDeadlineAt} IS NOT NULL AND ${table.completedAt} IS NOT NULL) OR (${table.state} = 'fenced' AND ${table.fencedAt} IS NOT NULL)`,
    ),
  ],
)

export const googleSubjectAuthorityGuards = pgTable(
  'google_subject_authority_guards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectClientHmacKeyVersion: varchar('project_client_hmac_key_version', {
      length: 50,
    }).notNull(),
    projectClientHmac: varchar('project_client_hmac', { length: 128 }).notNull(),
    subjectHmacKeyVersion: varchar('subject_hmac_key_version', { length: 50 }).notNull(),
    subjectHmac: varchar('subject_hmac', { length: 128 }).notNull(),
    generation: generation('generation').notNull().default(0),
    nextSequence: generation('next_sequence').notNull().default(1),
    sourceCutoffSequence: generation('source_cutoff_sequence'),
    activeSourceOperationId: uuid('active_source_operation_id'),
    state: googleSubjectAuthorityGuardStateEnum('state').notNull().default('open'),
    cleanupDeadlineAt: timestamptz('cleanup_deadline_at'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    uniqueIndex('google_subject_authority_guards_subject_key').on(
      table.projectClientHmacKeyVersion,
      table.projectClientHmac,
      table.subjectHmacKeyVersion,
      table.subjectHmac,
    ),
    index('google_subject_authority_guards_active_idx').on(
      table.state,
      table.cleanupDeadlineAt,
    ),
    check(
      'google_subject_authority_guards_sequence_check',
      sql`${table.nextSequence} >= 1 AND (${table.sourceCutoffSequence} IS NULL OR ${table.sourceCutoffSequence} < ${table.nextSequence})`,
    ),
  ],
)

export const googleCredentialSourceOperations = pgTable(
  'google_credential_source_operations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guardId: uuid('guard_id')
      .notNull()
      .references(() => googleSubjectAuthorityGuards.id, { onDelete: 'restrict' }),
    sourceWorkPermitId: uuid('source_work_permit_id')
      .notNull()
      .references(() => authorizationExecutionPermits.id, { onDelete: 'restrict' }),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    connectionId: uuid('connection_id'),
    sequence: generation('sequence').notNull(),
    kind: googleCredentialSourceKindEnum('kind').notNull(),
    state: googleCredentialSourceStateEnum('state').notNull(),
    expectedLifecycleVersion: generation('expected_lifecycle_version').notNull(),
    expectedAccessVersion: generation('expected_access_version').notNull(),
    expectedCredentialGeneration: generation('expected_credential_generation').notNull(),
    operationDeadlineAt: timestamptz('operation_deadline_at').notNull(),
    providerStartedAt: timestamptz('provider_started_at'),
    terminalAt: timestamptz('terminal_at'),
    outcomeCode: varchar('outcome_code', { length: 100 }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    uniqueIndex('google_credential_source_operations_guard_sequence_key').on(
      table.guardId,
      table.sequence,
    ),
    uniqueIndex('google_credential_source_operations_one_active_idx')
      .on(table.guardId)
      .where(
        sql`${table.state} IN ('registered', 'provider_started', 'provider_outcome_ambiguous')`,
      ),
    index('google_credential_source_operations_active_idx').on(
      table.guardId,
      table.state,
      table.operationDeadlineAt,
    ),
    check(
      'google_credential_source_operations_sequence_check',
      sql`${table.sequence} >= 1`,
    ),
    check(
      'google_credential_source_operations_deadline_check',
      sql`${table.operationDeadlineAt} > ${table.createdAt}`,
    ),
    check(
      'google_credential_source_operations_state_check',
      sql`(${table.state} = 'registered' AND ${table.providerStartedAt} IS NULL AND ${table.terminalAt} IS NULL) OR (${table.state} IN ('provider_started', 'provider_outcome_ambiguous') AND ${table.providerStartedAt} IS NOT NULL AND ${table.terminalAt} IS NULL) OR (${table.state} IN ('terminal', 'provider_reset_terminal') AND ${table.terminalAt} IS NOT NULL)`,
    ),
  ],
)

export const credentialRevokePermits = pgTable(
  'credential_revoke_permits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guardId: uuid('guard_id')
      .notNull()
      .references(() => googleSubjectAuthorityGuards.id, { onDelete: 'restrict' }),
    sourceOperationId: uuid('source_operation_id')
      .notNull()
      .references(() => googleCredentialSourceOperations.id, { onDelete: 'restrict' }),
    cleanupWorkPermitId: uuid('cleanup_work_permit_id').references(
      () => authorizationExecutionPermits.id,
      { onDelete: 'restrict' },
    ),
    state: credentialRevokePermitStateEnum('state').notNull(),
    tokenHmacKeyVersion: varchar('token_hmac_key_version', { length: 50 }),
    tokenHmac: varchar('token_hmac', { length: 128 }),
    cleanupDeadlineAt: timestamptz('cleanup_deadline_at').notNull(),
    sendAuthorizationExpiresAt: timestamptz('send_authorization_expires_at'),
    activatedAt: timestamptz('activated_at'),
    dispatchingAt: timestamptz('dispatching_at'),
    terminalAt: timestamptz('terminal_at'),
    outcomeCode: varchar('outcome_code', { length: 100 }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    index('credential_revoke_permits_active_idx').on(
      table.guardId,
      table.state,
      table.cleanupDeadlineAt,
    ),
    check(
      'credential_revoke_permits_send_window_check',
      sql`${table.sendAuthorizationExpiresAt} IS NULL OR ${table.sendAuthorizationExpiresAt} <= ${table.cleanupDeadlineAt}`,
    ),
    check(
      'credential_revoke_permits_hmac_pair_check',
      sql`(${table.tokenHmacKeyVersion} IS NULL) = (${table.tokenHmac} IS NULL)`,
    ),
    check(
      'credential_revoke_permits_state_check',
      sql`(${table.state} = 'dormant' AND ${table.tokenHmac} IS NULL AND ${table.sendAuthorizationExpiresAt} IS NULL AND ${table.dispatchingAt} IS NULL AND ${table.terminalAt} IS NULL) OR (${table.state} = 'active' AND ${table.tokenHmac} IS NOT NULL AND ${table.sendAuthorizationExpiresAt} IS NOT NULL AND ${table.activatedAt} IS NOT NULL AND ${table.dispatchingAt} IS NULL AND ${table.terminalAt} IS NULL) OR (${table.state} = 'dispatching' AND ${table.tokenHmac} IS NULL AND ${table.sendAuthorizationExpiresAt} IS NULL AND ${table.dispatchingAt} IS NOT NULL AND ${table.terminalAt} IS NULL) OR (${table.state} IN ('consumed_no_revoke', 'confirmed_not_sent', 'confirmed_revoked', 'cleanup_ambiguous', 'provider_reset_confirmed') AND ${table.tokenHmac} IS NULL AND ${table.sendAuthorizationExpiresAt} IS NULL AND ${table.terminalAt} IS NOT NULL)`,
    ),
  ],
)

/**
 * Crash boundary for a one-use OAuth authorization code. Provider material is
 * present only as one application-encrypted envelope, and only between the
 * successful token response and the atomic connection/audit commit.
 */
export const googleOauthExchangeAttempts = pgTable(
  'google_oauth_exchange_attempts',
  {
    id: uuid('id').primaryKey(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    initiatorUserId: varchar('initiator_user_id', { length: 255 }).notNull(),
    connectionId: uuid('connection_id').notNull(),
    connectionMode: varchar('connection_mode', { length: 16 }).notNull(),
    targetConnectionId: uuid('target_connection_id'),
    state: googleOauthExchangeAttemptStateEnum('state').notNull(),
    expectedLifecycleVersion: generation('expected_lifecycle_version').notNull(),
    expectedAccessVersion: generation('expected_access_version').notNull(),
    expectedCredentialGeneration: generation('expected_credential_generation').notNull(),
    credentialHomeCellId: varchar('credential_home_cell_id', {
      length: 16,
    }).notNull(),
    credentialHomePolicyVersion: integer('credential_home_policy_version').notNull(),
    credentialHomeAuthorityGeneration: integer(
      'credential_home_authority_generation',
    ).notNull(),
    encryptedResult: text('encrypted_result'),
    providerStartedAt: timestamptz('provider_started_at'),
    preservedAt: timestamptz('preserved_at'),
    responseExpiresAt: timestamptz('response_expires_at'),
    applyLeaseExpiresAt: timestamptz('apply_lease_expires_at'),
    terminalAt: timestamptz('terminal_at'),
    outcomeCode: varchar('outcome_code', { length: 100 }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    index('google_oauth_exchange_attempts_recovery_idx').on(
      table.state,
      table.responseExpiresAt,
      table.applyLeaseExpiresAt,
    ),
    index('google_oauth_exchange_attempts_scope_idx').on(
      table.organizationId,
      table.initiatorUserId,
      table.createdAt,
    ),
    check(
      'google_oauth_exchange_attempts_target_check',
      sql`(${table.connectionMode} = 'new' AND ${table.targetConnectionId} IS NULL) OR (${table.connectionMode} IN ('reauth', 'reconnect') AND ${table.targetConnectionId} = ${table.connectionId})`,
    ),
    check(
      'google_oauth_exchange_attempts_versions_check',
      sql`${table.expectedLifecycleVersion} >= 0 AND ${table.expectedAccessVersion} >= 0 AND ${table.expectedCredentialGeneration} >= 0`,
    ),
    check(
      'google_oauth_exchange_attempts_home_check',
      sql`${table.credentialHomeCellId} IN ('us', 'europe', 'global') AND ${table.credentialHomePolicyVersion} >= 1 AND ${table.credentialHomeAuthorityGeneration} >= 1`,
    ),
    check(
      'google_oauth_exchange_attempts_state_check',
      sql`(${table.state} = 'prepared' AND ${table.providerStartedAt} IS NULL AND ${table.encryptedResult} IS NULL AND ${table.preservedAt} IS NULL AND ${table.responseExpiresAt} IS NULL AND ${table.applyLeaseExpiresAt} IS NULL AND ${table.terminalAt} IS NULL) OR (${table.state} = 'provider_started' AND ${table.providerStartedAt} IS NOT NULL AND ${table.encryptedResult} IS NULL AND ${table.preservedAt} IS NULL AND ${table.responseExpiresAt} IS NULL AND ${table.applyLeaseExpiresAt} IS NULL AND ${table.terminalAt} IS NULL) OR (${table.state} = 'response_preserved' AND ${table.providerStartedAt} IS NOT NULL AND ${table.encryptedResult} IS NOT NULL AND ${table.preservedAt} IS NOT NULL AND ${table.responseExpiresAt} > ${table.preservedAt} AND ${table.applyLeaseExpiresAt} IS NULL AND ${table.terminalAt} IS NULL) OR (${table.state} = 'applying' AND ${table.providerStartedAt} IS NOT NULL AND ${table.encryptedResult} IS NOT NULL AND ${table.preservedAt} IS NOT NULL AND ${table.responseExpiresAt} > ${table.preservedAt} AND ${table.applyLeaseExpiresAt} IS NOT NULL AND ${table.applyLeaseExpiresAt} <= ${table.responseExpiresAt} AND ${table.terminalAt} IS NULL) OR (${table.state} IN ('completed', 'failed', 'provider_outcome_ambiguous', 'expired') AND ${table.encryptedResult} IS NULL AND ${table.responseExpiresAt} IS NULL AND ${table.applyLeaseExpiresAt} IS NULL AND ${table.terminalAt} IS NOT NULL)`,
    ),
  ],
)

/**
 * Disconnect-specific cleanup authority. It binds one exact token digest to
 * one admitted execution permit and retains only content-free outcome facts.
 */
export const googleDisconnectRevokeAttempts = pgTable(
  'google_disconnect_revoke_attempts',
  {
    id: uuid('id').primaryKey(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    connectionId: uuid('connection_id').notNull(),
    initiatorUserId: varchar('initiator_user_id', { length: 255 }).notNull(),
    cleanupWorkPermitId: uuid('cleanup_work_permit_id').references(
      () => authorizationExecutionPermits.id,
      { onDelete: 'restrict' },
    ),
    state: googleDisconnectRevokeAttemptStateEnum('state').notNull(),
    expectedLifecycleVersion: generation('expected_lifecycle_version').notNull(),
    expectedAccessVersion: generation('expected_access_version').notNull(),
    expectedCredentialGeneration: generation('expected_credential_generation').notNull(),
    credentialBinding: varchar('credential_binding', { length: 64 }),
    cleanupDeadlineAt: timestamptz('cleanup_deadline_at').notNull(),
    activatedAt: timestamptz('activated_at').notNull(),
    dispatchingAt: timestamptz('dispatching_at'),
    terminalAt: timestamptz('terminal_at'),
    outcomeCode: varchar('outcome_code', { length: 100 }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    foreignKey({
      name: 'google_disconnect_revoke_attempts_connection_fk',
      columns: [table.organizationId, table.connectionId],
      foreignColumns: [googleConnections.organizationId, googleConnections.id],
    }).onDelete('restrict'),
    uniqueIndex('google_disconnect_revoke_attempts_permit_key')
      .on(table.cleanupWorkPermitId)
      .where(sql`${table.cleanupWorkPermitId} IS NOT NULL`),
    uniqueIndex('google_disconnect_revoke_attempts_one_active_idx')
      .on(table.organizationId, table.connectionId)
      .where(sql`${table.state} IN ('active', 'dispatching')`),
    index('google_disconnect_revoke_attempts_recovery_idx').on(
      table.state,
      table.cleanupDeadlineAt,
    ),
    check(
      'google_disconnect_revoke_attempts_versions_check',
      sql`${table.expectedLifecycleVersion} >= 1 AND ${table.expectedAccessVersion} >= 1 AND ${table.expectedCredentialGeneration} >= 1`,
    ),
    check(
      'google_disconnect_revoke_attempts_window_check',
      sql`${table.cleanupDeadlineAt} > ${table.activatedAt} AND ${table.cleanupDeadlineAt} <= ${table.activatedAt} + interval '00:01:00'`,
    ),
    check(
      'google_disconnect_revoke_attempts_state_check',
      sql`(${table.state} = 'active' AND ${table.cleanupWorkPermitId} IS NULL AND ${table.credentialBinding} ~ '^[a-f0-9]{64}$' AND ${table.dispatchingAt} IS NULL AND ${table.terminalAt} IS NULL) OR (${table.state} = 'dispatching' AND ${table.cleanupWorkPermitId} IS NOT NULL AND ${table.credentialBinding} IS NULL AND ${table.dispatchingAt} IS NOT NULL AND ${table.terminalAt} IS NULL) OR (${table.state} IN ('confirmed_not_sent', 'confirmed_revoked', 'cleanup_ambiguous') AND ${table.credentialBinding} IS NULL AND ${table.terminalAt} IS NOT NULL)`,
    ),
  ],
)
