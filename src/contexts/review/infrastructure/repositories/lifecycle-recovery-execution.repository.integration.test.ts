import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { getDb, type Database } from '#/shared/db'
import { recoveryRuns } from '#/shared/db/schema/recovery.schema'
import type { BeginReviewLifecycleRecoveryExecutionInput } from '../../application/ports/lifecycle-recovery-execution-store.port'
import { createReviewLifecycleRecoveryExecutionRepository } from './lifecycle-recovery-execution.repository'
import { createReviewSourceContentLifecycleStore } from './source-content-lifecycle-store.repository'

const db = getDb()
const ROLLBACK = new Error('rollback Review lifecycle recovery receipt proof')
const ATOMIC_ROLLBACK = new Error('rollback atomic Review recovery page proof')
const RUN_ID = '10000000-0000-4000-8000-000000000950'
const ATOMIC_RUN_ID = '10000000-0000-4000-8000-000000000960'
const ATOMIC_PROPERTY_ID = '10000000-0000-4000-8000-000000000961'
const ATOMIC_REVIEW_ID = '10000000-0000-4000-8000-000000000962'

const zeroRecoveryCounts = {
  sessionsInvalidated: 0,
  verificationTokensInvalidated: 0,
  invitationsCanceled: 0,
  outboxEventsFenced: 0,
  emailsCanceled: 0,
  digestBatchesTerminated: 0,
  repliesCanceled: 0,
  repliesMadeAmbiguous: 0,
  googleConnectionsFenced: 0,
  googleExecutionPermitsFenced: 0,
  googleSourceOperationsFenced: 0,
  googleRevokePermitsFenced: 0,
  googleImportV2ParentsFenced: 0,
  googleImportV2ItemsFenced: 0,
  aiIssuedPermitsReleased: 0,
  aiConsumedPermitsMadeAmbiguous: 0,
  aiOperationsFenced: 0,
  aiBackfillRunsStalled: 0,
} as const

