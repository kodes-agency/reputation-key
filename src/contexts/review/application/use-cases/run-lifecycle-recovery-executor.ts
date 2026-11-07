import { canonicalizeRfc8785 } from '#/shared/canonical-json'
import { createGoogleSourceContentPolicy } from '#/shared/domain/source-content-policy'
import {
  type ReviewLifecycleRecoveryApprovalRequest,
  type ReviewLifecycleRecoveryRuntimeTarget,
} from '#/shared/ops/review-lifecycle-recovery-approval'
import { CLOSED_BETA_RAILWAY_ENVIRONMENT_NAME } from '#/shared/release/railway-deployment-profile'
import type { RecoveryFenceInput, RecoveryFenceResult } from '#/shared/ops/recovery-fence'
import type {
  ReviewLifecycleRecoveryExecutionAuthorityInput,
  ReviewLifecycleRecoveryExecutionIdentity,
  ReviewLifecycleRecoveryExecutionStore,
} from '../ports/lifecycle-recovery-execution-store.port'
import {
  collectReviewLifecycleRecoveryEvidence,
  reviewLifecyclePolicySha256,
} from './collect-lifecycle-recovery-evidence'
import {
  REVIEW_SOURCE_CONTENT_LIFECYCLE_APPLY_CONFIRMATION,
  REVIEW_SOURCE_CONTENT_LIFECYCLE_CONTRACT,
  REVIEW_SOURCE_CONTENT_LIFECYCLE_MAX_BATCH_SIZE,
  REVIEW_SOURCE_CONTENT_LIFECYCLE_RETENTION_POLICY_VERSION,
  type AuthorizeReviewSourceContentLifecycleApply,
  type ReviewSourceContentLifecycleCheckpoint,
  type RunReviewSourceContentLifecycle,
} from './run-source-content-lifecycle'

export type { ReviewLifecycleRecoveryRuntimeTarget } from '#/shared/ops/review-lifecycle-recovery-approval'

type CreateRunLifecycle = (
  input: Readonly<{
    clock: () => Date
    authorizeApply: AuthorizeReviewSourceContentLifecycleApply
  }>,
) => RunReviewSourceContentLifecycle

export type AdmittedReviewLifecycleRecoveryExecutor = Readonly<{
  recoveryInput: RecoveryFenceInput
  expired: number
  approvalId: string
  approvalBundleSha256: string
  reportSha256: string
  applyReviewLifecycle: () => Promise<void>
  complete: (result: RecoveryFenceResult) => Promise<void>
}>

export type RunReviewLifecycleRecoveryExecutor = Readonly<{
  admit: (
    target: ReviewLifecycleRecoveryRuntimeTarget,
  ) => Promise<AdmittedReviewLifecycleRecoveryExecutor>
}>

function sameRequest(
  actual: ReviewLifecycleRecoveryApprovalRequest,
  expected: ReviewLifecycleRecoveryApprovalRequest,
): boolean {
  return canonicalizeRfc8785(actual) === canonicalizeRfc8785(expected)
}

async function drainLifecycle(
  runLifecycle: RunReviewSourceContentLifecycle,
  checkpoint?: ReviewSourceContentLifecycleCheckpoint,
  recoveryExecution?: ReviewLifecycleRecoveryExecutionIdentity,
): Promise<void> {
  do {
    const result = await runLifecycle({
      mode: 'apply',
      batchSize: REVIEW_SOURCE_CONTENT_LIFECYCLE_MAX_BATCH_SIZE,
      ...(checkpoint == null ? {} : { checkpoint }),
      applyConfirmation: REVIEW_SOURCE_CONTENT_LIFECYCLE_APPLY_CONFIRMATION,
      ...(recoveryExecution == null ? {} : { recoveryExecution }),
    })
    if (!result.apply.enabled) {
      throw new Error('Review lifecycle recovery apply authority disappeared')
    }
    checkpoint = result.nextCheckpoint ?? undefined
    if (checkpoint != null && result.scanned === 0) {
      throw new Error('Review lifecycle recovery checkpoint did not advance')
    }
  } while (checkpoint != null)
}

/**
 * Restore-only lifecycle execution. The typed environment confirmation precedes
 * admission; frozen evidence and durable checkpoints bind the original pass.
 * A fresh expiry pass catches content that aged out while recovery was paused.
 */
