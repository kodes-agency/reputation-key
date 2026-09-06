import { and, eq, or, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  recoveryRuns,
  reviewLifecycleRecoveryExecutions,
  type ReviewLifecycleRecoveryExecutionRow,
} from '#/shared/db/schema/recovery.schema'
import type {
  ReviewLifecycleRecoveryExecutionAuthorityInput,
  ReviewLifecycleRecoveryExecutionIdentity,
  ReviewLifecycleRecoveryExecutionProgress,
  ReviewLifecycleRecoveryExecutionState,
  ReviewLifecycleRecoveryExecutionStore,
} from '../../application/ports/lifecycle-recovery-execution-store.port'

function sameInstant(left: Date, right: Date): boolean {
  return left.getTime() === right.getTime()
}

function sameExecutionBinding(
  row: ReviewLifecycleRecoveryExecutionRow,
  input: ReviewLifecycleRecoveryExecutionAuthorityInput,
): boolean {
  return (
    row.id === input.recoveryRunId &&
    row.recoveryGeneration === input.recoveryGeneration &&
    row.approvalId === input.approvalId &&
    row.approvalBundleSha256 === input.approvalBundleSha256 &&
    row.approverIdentity === input.approverIdentity &&
    row.approvalKeyId === input.approvalKeyId &&
    sameInstant(row.approvedAt, input.approvedAt) &&
    sameInstant(row.expiresAt, input.expiresAt) &&
    row.releaseSha === input.releaseSha &&
    row.releaseManifestSha256 === input.releaseManifestSha256 &&
    sameInstant(row.restorePointAt, input.restorePointAt) &&
    row.restoreDatabaseServiceName === input.restoreDatabaseServiceName &&
    row.railwayProjectId === input.railwayProjectId &&
    row.railwayEnvironmentId === input.railwayEnvironmentId &&
    sameInstant(row.evaluatedAt, input.evaluatedAt) &&
    row.sourcePolicyVersion === input.sourcePolicyVersion &&
    row.retentionPolicyVersion === input.retentionPolicyVersion &&
    row.policySha256 === input.policySha256 &&
    row.reportSha256 === input.reportSha256 &&
    row.operatorId === input.operatorId &&
    row.correlationId === input.correlationId
  )
}

function assertNonnegativeCounts(input: Readonly<Record<string, number>>): void {
  for (const [field, count] of Object.entries(input)) {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new TypeError(`Review lifecycle recovery ${field} count is invalid`)
    }
  }
}

function executionProgress(
  row: ReviewLifecycleRecoveryExecutionRow,
): ReviewLifecycleRecoveryExecutionProgress {
  if (row.state !== 'applying' && row.state !== 'lifecycle_applied') {
    throw new Error('Review lifecycle recovery approval was already consumed')
  }
  assertNonnegativeCounts({
    pages: row.pages,
    reportExpired: row.reportExpired,
    scanned: row.scanned,
    rowsRedacted: row.rowsRedacted,
    legacyGoogleRepliesReconciled: row.legacyGoogleRepliesReconciled,
  })
  if (
    (row.checkpointCreatedAt == null) !== (row.checkpointReviewId == null) ||
    (row.state !== 'applying' && row.checkpointCreatedAt != null) ||
    (row.state === 'applying' && row.pages > 0 && row.checkpointCreatedAt == null)
  ) {
    throw new Error('Review lifecycle recovery execution has invalid progress')
  }
  return {
    state: row.state,
    reportExpired: row.reportExpired,
    checkpoint:
      row.checkpointCreatedAt == null || row.checkpointReviewId == null
        ? null
        : {
            createdAt: row.checkpointCreatedAt,
            reviewId: row.checkpointReviewId,
          },
    pages: row.pages,
    scanned: row.scanned,
    rowsRedacted: row.rowsRedacted,
    legacyGoogleRepliesReconciled: row.legacyGoogleRepliesReconciled,
  }
}

function exactIdentityCondition(identity: ReviewLifecycleRecoveryExecutionIdentity) {
  return and(
    eq(reviewLifecycleRecoveryExecutions.id, identity.recoveryRunId),
    eq(reviewLifecycleRecoveryExecutions.recoveryGeneration, identity.recoveryGeneration),
    eq(reviewLifecycleRecoveryExecutions.approvalId, identity.approvalId),
    eq(
      reviewLifecycleRecoveryExecutions.approvalBundleSha256,
      identity.approvalBundleSha256,
    ),
  )
}

