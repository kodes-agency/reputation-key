import { createHash } from 'node:crypto'
import type {
  RestoreReviewLifecycleAuthority,
  RestoreReviewLifecycleRuntimeTarget,
} from '#/shared/ops/restore-verify'
import {
  createReviewLifecycleRecoveryApprovalRequest,
  REVIEW_LIFECYCLE_RECOVERY_APPROVAL_VERSION,
} from '#/shared/ops/review-lifecycle-recovery-approval'
import { canonicalizeRfc8785 } from '#/shared/canonical-json'
import { CLOSED_BETA_RAILWAY_ENVIRONMENT_NAME } from '#/shared/release/railway-deployment-profile'
import type { ReviewLifecycleRecoveryExecutionStore } from './ports/lifecycle-recovery-execution-store.port'
import { createRunReviewLifecycleRecoveryExecutor } from './use-cases/run-lifecycle-recovery-executor'
import { prepareReviewLifecycleRecoveryApproval } from './use-cases/prepare-lifecycle-recovery-approval'
import {
  REVIEW_SOURCE_CONTENT_LIFECYCLE_CONTRACT,
  REVIEW_SOURCE_CONTENT_LIFECYCLE_MAX_BATCH_SIZE,
  type AuthorizeReviewSourceContentLifecycleApply,
  type RunReviewSourceContentLifecycle,
} from './use-cases/run-source-content-lifecycle'

export type ReviewLifecycleRecoveryAuthorityFactory = Readonly<{
  createAuthority: (
    configuration: Readonly<{
      environmentConfirmation?: string
    }>,
  ) => RestoreReviewLifecycleAuthority
}>

type RecoveryMaintenanceDeps = Readonly<{
  clock: () => Date
  createRunLifecycle: (input: {
    clock: () => Date
    authorizeApply?: AuthorizeReviewSourceContentLifecycleApply
  }) => RunReviewSourceContentLifecycle
  executions: ReviewLifecycleRecoveryExecutionStore
  createRecoveryRunId: () => string
  loadNextRecoveryGeneration: () => Promise<number>
}>

/** Review's restore-only admission retains frozen evidence and durable progress. */
export function createReviewLifecycleRecoveryAuthorityFactory(
  deps: RecoveryMaintenanceDeps,
): ReviewLifecycleRecoveryAuthorityFactory {
  const prepare = (target: RestoreReviewLifecycleRuntimeTarget) =>
    prepareReviewLifecycleRecoveryApproval(target, {
      clock: deps.clock,
      createRunLifecycle: (clock) => deps.createRunLifecycle({ clock }),
      createRecoveryRunId: deps.createRecoveryRunId,
      loadNextRecoveryGeneration: deps.loadNextRecoveryGeneration,
    })
  return Object.freeze({
    createAuthority: (configuration) => {
      if (configuration.environmentConfirmation === undefined) {
        return {
          kind: 'inspection_only',
          reason: 'environment_confirmation_required',
          prepare: async (target) => {
            const plan = await prepare(target)
            return { ...plan, expired: plan.report.lifecycle.expired }
          },
        }
      }
      if (
        configuration.environmentConfirmation !== CLOSED_BETA_RAILWAY_ENVIRONMENT_NAME
      ) {
        throw new Error('Confirm the restore environment with --yes closed-beta-v2')
      }
      const executor = createRunReviewLifecycleRecoveryExecutor({
        environmentConfirmation: configuration.environmentConfirmation,
        clock: deps.clock,
        createRunLifecycle: deps.createRunLifecycle,
        executions: deps.executions,
        prepare: async (target) => {
          const active = await deps.executions.loadActive()
          if (active) {
            const { request } = createReviewLifecycleRecoveryApprovalRequest({
              version: REVIEW_LIFECYCLE_RECOVERY_APPROVAL_VERSION,
              kind: 'review-lifecycle-recovery',
              target: {
                releaseSha: active.releaseSha,
                releaseManifestSha256: active.releaseManifestSha256,
                restorePointAt: active.restorePointAt.toISOString(),
                restoreDatabaseServiceName: active.restoreDatabaseServiceName,
                railwayProjectId: active.railwayProjectId,
                railwayEnvironmentId: active.railwayEnvironmentId,
                recoveryRunId: active.recoveryRunId,
                recoveryGeneration: active.recoveryGeneration,
              },
              lifecycle: {
                contract: REVIEW_SOURCE_CONTENT_LIFECYCLE_CONTRACT,
                scope: { kind: 'expired' },
                evaluatedAt: active.evaluatedAt.toISOString(),
                batchSize: REVIEW_SOURCE_CONTENT_LIFECYCLE_MAX_BATCH_SIZE,
                sourcePolicyVersion: active.sourcePolicyVersion,
                retentionPolicyVersion: active.retentionPolicyVersion,
                policySha256: active.policySha256,
                reportSha256: active.reportSha256,
              },
            })
            return { request, authority: active }
          }
          const plan = await prepare(target)
          const approvedAt = deps.clock()
          const confirmation = canonicalizeRfc8785({
            environment: CLOSED_BETA_RAILWAY_ENVIRONMENT_NAME,
            operatorId: target.operatorId,
            confirmedAt: approvedAt.toISOString(),
            request: plan.request,
          })
          return {
            request: plan.request,
            authority: {
              state: 'applying',
              recoveryRunId: plan.request.target.recoveryRunId,
              recoveryGeneration: plan.request.target.recoveryGeneration,
              // Existing receipt columns retain their stored names until contraction.
              approvalId: `restore:${plan.request.target.recoveryRunId}`,
              approvalBundleSha256: createHash('sha256')
                .update(confirmation)
                .digest('hex'),
              approverIdentity: target.operatorId,
              approvalKeyId: 'typed-environment',
              approvedAt,
              expiresAt: new Date(approvedAt.getTime() + 24 * 60 * 60 * 1000),
              ...target,
              evaluatedAt: new Date(plan.request.lifecycle.evaluatedAt),
              sourcePolicyVersion: plan.request.lifecycle.sourcePolicyVersion,
              retentionPolicyVersion: plan.request.lifecycle.retentionPolicyVersion,
              policySha256: plan.request.lifecycle.policySha256,
              reportSha256: plan.reportSha256,
            },
          }
        },
      })
      return { kind: 'confirmed_apply', admit: executor.admit }
    },
  })
}