describe('Review lifecycle recovery execution repository (integration)', () => {
  it('reserves one immutable approval and completes only its exact recovery run', async () => {
    await expect(
      db.transaction(async (tx) => {
        const transaction = tx as unknown as Database
        const executions = createReviewLifecycleRecoveryExecutionRepository(transaction)
        const generationResult = await transaction.execute(sql`
          SELECT COALESCE(MAX(generation), 0)::int + 1 AS generation
          FROM recovery_runs
          WHERE data_cell_id = 'us'
        `)
        const recoveryGeneration = Number(generationResult.rows[0]?.generation)
        const now = Date.now()
        const input: BeginReviewLifecycleRecoveryExecutionInput = {
          state: 'applying',
          recoveryRunId: RUN_ID,
          recoveryGeneration,
          approvalId: 'review-recovery-approval-integration',
          approvalBundleSha256: 'a'.repeat(64),
          approverIdentity: 'reviewer@example.invalid',
          approvalKeyId: 'review_recovery_test',
          approvedAt: new Date(now - 10_000),
          expiresAt: new Date(now + 3_600_000),
          dataCellId: 'us',
          releaseSha: 'b'.repeat(40),
          releaseManifestSha256: 'c'.repeat(64),
          restorePointAt: new Date(now - 120_000),
          restoreDatabaseServiceName: 'postgres-restore-proof',
          railwayProjectId: 'railway-project-proof',
          railwayEnvironmentId: 'railway-environment-proof',
          evaluatedAt: new Date(now - 60_000),
          sourcePolicyVersion: 1,
          retentionPolicyVersion: 5,
          policySha256: 'd'.repeat(64),
          reportSha256: 'e'.repeat(64),
          reportExpired: 12,
          operatorId: 'operator@example.invalid',
          correlationId: 'review-recovery-integration',
        }

        await expect(executions.begin(input)).resolves.toEqual({
          resumed: false,
          state: 'applying',
          reportExpired: 12,
          checkpoint: null,
          pages: 0,
          scanned: 0,
          rowsRedacted: 0,
          legacyGoogleRepliesReconciled: 0,
        })
        await expect(executions.begin(input)).resolves.toEqual({
          resumed: true,
          state: 'applying',
          reportExpired: 12,
          checkpoint: null,
          pages: 0,
          scanned: 0,
          rowsRedacted: 0,
          legacyGoogleRepliesReconciled: 0,
        })
        await expect(
          executions.begin({ ...input, reportSha256: 'f'.repeat(64) }),
        ).rejects.toThrow('conflicts with a durable target binding')

        await expect(
          transaction.transaction((savepoint) =>
            savepoint.execute(sql`
              UPDATE review_lifecycle_recovery_executions
              SET release_sha = ${'9'.repeat(40)}
              WHERE id = ${RUN_ID}::uuid
            `),
          ),
        ).rejects.toMatchObject({
          cause: expect.objectContaining({
            message: expect.stringContaining('approval binding is immutable'),
          }),
        })

        const identity = {
          recoveryRunId: input.recoveryRunId,
          recoveryGeneration: input.recoveryGeneration,
          approvalId: input.approvalId,
          approvalBundleSha256: input.approvalBundleSha256,
        }
        const checkpointAt = new Date(now - 70_000)
        const checkpointReviewId = '10000000-0000-4000-8000-000000000951'
        await transaction.execute(sql`
          UPDATE review_lifecycle_recovery_executions
          SET pages = 1, scanned = 100, rows_redacted = 12,
              legacy_google_replies_reconciled = 1,
              checkpoint_created_at = ${checkpointAt},
              checkpoint_review_id = ${checkpointReviewId}::uuid,
              error_code = NULL, updated_at = clock_timestamp()
          WHERE id = ${RUN_ID}::uuid
        `)
        await expect(executions.resume(input)).resolves.toEqual({
          state: 'applying',
          reportExpired: 12,
          checkpoint: {
            createdAt: checkpointAt,
            reviewId: checkpointReviewId,
          },
          pages: 1,
          scanned: 100,
          rowsRedacted: 12,
          legacyGoogleRepliesReconciled: 1,
        })
        await transaction.execute(sql`
          UPDATE review_lifecycle_recovery_executions
          SET state = 'lifecycle_applied', pages = 2, scanned = 150,
              checkpoint_created_at = NULL, checkpoint_review_id = NULL,
              error_code = NULL, updated_at = clock_timestamp()
          WHERE id = ${RUN_ID}::uuid
        `)

        const completedAt = new Date(now + 1_000)
        await expect(
          transaction.transaction((savepoint) =>
            savepoint.execute(sql`
              UPDATE review_lifecycle_recovery_executions
              SET state = 'completed', recovery_replayed = false,
                  completed_at = ${completedAt}, updated_at = clock_timestamp()
              WHERE id = ${RUN_ID}::uuid
            `),
          ),
        ).rejects.toMatchObject({
          cause: expect.objectContaining({
            message: expect.stringContaining('has no exact recovery run'),
          }),
        })
        await transaction.insert(recoveryRuns).values({
          id: RUN_ID,
          dataCellId: 'us',
          generation: recoveryGeneration,
          sourceReleaseSha: input.releaseSha,
          sourceManifestSha256: input.releaseManifestSha256,
          restorePointAt: input.restorePointAt,
          operatorId: input.operatorId,
          correlationId: input.correlationId,
          counts: zeroRecoveryCounts,
          createdAt: new Date(now),
          completedAt,
        })

        await expect(executions.begin(input)).resolves.toEqual({
          resumed: true,
          state: 'lifecycle_applied',
          reportExpired: 12,
          checkpoint: null,
          pages: 2,
          scanned: 150,
          rowsRedacted: 12,
          legacyGoogleRepliesReconciled: 1,
        })
        await executions.complete({
          ...identity,
          recoveryCompletedAt: completedAt,
          recoveryReplayed: false,
        })
        await expect(executions.begin(input)).rejects.toThrow(
          'approval was already consumed',
        )
        await expect(
          transaction.transaction((savepoint) =>
            savepoint.execute(sql`
              DELETE FROM review_lifecycle_recovery_executions
              WHERE id = ${RUN_ID}::uuid
            `),
          ),
        ).rejects.toMatchObject({
          cause: expect.objectContaining({
            message: expect.stringContaining('evidence is durable'),
          }),
        })

        const evidence = await transaction.execute(sql`
          SELECT state, report_expired, pages, scanned, rows_redacted,
                 legacy_google_replies_reconciled, recovery_replayed,
                 review_lifecycle_recovery_executions.*
          FROM review_lifecycle_recovery_executions
          WHERE id = ${RUN_ID}::uuid
        `)
        expect(evidence.rows[0]).toMatchObject({
          state: 'completed',
          report_expired: 12,
          pages: 2,
          scanned: 150,
          rows_redacted: 12,
          legacy_google_replies_reconciled: 1,
          recovery_replayed: false,
        })
        for (const prohibited of [
          'review_id',
          'organization_id',
          'property_id',
          'rating',
          'review_text',
          'provider_payload',
        ]) {
          expect(evidence.rows[0]).not.toHaveProperty(prohibited)
        }

        throw ROLLBACK
      }),
    ).rejects.toBe(ROLLBACK)
  })

  it('commits each redaction page and its durable recovery checkpoint atomically', async () => {
    const organizationId = 'review-recovery-atomic-proof'
    await expect(
      db.transaction(async (tx) => {
        const transaction = tx as unknown as Database
        const now = Date.now()
        const restorePointAt = new Date(now - 120_000)
        const createdAt = new Date(now - 90_000)
        const contentExpiresAt = new Date(now - 70_000)
        const evaluatedAt = new Date(now - 60_000)
        const approvedAt = new Date(now - 30_000)
        await transaction.execute(sql`
          INSERT INTO properties (
            id, organization_id, name, slug, timezone, source_epoch
          ) VALUES (
            ${ATOMIC_PROPERTY_ID}::uuid, ${organizationId},
            'Review recovery atomic proof', 'review-recovery-atomic-proof', 'UTC', 1
          )
        `)
        await transaction.execute(sql`
          INSERT INTO reviews (
            id, organization_id, property_id, platform, external_id,
            external_location_id, reviewer_name, rating, text, reviewed_at,
            source_created_at, first_fetched_at, last_fetched_at,
            content_expires_at, content_hash, source_epoch, source_revision,
            analysis_sequence, source_content_state, created_at, updated_at
          ) VALUES (
            ${ATOMIC_REVIEW_ID}::uuid, ${organizationId},
            ${ATOMIC_PROPERTY_ID}::uuid, 'google', 'atomic-provider-review',
            'locations/atomic-proof', 'Private reviewer', 2, 'Private review text',
            ${createdAt}, ${createdAt}, ${createdAt}, ${createdAt},
            ${contentExpiresAt}, 'atomic-content-hash', 0, 1, 0, 'active',
            ${createdAt}, ${createdAt}
          )
        `)
        await transaction.execute(sql`
          INSERT INTO review_source_contents (
            review_id, organization_id, property_id, platform, external_id,
            external_location_id, reviewer_name, rating, text, reviewed_at,
            source_created_at, first_fetched_at, last_fetched_at,
            content_expires_at, content_hash, source_epoch, source_revision,
            ai_source_byte_length, ai_source_digest, created_at, updated_at
          ) VALUES (
            ${ATOMIC_REVIEW_ID}::uuid, ${organizationId},
            ${ATOMIC_PROPERTY_ID}::uuid, 'google', 'atomic-provider-review',
            'locations/atomic-proof', 'Private reviewer', 2, 'Private review text',
            ${createdAt}, ${createdAt}, ${createdAt}, ${createdAt},
            ${contentExpiresAt}, 'atomic-content-hash', 0, 1,
            19, ${'a'.repeat(64)}, ${createdAt}, ${createdAt}
          )
        `)

        const generationResult = await transaction.execute(sql`
          SELECT COALESCE(MAX(generation), 0)::int + 1 AS generation
          FROM recovery_runs
          WHERE data_cell_id = 'us'
        `)
        const recoveryGeneration = Number(generationResult.rows[0]?.generation)
        const input: BeginReviewLifecycleRecoveryExecutionInput = {
          state: 'applying',
          recoveryRunId: ATOMIC_RUN_ID,
          recoveryGeneration,
          approvalId: 'review-recovery-atomic-approval',
          approvalBundleSha256: '1'.repeat(64),
          approverIdentity: 'reviewer@example.invalid',
          approvalKeyId: 'review_recovery_test',
          approvedAt,
          expiresAt: new Date(now + 3_600_000),
          dataCellId: 'us',
          releaseSha: '2'.repeat(40),
          releaseManifestSha256: '3'.repeat(64),
          restorePointAt,
          restoreDatabaseServiceName: 'postgres-restore-atomic-proof',
          railwayProjectId: 'railway-project-proof',
          railwayEnvironmentId: 'railway-environment-proof',
          evaluatedAt,
          sourcePolicyVersion: 1,
          retentionPolicyVersion: 5,
          policySha256: '4'.repeat(64),
          reportSha256: '5'.repeat(64),
          reportExpired: 1,
          operatorId: 'operator@example.invalid',
          correlationId: 'review-recovery-atomic-proof',
        }
        const executions = createReviewLifecycleRecoveryExecutionRepository(transaction)
        await executions.begin(input)
        const identity = {
          recoveryRunId: input.recoveryRunId,
          recoveryGeneration: input.recoveryGeneration,
          approvalId: input.approvalId,
          approvalBundleSha256: input.approvalBundleSha256,
        }
        const applied = await createReviewSourceContentLifecycleStore(
          transaction,
        ).applyLifecycleBatch({
          evaluatedAt,
          after: null,
          limit: 100,
          scope: { kind: 'expired', organizationId: organizationId as never },
          recoveryExecution: identity,
        })
        expect(applied).toMatchObject({
          hasMore: false,
          rowsRedacted: 1,
        })

        const proof = await transaction.execute(sql`
          SELECT execution.state, execution.pages, execution.scanned,
                 execution.rows_redacted, execution.checkpoint_created_at,
                 review.source_content_state, review.text,
                 (SELECT count(*)::int FROM review_source_contents AS source
                  WHERE source.review_id = ${ATOMIC_REVIEW_ID}::uuid) AS source_count
          FROM review_lifecycle_recovery_executions AS execution
          JOIN reviews AS review ON review.id = ${ATOMIC_REVIEW_ID}::uuid
          WHERE execution.id = ${ATOMIC_RUN_ID}::uuid
        `)
        expect(proof.rows[0]).toMatchObject({
          state: 'lifecycle_applied',
          pages: 1,
          scanned: 1,
          rows_redacted: 1,
          checkpoint_created_at: null,
          source_content_state: 'source_expired',
          text: null,
          source_count: 0,
        })

        throw ATOMIC_ROLLBACK
      }),
    ).rejects.toBe(ATOMIC_ROLLBACK)

    const rolledBack = await db.execute(sql`
      SELECT
        (SELECT count(*)::int FROM review_lifecycle_recovery_executions
         WHERE id = ${ATOMIC_RUN_ID}::uuid) AS execution_count,
        (SELECT count(*)::int FROM reviews
         WHERE id = ${ATOMIC_REVIEW_ID}::uuid) AS review_count
    `)
    expect(rolledBack.rows[0]).toMatchObject({
      execution_count: 0,
      review_count: 0,
    })
  })
})
