// Identity-owned Organization lifecycle authority (LIF-01).
//
// Better Auth continues to own the Organization entity. These tables own the
// application lifecycle and its retry evidence: a closure fence must remain
// representable independently of Better Auth deletion and provider state.

import { sql, desc } from 'drizzle-orm'
import {
  boolean,
  char,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

const timestamptz = (name: string) => timestamp(name, { withTimezone: true })

export const organizationLifecycleAuthority = pgTable(
  'organization_lifecycle_authority',
  {
    organizationId: text('organization_id').primaryKey(),
    state: text('state').notNull().default('active'),
    revision: integer('revision').notNull().default(0),
    closureLineageId: uuid('closure_lineage_id'),
    closureRequestedAt: timestamptz('closure_requested_at'),
    recoverableUntil: timestamptz('recoverable_until'),
    irreversibleAt: timestamptz('irreversible_at'),
    closedAt: timestamptz('closed_at'),
    reactivationRequired: boolean('reactivation_required').notNull().default(false),
    requestedBy: varchar('requested_by', { length: 255 }),
    requestReasonCode: varchar('request_reason_code', { length: 64 }),
    requestSupportEvidenceRef: varchar('request_support_evidence_ref', {
      length: 200,
    }),
    lastTransitionAt: timestamptz('last_transition_at').notNull().defaultNow(),
    lastActorId: varchar('last_actor_id', { length: 255 }).notNull(),
    lastReasonCode: varchar('last_reason_code', { length: 64 }).notNull(),
    lastSupportEvidenceRef: varchar('last_support_evidence_ref', {
      length: 200,
    }).notNull(),
  },
  (t) => [
    check(
      'organization_lifecycle_state_valid',
      sql`${t.state} IN ('active', 'closure_requested', 'closing', 'purge_pending', 'purging', 'closed')`,
    ),
    check('organization_lifecycle_revision_nonnegative', sql`${t.revision} >= 0`),
    check(
      'organization_lifecycle_request_reason_valid',
      sql`${t.requestReasonCode} IS NULL OR ${t.requestReasonCode} IN ('account_admin_request', 'contract_ended', 'duplicate_workspace', 'privacy_request', 'test_workspace')`,
    ),
    check(
      'organization_lifecycle_evidence_ref_valid',
      sql`${t.lastSupportEvidenceRef} ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$'
          AND (${t.requestSupportEvidenceRef} IS NULL OR ${t.requestSupportEvidenceRef} ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$')`,
    ),
    check(
      'organization_lifecycle_reason_code_valid',
      sql`${t.lastReasonCode} ~ '^[a-z][a-z0-9_]{0,63}$'`,
    ),
    check(
      'organization_lifecycle_state_shape',
      sql`(
        ${t.state} = 'active'
        AND ${t.irreversibleAt} IS NULL
        AND ${t.closedAt} IS NULL
        AND (
          (${t.closureLineageId} IS NULL AND ${t.closureRequestedAt} IS NULL AND ${t.recoverableUntil} IS NULL AND ${t.requestedBy} IS NULL AND ${t.requestReasonCode} IS NULL AND ${t.requestSupportEvidenceRef} IS NULL AND ${t.reactivationRequired} = false)
          OR
          (${t.closureLineageId} IS NOT NULL AND ${t.closureRequestedAt} IS NOT NULL AND ${t.recoverableUntil} > ${t.closureRequestedAt} AND ${t.requestedBy} IS NOT NULL AND ${t.requestReasonCode} IS NOT NULL AND ${t.requestSupportEvidenceRef} IS NOT NULL AND ${t.reactivationRequired} = true)
        )
      ) OR (
        ${t.state} IN ('closure_requested', 'closing', 'purge_pending')
        AND ${t.closureLineageId} IS NOT NULL
        AND ${t.closureRequestedAt} IS NOT NULL
        AND ${t.recoverableUntil} > ${t.closureRequestedAt}
        AND ${t.requestedBy} IS NOT NULL
        AND ${t.requestReasonCode} IS NOT NULL
        AND ${t.requestSupportEvidenceRef} IS NOT NULL
        AND ${t.irreversibleAt} IS NULL
        AND ${t.closedAt} IS NULL
        AND ${t.reactivationRequired} = true
      ) OR (
        ${t.state} = 'purging'
        AND ${t.closureLineageId} IS NOT NULL
        AND ${t.closureRequestedAt} IS NOT NULL
        AND ${t.recoverableUntil} > ${t.closureRequestedAt}
        AND ${t.requestedBy} IS NOT NULL
        AND ${t.requestReasonCode} IS NOT NULL
        AND ${t.requestSupportEvidenceRef} IS NOT NULL
        AND ${t.irreversibleAt} IS NOT NULL
        AND ${t.closedAt} IS NULL
        AND ${t.reactivationRequired} = true
      ) OR (
        ${t.state} = 'closed'
        AND ${t.closureLineageId} IS NOT NULL
        AND ${t.closureRequestedAt} IS NOT NULL
        AND ${t.recoverableUntil} > ${t.closureRequestedAt}
        AND ${t.requestedBy} IS NOT NULL
        AND ${t.requestReasonCode} IS NOT NULL
        AND ${t.requestSupportEvidenceRef} IS NOT NULL
        AND ${t.irreversibleAt} IS NOT NULL
        AND ${t.closedAt} IS NOT NULL
        AND ${t.reactivationRequired} = true
      )`,
    ),
    index('organization_lifecycle_state_deadline_idx').on(t.state, t.recoverableUntil),
    index('organization_lifecycle_transition_idx').on(desc(t.lastTransitionAt)),
  ],
)

export const organizationLifecycleCommandReceipts = pgTable(
  'organization_lifecycle_command_receipts',
  {
    operationId: uuid('operation_id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    operation: text('operation').notNull(),
    resultState: text('result_state').notNull(),
    resultRevision: integer('result_revision').notNull(),
    closureLineageId: uuid('closure_lineage_id'),
    closureRequestedAt: timestamptz('closure_requested_at'),
    recoverableUntil: timestamptz('recoverable_until'),
    irreversibleAt: timestamptz('irreversible_at'),
    closedAt: timestamptz('closed_at'),
    reactivationRequired: boolean('reactivation_required').notNull(),
    lastTransitionAt: timestamptz('last_transition_at').notNull(),
    lastActorId: varchar('last_actor_id', { length: 255 }).notNull(),
    lastReasonCode: varchar('last_reason_code', { length: 64 }).notNull(),
    lastSupportEvidenceRef: varchar('last_support_evidence_ref', {
      length: 200,
    }).notNull(),
    occurredAt: timestamptz('occurred_at').notNull().defaultNow(),
  },
  (t) => [
    check(
      'organization_lifecycle_receipt_operation_valid',
      sql`${t.operation} IN ('request', 'cancel')`,
    ),
    check(
      'organization_lifecycle_receipt_state_valid',
      sql`${t.resultState} IN ('active', 'closure_requested', 'closing', 'purge_pending', 'purging', 'closed')`,
    ),
    check(
      'organization_lifecycle_receipt_revision_positive',
      sql`${t.resultRevision} > 0`,
    ),
    index('organization_lifecycle_receipt_org_time_idx').on(
      t.organizationId,
      desc(t.occurredAt),
    ),
  ],
)

/**
 * Identity-owned phase receipts for context-local lifecycle work.
 *
 * The coordinator's transition digest is not proof that a context mutation
 * committed. This table lets an Identity contributor co-commit its mutation
 * and a content-free, replayable result for the exact lineage/revision/phase.
 * It intentionally has no Organization foreign key so closure evidence can
 * survive removal of the Better Auth Organization row.
 */
export const identityOrganizationLifecycleReceipts = pgTable(
  'identity_organization_lifecycle_receipts',
  {
    organizationId: text('organization_id').notNull(),
    closureLineageId: uuid('closure_lineage_id').notNull(),
    lifecycleRevision: integer('lifecycle_revision').notNull(),
    phase: text('phase').notNull(),
    requestFingerprint: char('request_fingerprint', { length: 64 }).notNull(),
    outcome: text('outcome').notNull(),
    evidenceRef: varchar('evidence_ref', { length: 200 }).notNull(),
    recoverableUntil: timestamptz('recoverable_until').notNull(),
    occurredAt: timestamptz('occurred_at').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({
      columns: [t.closureLineageId, t.lifecycleRevision, t.phase],
      name: 'identity_organization_lifecycle_receipts_pk',
    }),
    check(
      'identity_organization_lifecycle_receipts_revision_positive',
      sql`${t.lifecycleRevision} > 0`,
    ),
    check(
      'identity_organization_lifecycle_receipts_phase_valid',
      sql`${t.phase} IN ('closing', 'purge_readiness', 'purge')`,
    ),
    check(
      'identity_organization_lifecycle_receipts_outcome_valid',
      sql`${t.outcome} IN ('complete', 'no_data')`,
    ),
    check(
      'identity_organization_lifecycle_receipts_fingerprint_valid',
      sql`${t.requestFingerprint} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      'identity_organization_lifecycle_receipts_evidence_valid',
      sql`${t.evidenceRef} ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$'`,
    ),
    index('identity_organization_lifecycle_receipts_org_time_idx').on(
      t.organizationId,
      desc(t.occurredAt),
    ),
  ],
)

export const organizationExports = pgTable(
  'organization_exports',
  {
    id: uuid('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    requestedBy: varchar('requested_by', { length: 255 }).notNull(),
    state: text('state').notNull().default('requested'),
    revision: integer('revision').notNull().default(1),
    formatVersion: varchar('format_version', { length: 64 })
      .notNull()
      .default('organization-export/v1'),
    asOf: timestamptz('as_of').notNull(),
    objectExpiresAt: timestamptz('object_expires_at').notNull(),
    generationLeaseExpiresAt: timestamptz('generation_lease_expires_at'),
    coverageSha256: varchar('coverage_sha256', { length: 64 }),
    manifestSha256: varchar('manifest_sha256', { length: 64 }),
    archiveSha256: varchar('archive_sha256', { length: 64 }),
    objectKey: varchar('object_key', { length: 200 }),
    encryptionEvidenceRef: varchar('encryption_evidence_ref', { length: 200 }),
    /**
     * Set BEFORE the archive leaves the process. Its presence is what makes a
     * post-upload/pre-completion crash recoverable: the digests and object key
     * beside it were durable before egress, so a reclaimed lease can verify
     * the stored object instead of rebuilding a later live snapshot.
     */
    preEgressRecordedAt: timestamptz('pre_egress_recorded_at'),
    egressRecoveryAttempts: integer('egress_recovery_attempts').notNull().default(0),
    retrievalOperationId: uuid('retrieval_operation_id'),
    retrievalTokenDigest: varchar('retrieval_token_digest', { length: 64 }),
    retrievalIssuedAt: timestamptz('retrieval_issued_at'),
    retrievalExpiresAt: timestamptz('retrieval_expires_at'),
    retrievedAt: timestamptz('retrieved_at'),
    deletionEvidenceRef: varchar('deletion_evidence_ref', { length: 200 }),
    deletedAt: timestamptz('deleted_at'),
    lastErrorCode: varchar('last_error_code', { length: 64 }),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    check(
      'organization_export_state_valid',
      sql`${t.state} IN ('requested', 'generating', 'egress_pending', 'ready', 'retrieval_issued', 'retrieved', 'delete_pending', 'deleted', 'failed')`,
    ),
    check('organization_export_revision_positive', sql`${t.revision} >= 1`),
    check(
      'organization_export_recovery_attempts_nonnegative',
      sql`${t.egressRecoveryAttempts} >= 0`,
    ),
    check(
      'organization_export_version_fixed',
      sql`${t.formatVersion} = 'organization-export/v1'`,
    ),
    check(
      'organization_export_object_expiry_bounded',
      sql`${t.objectExpiresAt} > ${t.createdAt} AND ${t.objectExpiresAt} <= ${t.createdAt} + interval '7 days'`,
    ),
    check(
      'organization_export_digest_shape',
      sql`(${t.coverageSha256} IS NULL OR ${t.coverageSha256} ~ '^[a-f0-9]{64}$')
          AND (${t.manifestSha256} IS NULL OR ${t.manifestSha256} ~ '^[a-f0-9]{64}$')
          AND (${t.archiveSha256} IS NULL OR ${t.archiveSha256} ~ '^[a-f0-9]{64}$')
          AND (${t.retrievalTokenDigest} IS NULL OR ${t.retrievalTokenDigest} ~ '^[a-f0-9]{64}$')`,
    ),
    check(
      'organization_export_evidence_ref_shape',
      sql`(${t.encryptionEvidenceRef} IS NULL OR ${t.encryptionEvidenceRef} ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$')
          AND (${t.deletionEvidenceRef} IS NULL OR ${t.deletionEvidenceRef} ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$')`,
    ),
    check(
      'organization_export_error_code_shape',
      sql`${t.lastErrorCode} IS NULL OR ${t.lastErrorCode} ~ '^[a-z][a-z0-9_]{0,63}$'`,
    ),
    check(
      'organization_export_state_shape',
      sql`(
        ${t.state} = 'requested'
        AND ${t.generationLeaseExpiresAt} IS NULL
        AND ${t.coverageSha256} IS NULL
        AND ${t.manifestSha256} IS NULL
        AND ${t.archiveSha256} IS NULL
        AND ${t.objectKey} IS NULL
        AND ${t.encryptionEvidenceRef} IS NULL
        AND ${t.preEgressRecordedAt} IS NULL
        AND ${t.lastErrorCode} IS NULL
      ) OR (
        ${t.state} = 'generating'
        AND ${t.generationLeaseExpiresAt} IS NOT NULL
        AND ${t.coverageSha256} IS NULL
        AND ${t.manifestSha256} IS NULL
        AND ${t.archiveSha256} IS NULL
        AND ${t.objectKey} IS NULL
        AND ${t.encryptionEvidenceRef} IS NULL
        AND ${t.preEgressRecordedAt} IS NULL
        AND ${t.lastErrorCode} IS NULL
      ) OR (
        ${t.state} = 'egress_pending'
        AND ${t.generationLeaseExpiresAt} IS NOT NULL
        AND ${t.coverageSha256} IS NOT NULL
        AND ${t.manifestSha256} IS NOT NULL
        AND ${t.archiveSha256} IS NOT NULL
        AND ${t.objectKey} IS NOT NULL
        AND ${t.encryptionEvidenceRef} IS NULL
        AND ${t.preEgressRecordedAt} IS NOT NULL
        AND ${t.lastErrorCode} IS NULL
      ) OR (
        ${t.state} IN ('ready', 'retrieval_issued', 'retrieved', 'delete_pending', 'deleted')
        AND ${t.generationLeaseExpiresAt} IS NULL
        AND ${t.coverageSha256} IS NOT NULL
        AND ${t.manifestSha256} IS NOT NULL
        AND ${t.archiveSha256} IS NOT NULL
        AND ${t.objectKey} IS NOT NULL
        AND ${t.encryptionEvidenceRef} IS NOT NULL
        AND ${t.lastErrorCode} IS NULL
      ) OR (
        ${t.state} = 'failed'
        AND ${t.generationLeaseExpiresAt} IS NULL
        AND ${t.encryptionEvidenceRef} IS NULL
        AND ${t.lastErrorCode} IS NOT NULL
        AND (
          (
            ${t.coverageSha256} IS NULL
            AND ${t.manifestSha256} IS NULL
            AND ${t.archiveSha256} IS NULL
            AND ${t.objectKey} IS NULL
            AND ${t.preEgressRecordedAt} IS NULL
          ) OR (
            ${t.coverageSha256} IS NOT NULL
            AND ${t.manifestSha256} IS NOT NULL
            AND ${t.archiveSha256} IS NOT NULL
            AND ${t.objectKey} IS NOT NULL
            AND ${t.preEgressRecordedAt} IS NOT NULL
          )
        )
      )`,
    ),
    check(
      'organization_export_retrieval_shape',
      sql`(
        ${t.state} = 'retrieval_issued'
        AND ${t.retrievalOperationId} IS NOT NULL
        AND ${t.retrievalTokenDigest} IS NOT NULL
        AND ${t.retrievalIssuedAt} IS NOT NULL
        AND ${t.retrievalExpiresAt} > ${t.retrievalIssuedAt}
        AND ${t.retrievalExpiresAt} <= ${t.retrievalIssuedAt} + interval '24 hours'
        AND ${t.retrievalExpiresAt} <= ${t.objectExpiresAt}
        AND ${t.retrievedAt} IS NULL
      ) OR (
        ${t.state} = 'retrieved'
        AND ${t.retrievalOperationId} IS NOT NULL
        AND ${t.retrievalTokenDigest} IS NULL
        AND ${t.retrievalIssuedAt} IS NOT NULL
        AND ${t.retrievalExpiresAt} IS NULL
        AND ${t.retrievedAt} IS NOT NULL
      ) OR (
        ${t.state} NOT IN ('retrieval_issued', 'retrieved')
        AND ${t.retrievalOperationId} IS NULL
        AND ${t.retrievalTokenDigest} IS NULL
        AND ${t.retrievalIssuedAt} IS NULL
        AND ${t.retrievalExpiresAt} IS NULL
        AND ${t.retrievedAt} IS NULL
      )`,
    ),
    check(
      'organization_export_deletion_shape',
      sql`(
        ${t.state} = 'deleted'
        AND ${t.deletedAt} IS NOT NULL
        AND ${t.deletionEvidenceRef} IS NOT NULL
      ) OR (
        ${t.state} <> 'deleted'
        AND ${t.deletedAt} IS NULL
        AND ${t.deletionEvidenceRef} IS NULL
      )`,
    ),
    uniqueIndex('organization_exports_one_open_per_org_idx')
      .on(t.organizationId)
      .where(
        sql`${t.state} IN ('requested', 'generating', 'egress_pending', 'ready', 'retrieval_issued')`,
      ),
    index('organization_exports_generation_idx').on(
      t.state,
      t.generationLeaseExpiresAt,
      t.createdAt,
    ),
    index('organization_exports_expiry_idx').on(t.state, t.objectExpiresAt),
    index('organization_exports_pre_egress_idx').on(t.state, t.preEgressRecordedAt),
  ],
)

/**
 * Append-only retrieval authority history.
 *
 * The mutable export head erases a digest after consumption and rotates it
 * after expiry. Retaining each digest and operation id here makes every old
 * token permanently single-use without retaining the raw retrieval secret.
 */
export const organizationExportRetrievalIssuances = pgTable(
  'organization_export_retrieval_issuances',
  {
    exportId: uuid('export_id')
      .notNull()
      .references(() => organizationExports.id),
    organizationId: text('organization_id').notNull(),
    exportRevision: integer('export_revision').notNull(),
    operationId: uuid('operation_id').notNull(),
    tokenDigest: char('token_digest', { length: 64 }).notNull(),
    issuedAt: timestamptz('issued_at').notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({
      columns: [t.exportId, t.exportRevision],
      name: 'organization_export_retrieval_issuances_pk',
    }),
    check(
      'organization_export_retrieval_issuances_revision_positive',
      sql`${t.exportRevision} > 0`,
    ),
    check(
      'organization_export_retrieval_issuances_digest_valid',
      sql`${t.tokenDigest} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      'organization_export_retrieval_issuances_expiry_valid',
      sql`${t.expiresAt} > ${t.issuedAt} AND ${t.expiresAt} <= ${t.issuedAt} + interval '24 hours'`,
    ),
    uniqueIndex('organization_export_retrieval_issuances_operation_idx').on(
      t.exportId,
      t.operationId,
    ),
    uniqueIndex('organization_export_retrieval_issuances_digest_idx').on(
      t.exportId,
      t.tokenDigest,
    ),
    index('organization_export_retrieval_issuances_org_time_idx').on(
      t.organizationId,
      desc(t.issuedAt),
    ),
  ],
)