/** PostgreSQL one-shot/recovery-safe receipt for the sealed executor. */
export const createReviewLifecycleRecoveryExecutionRepository = (
  db: Database,
): ReviewLifecycleRecoveryExecutionStore => {
  return {
    resume: async (input) =>
      db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext('repkey.review-lifecycle-recovery'), 0)`,
        )
        const candidates = await tx
          .select()
          .from(reviewLifecycleRecoveryExecutions)
          .where(
            or(
              eq(reviewLifecycleRecoveryExecutions.id, input.recoveryRunId),
              eq(reviewLifecycleRecoveryExecutions.approvalId, input.approvalId),
              eq(
                reviewLifecycleRecoveryExecutions.approvalBundleSha256,
                input.approvalBundleSha256,
              ),
              eq(
                reviewLifecycleRecoveryExecutions.recoveryGeneration,
                input.recoveryGeneration,
              ),
            ),
          )
          .for('update')
        if (
          candidates.length > 1 ||
          (candidates[0] && !sameExecutionBinding(candidates[0], input))
        ) {
          throw new Error(
            'Review lifecycle recovery approval conflicts with a durable target binding',
          )
        }
        const existing = candidates[0]
        if (existing?.state === 'completed') {
          throw new Error('Review lifecycle recovery approval was already consumed')
        }

        const recoveryCandidates = await tx
          .select({
            id: recoveryRuns.id,
            generation: recoveryRuns.generation,
            sourceReleaseSha: recoveryRuns.sourceReleaseSha,
            sourceManifestSha256: recoveryRuns.sourceManifestSha256,
            restorePointAt: recoveryRuns.restorePointAt,
          })
          .from(recoveryRuns)
          .where(
            or(
              eq(recoveryRuns.id, input.recoveryRunId),
              eq(recoveryRuns.generation, input.recoveryGeneration),
              and(
                eq(recoveryRuns.sourceManifestSha256, input.releaseManifestSha256),
                eq(recoveryRuns.restorePointAt, input.restorePointAt),
              ),
            ),
          )
          .for('update')
        const exactRecovery = recoveryCandidates.find(
          (row) =>
            row.id === input.recoveryRunId &&
            row.generation === input.recoveryGeneration &&
            row.sourceReleaseSha === input.releaseSha &&
            row.sourceManifestSha256 === input.releaseManifestSha256 &&
            sameInstant(row.restorePointAt, input.restorePointAt),
        )
        if (
          recoveryCandidates.length > 0 &&
          (!exactRecovery ||
            existing?.state !==
              ('lifecycle_applied' satisfies ReviewLifecycleRecoveryExecutionState))
        ) {
          throw new Error('Review lifecycle recovery approval was replayed or is stale')
        }
        return existing == null ? null : executionProgress(existing)
      }),

    begin: async (input) =>
      db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext('repkey.review-lifecycle-recovery'), 0)`,
        )

        const candidates = await tx
          .select()
          .from(reviewLifecycleRecoveryExecutions)
          .where(
            or(
              eq(reviewLifecycleRecoveryExecutions.id, input.recoveryRunId),
              eq(reviewLifecycleRecoveryExecutions.approvalId, input.approvalId),
              eq(
                reviewLifecycleRecoveryExecutions.approvalBundleSha256,
                input.approvalBundleSha256,
              ),
              eq(
                reviewLifecycleRecoveryExecutions.recoveryGeneration,
                input.recoveryGeneration,
              ),
            ),
          )
          .for('update')
        if (
          candidates.length > 1 ||
          (candidates[0] &&
            (!sameExecutionBinding(candidates[0], input) ||
              candidates[0].reportExpired !== input.reportExpired))
        ) {
          throw new Error(
            'Review lifecycle recovery approval conflicts with a durable target binding',
          )
        }
        const existing = candidates[0]
        if (existing?.state === 'completed') {
          throw new Error('Review lifecycle recovery approval was already consumed')
        }

        const recoveryCandidates = await tx
          .select({
            id: recoveryRuns.id,
            generation: recoveryRuns.generation,
            sourceReleaseSha: recoveryRuns.sourceReleaseSha,
            sourceManifestSha256: recoveryRuns.sourceManifestSha256,
            restorePointAt: recoveryRuns.restorePointAt,
          })
          .from(recoveryRuns)
          .where(
            or(
              eq(recoveryRuns.id, input.recoveryRunId),
              eq(recoveryRuns.generation, input.recoveryGeneration),
              and(
                eq(recoveryRuns.sourceManifestSha256, input.releaseManifestSha256),
                eq(recoveryRuns.restorePointAt, input.restorePointAt),
              ),
            ),
          )
          .for('update')
        const exactRecovery = recoveryCandidates.find(
          (row) =>
            row.id === input.recoveryRunId &&
            row.generation === input.recoveryGeneration &&
            row.sourceReleaseSha === input.releaseSha &&
            row.sourceManifestSha256 === input.releaseManifestSha256 &&
            sameInstant(row.restorePointAt, input.restorePointAt),
        )
        if (
          recoveryCandidates.length > 0 &&
          (!exactRecovery ||
            candidates[0]?.state !==
              ('lifecycle_applied' satisfies ReviewLifecycleRecoveryExecutionState))
        ) {
          throw new Error('Review lifecycle recovery approval was replayed or is stale')
        }

        if (existing) {
          return { ...executionProgress(existing), resumed: true }
        }

        const generationRows = await tx.execute(sql`
          SELECT COALESCE(MAX(generation), 0)::int + 1 AS next_generation
          FROM recovery_runs
        `)
        const nextGeneration = Number(generationRows.rows[0]?.next_generation)
        if (nextGeneration !== input.recoveryGeneration) {
          throw new Error('Review lifecycle recovery approval generation is stale')
        }
        const active = await tx
          .select({ id: reviewLifecycleRecoveryExecutions.id })
          .from(reviewLifecycleRecoveryExecutions)
          .where(
            sql`${reviewLifecycleRecoveryExecutions.state} IN ('applying', 'lifecycle_applied')`,
          )
          .limit(1)
        if (active[0]) {
          throw new Error('Another Review lifecycle recovery execution is already active')
        }

        await tx.insert(reviewLifecycleRecoveryExecutions).values({
          id: input.recoveryRunId,
          recoveryGeneration: input.recoveryGeneration,
          approvalId: input.approvalId,
          approvalBundleSha256: input.approvalBundleSha256,
          approverIdentity: input.approverIdentity,
          approvalKeyId: input.approvalKeyId,
          approvedAt: input.approvedAt,
          expiresAt: input.expiresAt,
          releaseSha: input.releaseSha,
          releaseManifestSha256: input.releaseManifestSha256,
          restorePointAt: input.restorePointAt,
          restoreDatabaseServiceName: input.restoreDatabaseServiceName,
          railwayProjectId: input.railwayProjectId,
          railwayEnvironmentId: input.railwayEnvironmentId,
          evaluatedAt: input.evaluatedAt,
          sourcePolicyVersion: input.sourcePolicyVersion,
          retentionPolicyVersion: input.retentionPolicyVersion,
          policySha256: input.policySha256,
          reportSha256: input.reportSha256,
          reportExpired: input.reportExpired,
          operatorId: input.operatorId,
          correlationId: input.correlationId,
          state: 'applying',
        })
        return {
          resumed: false,
          state: 'applying',
          reportExpired: input.reportExpired,
          checkpoint: null,
          pages: 0,
          scanned: 0,
          rowsRedacted: 0,
          legacyGoogleRepliesReconciled: 0,
        }
      }),

    complete: async (input) =>
      db.transaction(async (tx) => {
        const recovery = await tx
          .select({
            id: recoveryRuns.id,
            generation: recoveryRuns.generation,
            completedAt: recoveryRuns.completedAt,
          })
          .from(recoveryRuns)
          .where(
            and(
              eq(recoveryRuns.id, input.recoveryRunId),
              eq(recoveryRuns.generation, input.recoveryGeneration),
            ),
          )
          .limit(1)
        if (
          !recovery[0] ||
          !sameInstant(recovery[0].completedAt, input.recoveryCompletedAt)
        ) {
          throw new Error(
            'Review lifecycle recovery completion has no exact recovery run',
          )
        }
        const updated = await tx
          .update(reviewLifecycleRecoveryExecutions)
          .set({
            state: 'completed',
            recoveryReplayed: input.recoveryReplayed,
            completedAt: input.recoveryCompletedAt,
            updatedAt: sql`clock_timestamp()`,
            errorCode: null,
          })
          .where(
            and(
              exactIdentityCondition(input),
              eq(reviewLifecycleRecoveryExecutions.state, 'lifecycle_applied'),
            ),
          )
          .returning({ id: reviewLifecycleRecoveryExecutions.id })
        if (!updated[0]) {
          throw new Error('Review lifecycle recovery approval was replayed or incomplete')
        }
      }),

    fail: async (input) => {
      await db
        .update(reviewLifecycleRecoveryExecutions)
        .set({
          errorCode: input.errorCode.slice(0, 160),
          updatedAt: sql`clock_timestamp()`,
        })
        .where(
          and(
            exactIdentityCondition(input),
            sql`${reviewLifecycleRecoveryExecutions.state} IN ('applying', 'lifecycle_applied')`,
          ),
        )
    },
  }
}

/** Read-only recovery-plan allocation facts kept behind Review infrastructure. */
export const createReviewLifecycleRecoveryPlanningQuery = (db: Database) => ({
  loadNextRecoveryGeneration: async (): Promise<number> => {
    const result = await db.execute(sql`
      SELECT
        (SELECT COALESCE(MAX(generation), 0)::int + 1
         FROM recovery_runs) AS next_generation,
        EXISTS (
          SELECT 1
          FROM review_lifecycle_recovery_executions
          WHERE state IN ('applying', 'lifecycle_applied')
        ) AS active_execution
    `)
    const row = result.rows[0] as
      { next_generation?: number | string; active_execution?: boolean } | undefined
    if (row?.active_execution) {
      throw new Error('An unfinished Review lifecycle recovery execution already exists')
    }
    const generation = Number(row?.next_generation)
    if (!Number.isSafeInteger(generation) || generation < 1) {
      throw new Error('Review lifecycle recovery generation is unavailable')
    }
    return generation
  },
})