export function createRunReviewLifecycleRecoveryExecutor(
  deps: Readonly<{
    environmentConfirmation?: string
    clock: () => Date
    prepare: (target: ReviewLifecycleRecoveryRuntimeTarget) => Promise<
      Readonly<{
        request: ReviewLifecycleRecoveryApprovalRequest
        authority: ReviewLifecycleRecoveryExecutionAuthorityInput
      }>
    >
    createRunLifecycle: CreateRunLifecycle
    executions: ReviewLifecycleRecoveryExecutionStore
  }>,
): RunReviewLifecycleRecoveryExecutor {
  return {
    admit: async (target) => {
      if (deps.environmentConfirmation !== CLOSED_BETA_RAILWAY_ENVIRONMENT_NAME) {
        throw new Error('Confirm the restore environment with --yes closed-beta-v2')
      }
      const { request, authority } = await deps.prepare(target)
      const evaluatedAt = new Date(request.lifecycle.evaluatedAt)
      const expectedTarget = {
        releaseSha: target.releaseSha,
        releaseManifestSha256: target.releaseManifestSha256,
        restorePointAt: target.restorePointAt.toISOString(),
        restoreDatabaseServiceName: target.restoreDatabaseServiceName,
        railwayProjectId: target.railwayProjectId,
        railwayEnvironmentId: target.railwayEnvironmentId,
        recoveryRunId: request.target.recoveryRunId,
        recoveryGeneration: request.target.recoveryGeneration,
      }
      const sourcePolicy = createGoogleSourceContentPolicy()
      if (
        canonicalizeRfc8785(request.target) !== canonicalizeRfc8785(expectedTarget) ||
        request.lifecycle.sourcePolicyVersion !== sourcePolicy.policyVersion ||
        request.lifecycle.retentionPolicyVersion !==
          REVIEW_SOURCE_CONTENT_LIFECYCLE_RETENTION_POLICY_VERSION ||
        request.lifecycle.policySha256 !== reviewLifecyclePolicySha256()
      ) {
        throw new Error('Review lifecycle recovery approval refused: wrong_target')
      }
      const lifecycleApproval = {
        approvalId: authority.approvalId,
        evidenceSha256: request.lifecycle.reportSha256,
        approvedAt: authority.approvedAt.toISOString(),
      }
      const authorizeAt =
        (cutoff: Date): AuthorizeReviewSourceContentLifecycleApply =>
        async (input) => {
          if (
            input.contract !== REVIEW_SOURCE_CONTENT_LIFECYCLE_CONTRACT ||
            input.evaluatedAt.getTime() !== cutoff.getTime() ||
            canonicalizeRfc8785(input.scope) !==
              canonicalizeRfc8785(request.lifecycle.scope) ||
            (input.priorApproval != null &&
              canonicalizeRfc8785(input.priorApproval) !==
                canonicalizeRfc8785(lifecycleApproval))
          ) {
            throw new Error('Review lifecycle recovery approval continuation changed')
          }
          return lifecycleApproval
        }
      const runLifecycle = deps.createRunLifecycle({
        clock: () => new Date(evaluatedAt),
        authorizeApply: authorizeAt(evaluatedAt),
      })
      const identity = {
        recoveryRunId: request.target.recoveryRunId,
        recoveryGeneration: request.target.recoveryGeneration,
        approvalId: authority.approvalId,
        approvalBundleSha256: authority.approvalBundleSha256,
      }
      let execution = await deps.executions.resume(authority)
      if (execution == null) {
        const evidence = await collectReviewLifecycleRecoveryEvidence(runLifecycle)
        const expectedRequest: ReviewLifecycleRecoveryApprovalRequest = {
          version: request.version,
          kind: 'review-lifecycle-recovery',
          target: expectedTarget,
          lifecycle: {
            contract: evidence.report.contract,
            scope: evidence.report.scope,
            evaluatedAt: evidence.report.evaluatedAt,
            batchSize: evidence.report.batchSize,
            sourcePolicyVersion: evidence.report.sourcePolicyVersion,
            retentionPolicyVersion: evidence.report.retentionPolicyVersion,
            policySha256: evidence.report.policySha256,
            reportSha256: evidence.sha256,
          },
        }
        if (!sameRequest(request, expectedRequest)) {
          throw new Error('Review lifecycle recovery approval refused: wrong_target')
        }
        execution = await deps.executions.begin({
          ...authority,
          reportExpired: evidence.report.lifecycle.expired,
        })
      }

      const recoveryInput: RecoveryFenceInput = {
        sourceReleaseSha: target.releaseSha,
        sourceManifestSha256: target.releaseManifestSha256,
        restorePointAt: target.restorePointAt,
        // Retries must match both the immutable fence and receipt completion binding.
        operatorId: authority.operatorId,
        correlationId: authority.correlationId,
        runId: identity.recoveryRunId,
        generation: identity.recoveryGeneration,
      }

      return {
        recoveryInput,
        expired: execution.reportExpired,
        approvalId: identity.approvalId,
        approvalBundleSha256: identity.approvalBundleSha256,
        reportSha256: request.lifecycle.reportSha256,
        applyReviewLifecycle: async () => {
          const checkpoint: ReviewSourceContentLifecycleCheckpoint | undefined =
            execution.checkpoint == null
              ? undefined
              : {
                  contract: REVIEW_SOURCE_CONTENT_LIFECYCLE_CONTRACT,
                  mode: 'apply' as const,
                  scope: request.lifecycle.scope,
                  evaluatedAt: request.lifecycle.evaluatedAt,
                  after: {
                    createdAt: execution.checkpoint.createdAt.toISOString(),
                    reviewId: execution.checkpoint.reviewId,
                  },
                  approval: lifecycleApproval,
                }
          try {
            if (execution.state !== 'lifecycle_applied') {
              await drainLifecycle(runLifecycle, checkpoint, identity)
            }
            const currentCutoff = new Date(deps.clock())
            if (currentCutoff.getTime() > evaluatedAt.getTime()) {
              // The receipt's frozen evidence stays immutable. Age-based expiry
              // may have advanced behind its cursor, so scan from the start at
              // one new cutoff. Each page is atomic and safely replayable after
              // interruption; the original durable checkpoint is never reset.
              await drainLifecycle(
                deps.createRunLifecycle({
                  clock: () => new Date(currentCutoff),
                  authorizeApply: authorizeAt(currentCutoff),
                }),
              )
            }
          } catch (error) {
            await deps.executions
              .fail({
                ...identity,
                errorCode: 'review_lifecycle_apply_failed',
              })
              .catch(() => {})
            throw error
          }
        },
        complete: async (result) => {
          if (
            result.id !== identity.recoveryRunId ||
            result.generation !== identity.recoveryGeneration
          ) {
            throw new Error('Recovery result does not match the approved recovery tuple')
          }
          await deps.executions.complete({
            ...identity,
            recoveryCompletedAt: result.completedAt,
            recoveryReplayed: result.replayed,
          })
        },
      }
    },
  }
}
