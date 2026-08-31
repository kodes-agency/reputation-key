import type { KeyObject } from 'node:crypto'
import type {
  RestoreReviewLifecycleAuthority,
  RestoreReviewLifecycleRuntimeTarget,
} from '#/shared/ops/restore-verify'
import { loadReviewLifecycleRecoveryApprovalPublicKeys } from '#/shared/ops/review-lifecycle-recovery-approval'
import type { ReviewLifecycleRecoveryExecutionStore } from './ports/lifecycle-recovery-execution-store.port'
import { createRunReviewLifecycleRecoveryExecutor } from './use-cases/run-lifecycle-recovery-executor'
import { prepareReviewLifecycleRecoveryApproval } from './use-cases/prepare-lifecycle-recovery-approval'
import type {
  AuthorizeReviewSourceContentLifecycleApply,
  RunReviewSourceContentLifecycle,
} from './use-cases/run-source-content-lifecycle'

export type ReviewLifecycleRecoveryApprovalConfiguration = Readonly<{
  approvalContent?: string
  approvalBundleSha256?: string
  approvalPublicKeysJson?: string
}>

export type ReviewLifecycleRecoveryAuthorityFactory = Readonly<{
  createAuthority: (
    configuration: ReviewLifecycleRecoveryApprovalConfiguration,
  ) => RestoreReviewLifecycleAuthority
}>

type CreateRunLifecycle = (input: {
  clock: () => Date
  authorizeApply?: AuthorizeReviewSourceContentLifecycleApply
}) => RunReviewSourceContentLifecycle

type RecoveryMaintenanceDeps = Readonly<{
  clock: () => Date
  createRunLifecycle: CreateRunLifecycle
  executions: ReviewLifecycleRecoveryExecutionStore
  createRecoveryRunId: () => string
  loadNextRecoveryGeneration: (dataCellId: string) => Promise<number>
  loadTrustedPublicKeys?: (encodedJson: string) => ReadonlyMap<string, KeyObject>
}>

function completeApprovalConfiguration(
  configuration: ReviewLifecycleRecoveryApprovalConfiguration,
): configuration is Required<ReviewLifecycleRecoveryApprovalConfiguration> {
  return (
    configuration.approvalContent !== undefined &&
    configuration.approvalBundleSha256 !== undefined &&
    configuration.approvalPublicKeysJson !== undefined
  )
}

/**
 * Review-owned restore authority factory. Missing/partial credentials can
 * produce aggregate inspection evidence only; complete credentials are parsed
 * and signature-checked by the sealed executor before any mutation.
 */
export function createReviewLifecycleRecoveryAuthorityFactory(
  deps: RecoveryMaintenanceDeps,
): ReviewLifecycleRecoveryAuthorityFactory {
  return Object.freeze({
    createAuthority: (configuration) => {
      if (completeApprovalConfiguration(configuration)) {
        const executor = createRunReviewLifecycleRecoveryExecutor({
          approvalContent: configuration.approvalContent,
          approvalBundleSha256: configuration.approvalBundleSha256,
          trustedPublicKeys: (
            deps.loadTrustedPublicKeys ?? loadReviewLifecycleRecoveryApprovalPublicKeys
          )(configuration.approvalPublicKeysJson),
          clock: deps.clock,
          createRunLifecycle: ({ clock, authorizeApply }) =>
            deps.createRunLifecycle({ clock, authorizeApply }),
          executions: deps.executions,
        })
        return { kind: 'reviewed_apply', admit: executor.admit }
      }

      return {
        kind: 'inspection_only',
        reason: 'reviewed_cutover_authority_required',
        prepare: async (target: RestoreReviewLifecycleRuntimeTarget) => {
          const plan = await prepareReviewLifecycleRecoveryApproval(target, {
            clock: deps.clock,
            createRunLifecycle: (clock) => deps.createRunLifecycle({ clock }),
            createRecoveryRunId: deps.createRecoveryRunId,
            loadNextRecoveryGeneration: deps.loadNextRecoveryGeneration,
          })
          return {
            requestContent: plan.requestContent,
            requestSha256: plan.requestSha256,
            reportContent: plan.reportContent,
            reportSha256: plan.reportSha256,
            expired: plan.report.lifecycle.expired,
          }
        },
      }
    },
  })
}
