import type { KeyObject } from 'node:crypto'
import { canonicalizeRfc8785 } from '#/shared/canonical-json'
import { createGoogleSourceContentPolicy } from '#/shared/domain/source-content-policy'
import {
  authenticateReviewLifecycleRecoveryApprovalBundle,
  type ReviewLifecycleRecoveryApprovalRequest,
  type ReviewLifecycleRecoveryRuntimeTarget,
} from '#/shared/ops/review-lifecycle-recovery-approval'
import type { RecoveryFenceInput, RecoveryFenceResult } from '#/shared/ops/recovery-fence'
import type {
  ReviewLifecycleRecoveryExecutionAuthorityInput,
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

/**
 * One-shot restore-only Review lifecycle executor. The signed bundle is
 * authenticated and its exact frozen report is re-collected before the first
 * durable receipt or lifecycle mutation.
 */
export function createRunReviewLifecycleRecoveryExecutor(
  deps: Readonly<{
    approvalContent: string
    approvalBundleSha256: string
    trustedPublicKeys: ReadonlyMap<string, KeyObject>
    clock: () => Date
    createRunLifecycle: CreateRunLifecycle
    executions: ReviewLifecycleRecoveryExecutionStore
  }>,
): RunReviewLifecycleRecoveryExecutor {
  return {
    admit: async (target) => {
      const authenticated = authenticateReviewLifecycleRecoveryApprovalBundle({
        content: deps.approvalContent,
        expectedBundleSha256: deps.approvalBundleSha256,
        trustedPublicKeys: deps.trustedPublicKeys,
        now: deps.clock(),
      })
      if (!authenticated.ok) {
        throw new Error(
          `Review lifecycle recovery approval refused: ${authenticated.code}`,
        )
      }
      const { bundle, bundleSha256 } = authenticated
      const evaluatedAt = new Date(bundle.request.lifecycle.evaluatedAt)
      const expectedTarget = {
        releaseSha: target.releaseSha,
        releaseManifestSha256: target.releaseManifestSha256,
        dataCellId: target.dataCellId,
        restorePointAt: target.restorePointAt.toISOString(),
        restoreDatabaseServiceName: target.restoreDatabaseServiceName,
        railwayProjectId: target.railwayProjectId,
        railwayEnvironmentId: target.railwayEnvironmentId,
        recoveryRunId: bundle.request.target.recoveryRunId,
        recoveryGeneration: bundle.request.target.recoveryGeneration,
      }
      const sourcePolicy = createGoogleSourceContentPolicy()
      if (
        canonicalizeRfc8785(bundle.request.target) !==
          canonicalizeRfc8785(expectedTarget) ||
        bundle.request.lifecycle.sourcePolicyVersion !== sourcePolicy.policyVersion ||
        bundle.request.lifecycle.retentionPolicyVersion !==
          REVIEW_SOURCE_CONTENT_LIFECYCLE_RETENTION_POLICY_VERSION ||
        bundle.request.lifecycle.policySha256 !== reviewLifecyclePolicySha256()
      ) {
        throw new Error('Review lifecycle recovery approval refused: wrong_target')
      }
      const lifecycleApproval = {
        approvalId: bundle.approval.approvalId,
        evidenceSha256: bundle.request.lifecycle.reportSha256,
        approvedAt: bundle.approval.approvedAt,
      }
      const authorizeApply: AuthorizeReviewSourceContentLifecycleApply = async (
        input,
      ) => {
        if (
          input.contract !== REVIEW_SOURCE_CONTENT_LIFECYCLE_CONTRACT ||
          input.evaluatedAt.getTime() !== evaluatedAt.getTime() ||
          canonicalizeRfc8785(input.scope) !==
            canonicalizeRfc8785(bundle.request.lifecycle.scope) ||
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
        authorizeApply,
      })
      const identity = {
        recoveryRunId: bundle.request.target.recoveryRunId,
        recoveryGeneration: bundle.request.target.recoveryGeneration,
        approvalId: bundle.approval.approvalId,
        approvalBundleSha256: bundleSha256,
      }
      const authority: ReviewLifecycleRecoveryExecutionAuthorityInput = {
        ...identity,
        state: 'applying',
        approverIdentity: bundle.approval.approverIdentity,
        approvalKeyId: bundle.approval.keyId,
        approvedAt: new Date(bundle.approval.approvedAt),
        expiresAt: new Date(bundle.approval.expiresAt),
        dataCellId: target.dataCellId,
        releaseSha: target.releaseSha,
        releaseManifestSha256: target.releaseManifestSha256,
        restorePointAt: target.restorePointAt,
        restoreDatabaseServiceName: target.restoreDatabaseServiceName,
        railwayProjectId: target.railwayProjectId,
        railwayEnvironmentId: target.railwayEnvironmentId,
        evaluatedAt,
        sourcePolicyVersion: bundle.request.lifecycle.sourcePolicyVersion,
        retentionPolicyVersion: bundle.request.lifecycle.retentionPolicyVersion,
        policySha256: bundle.request.lifecycle.policySha256,
        reportSha256: bundle.request.lifecycle.reportSha256,
        operatorId: target.operatorId,
        correlationId: target.correlationId,
      }
      let execution = await deps.executions.resume(authority)
      if (execution == null) {
        const evidence = await collectReviewLifecycleRecoveryEvidence(runLifecycle)
        const expectedRequest: ReviewLifecycleRecoveryApprovalRequest = {
          version: bundle.request.version,
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
        if (!sameRequest(bundle.request, expectedRequest)) {
          throw new Error('Review lifecycle recovery approval refused: wrong_target')
        }
        execution = await deps.executions.begin({
          ...authority,
          reportExpired: evidence.report.lifecycle.expired,
        })
      }

      const recoveryInput: RecoveryFenceInput = {
        dataCellId: target.dataCellId,
        sourceReleaseSha: target.releaseSha,
        sourceManifestSha256: target.releaseManifestSha256,
        restorePointAt: target.restorePointAt,
        operatorId: target.operatorId,
        correlationId: target.correlationId,
        runId: identity.recoveryRunId,
        generation: identity.recoveryGeneration,
      }

      return {
        recoveryInput,
        expired: execution.reportExpired,
        approvalId: identity.approvalId,
        approvalBundleSha256: identity.approvalBundleSha256,
        reportSha256: bundle.request.lifecycle.reportSha256,
        applyReviewLifecycle: async () => {
          if (execution.state === 'lifecycle_applied') return
          let checkpoint: ReviewSourceContentLifecycleCheckpoint | undefined =
            execution.checkpoint == null
              ? undefined
              : {
                  contract: REVIEW_SOURCE_CONTENT_LIFECYCLE_CONTRACT,
                  mode: 'apply' as const,
                  scope: bundle.request.lifecycle.scope,
                  evaluatedAt: bundle.request.lifecycle.evaluatedAt,
                  after: {
                    createdAt: execution.checkpoint.createdAt.toISOString(),
                    reviewId: execution.checkpoint.reviewId,
                  },
                  approval: lifecycleApproval,
                }
          try {
            do {
              const result = await runLifecycle({
                mode: 'apply',
                batchSize: REVIEW_SOURCE_CONTENT_LIFECYCLE_MAX_BATCH_SIZE,
                ...(checkpoint == null ? {} : { checkpoint }),
                applyConfirmation: REVIEW_SOURCE_CONTENT_LIFECYCLE_APPLY_CONFIRMATION,
                recoveryExecution: identity,
              })
              if (!result.apply.enabled) {
                throw new Error('Review lifecycle recovery apply authority disappeared')
              }
              checkpoint = result.nextCheckpoint ?? undefined
              if (checkpoint != null && result.scanned === 0) {
                throw new Error('Review lifecycle recovery checkpoint did not advance')
              }
            } while (checkpoint != null)
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
