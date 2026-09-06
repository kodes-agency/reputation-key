import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

export type RecoveryFenceCounts = Readonly<{
  sessionsInvalidated: number
  verificationTokensInvalidated: number
  invitationsCanceled: number
  outboxEventsFenced: number
  emailsCanceled: number
  digestBatchesTerminated: number
  repliesCanceled: number
  repliesMadeAmbiguous: number
  googleConnectionsFenced: number
  googleExecutionPermitsFenced: number
  googleSourceOperationsFenced: number
  googleRevokePermitsFenced: number
  googleImportV2ParentsFenced: number
  googleImportV2ItemsFenced: number
  aiIssuedPermitsReleased: number
  aiConsumedPermitsMadeAmbiguous: number
  aiOperationsFenced: number
  aiBackfillRunsStalled: number
}>

/**
 * Durable, convergent proof for an isolated-restore recovery fence. Re-running
 * the same source-manifest/restore-point tuple re-scans and fences any authority
 * that appeared after the previous pass, accumulating content-free counts in
 * this row. A distinct restore rotates the monotonic per-cell generation.
 */
export const recoveryRuns = pgTable(
  'recovery_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dataCellId: varchar('data_cell_id', { length: 16 }).notNull(),
    generation: integer('generation').notNull(),
    sourceReleaseSha: varchar('source_release_sha', { length: 40 }).notNull(),
    sourceManifestSha256: varchar('source_manifest_sha256', { length: 64 }).notNull(),
    restorePointAt: timestamp('restore_point_at', { withTimezone: true }).notNull(),
    operatorId: varchar('operator_id', { length: 255 }).notNull(),
    correlationId: varchar('correlation_id', { length: 255 }).notNull(),
    counts: jsonb('counts').$type<RecoveryFenceCounts>().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('recovery_runs_cell_generation_unique').on(
      table.dataCellId,
      table.generation,
    ),
    uniqueIndex('recovery_runs_source_unique').on(
      table.dataCellId,
      table.sourceManifestSha256,
      table.restorePointAt,
    ),
    index('recovery_runs_completed_idx').on(table.dataCellId, table.completedAt.desc()),
    check(
      'recovery_runs_cell_valid',
      sql`${table.dataCellId} IN ('us', 'europe', 'global')`,
    ),
    check('recovery_runs_generation_valid', sql`${table.generation} >= 1`),
    check(
      'recovery_runs_source_release_valid',
      sql`${table.sourceReleaseSha} ~ '^[0-9a-f]{40}$'`,
    ),
    check(
      'recovery_runs_source_manifest_valid',
      sql`${table.sourceManifestSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'recovery_runs_time_valid',
      sql`${table.restorePointAt} <= ${table.completedAt} AND ${table.completedAt} >= ${table.createdAt}`,
    ),
  ],
)

export type RecoveryRunRow = typeof recoveryRuns.$inferSelect

/**
 * Content-free one-shot authority/evidence for the Review lifecycle portion of
 * an isolated restore. Signed target/policy/report bindings are immutable;
 * only progress, bounded counts, and completion may advance.
 */
export const reviewLifecycleRecoveryExecutions = pgTable(
  'review_lifecycle_recovery_executions',
  {
    /** The exact pre-reviewed recovery run UUID. */
    id: uuid('id').primaryKey(),
    recoveryGeneration: integer('recovery_generation').notNull(),
    approvalId: varchar('approval_id', { length: 160 }).notNull(),
    approvalBundleSha256: varchar('approval_bundle_sha256', {
      length: 64,
    }).notNull(),
    approverIdentity: varchar('approver_identity', { length: 255 }).notNull(),
    approvalKeyId: varchar('approval_key_id', { length: 64 }).notNull(),
    approvedAt: timestamp('approved_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    dataCellId: varchar('data_cell_id', { length: 16 }).notNull(),
    releaseSha: varchar('release_sha', { length: 40 }).notNull(),
    releaseManifestSha256: varchar('release_manifest_sha256', {
      length: 64,
    }).notNull(),
    restorePointAt: timestamp('restore_point_at', { withTimezone: true }).notNull(),
    restoreDatabaseServiceName: varchar('restore_database_service_name', {
      length: 255,
    }).notNull(),
    railwayProjectId: varchar('railway_project_id', { length: 255 }),
    railwayEnvironmentId: varchar('railway_environment_id', { length: 255 }),
    evaluatedAt: timestamp('evaluated_at', { withTimezone: true }).notNull(),
    sourcePolicyVersion: integer('source_policy_version').notNull(),
    retentionPolicyVersion: integer('retention_policy_version').notNull(),
    policySha256: varchar('policy_sha256', { length: 64 }).notNull(),
    reportSha256: varchar('report_sha256', { length: 64 }).notNull(),
    reportExpired: integer('report_expired').notNull(),
    operatorId: varchar('operator_id', { length: 255 }).notNull(),
    correlationId: varchar('correlation_id', { length: 255 }).notNull(),
    state: varchar('state', { length: 32 }).notNull(),
    checkpointCreatedAt: timestamp('checkpoint_created_at', {
      withTimezone: true,
    }),
    checkpointReviewId: uuid('checkpoint_review_id'),
    pages: integer('pages').notNull().default(0),
    scanned: integer('scanned').notNull().default(0),
    rowsRedacted: integer('rows_redacted').notNull().default(0),
    legacyGoogleRepliesReconciled: integer('legacy_google_replies_reconciled')
      .notNull()
      .default(0),
    recoveryReplayed: boolean('recovery_replayed'),
    errorCode: varchar('error_code', { length: 160 }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('review_lifecycle_recovery_approval_unique').on(table.approvalId),
    uniqueIndex('review_lifecycle_recovery_bundle_unique').on(table.approvalBundleSha256),
    uniqueIndex('review_lifecycle_recovery_cell_generation_unique').on(
      table.dataCellId,
      table.recoveryGeneration,
    ),
    index('review_lifecycle_recovery_state_idx').on(table.dataCellId, table.state),
    check(
      'review_lifecycle_recovery_state_valid',
      sql`${table.state} IN ('applying', 'lifecycle_applied', 'completed')`,
    ),
    check(
      'review_lifecycle_recovery_cell_valid',
      sql`${table.dataCellId} IN ('us', 'europe', 'global')`,
    ),
    check(
      'review_lifecycle_recovery_generation_valid',
      sql`${table.recoveryGeneration} >= 1`,
    ),
    check(
      'review_lifecycle_recovery_release_valid',
      sql`${table.releaseSha} ~ '^[0-9a-f]{40}$' AND ${table.releaseManifestSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'review_lifecycle_recovery_digests_valid',
      sql`${table.approvalBundleSha256} ~ '^[0-9a-f]{64}$' AND ${table.policySha256} ~ '^[0-9a-f]{64}$' AND ${table.reportSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'review_lifecycle_recovery_window_valid',
      sql`${table.restorePointAt} <= ${table.evaluatedAt} AND ${table.evaluatedAt} <= ${table.approvedAt} AND ${table.approvedAt} < ${table.expiresAt}`,
    ),
    check(
      'review_lifecycle_recovery_counts_valid',
      sql`${table.reportExpired} >= 0 AND ${table.pages} >= 0 AND ${table.scanned} >= 0 AND ${table.rowsRedacted} >= 0 AND ${table.legacyGoogleRepliesReconciled} >= 0`,
    ),
    check(
      'review_lifecycle_recovery_checkpoint_valid',
      sql`(${table.checkpointCreatedAt} IS NULL) = (${table.checkpointReviewId} IS NULL) AND (${table.state} = 'applying' OR ${table.checkpointCreatedAt} IS NULL) AND (${table.checkpointCreatedAt} IS NULL OR ${table.checkpointCreatedAt} <= ${table.evaluatedAt})`,
    ),
    check(
      'review_lifecycle_recovery_completion_valid',
      sql`(${table.state} = 'completed') = (${table.completedAt} IS NOT NULL)`,
    ),
  ],
)

export type ReviewLifecycleRecoveryExecutionRow =
  typeof reviewLifecycleRecoveryExecutions.$inferSelect
