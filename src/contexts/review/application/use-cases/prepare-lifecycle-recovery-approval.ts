import {
  createReviewLifecycleRecoveryApprovalRequest,
  REVIEW_LIFECYCLE_RECOVERY_APPROVAL_VERSION,
  type ReviewLifecycleRecoveryApprovalRequest,
  type ReviewLifecycleRecoveryRuntimeTarget,
} from '#/shared/ops/review-lifecycle-recovery-approval'
import { canonicalizeRfc8785 } from '#/shared/canonical-json'
import { collectReviewLifecycleRecoveryEvidence } from './collect-lifecycle-recovery-evidence'
import type { RunReviewSourceContentLifecycle } from './run-source-content-lifecycle'

export type ReviewLifecycleRecoveryApprovalPlan = Readonly<{
  request: ReviewLifecycleRecoveryApprovalRequest
  requestContent: string
  requestSha256: string
  report: Awaited<ReturnType<typeof collectReviewLifecycleRecoveryEvidence>>['report']
  reportContent: string
  reportSha256: string
}>

type PrepareReviewLifecycleRecoveryApprovalDeps = Readonly<{
  clock: () => Date
  createRunLifecycle: (clock: () => Date) => RunReviewSourceContentLifecycle
  createRecoveryRunId: () => string
  loadNextRecoveryGeneration: (dataCellId: string) => Promise<number>
}>

/**
 * Read-only preparation for independent approval. It freezes one lifecycle
 * window, drains report + shadow, and emits only aggregate evidence and the
 * canonical exact-target request. A later executor re-collects the digest.
 */
export async function prepareReviewLifecycleRecoveryApproval(
  target: ReviewLifecycleRecoveryRuntimeTarget,
  deps: PrepareReviewLifecycleRecoveryApprovalDeps,
): Promise<ReviewLifecycleRecoveryApprovalPlan> {
  const evaluatedAt = deps.clock()
  if (
    Number.isNaN(evaluatedAt.getTime()) ||
    evaluatedAt.getTime() < target.restorePointAt.getTime()
  ) {
    throw new Error(
      'Review lifecycle recovery approval window cannot precede the restore point',
    )
  }
  const frozenClock = () => new Date(evaluatedAt)
  const evidence = await collectReviewLifecycleRecoveryEvidence(
    deps.createRunLifecycle(frozenClock),
  )
  if (evidence.report.evaluatedAt !== evaluatedAt.toISOString()) {
    throw new Error('Review lifecycle recovery approval report changed its frozen clock')
  }

  const [recoveryRunId, recoveryGeneration] = await Promise.all([
    Promise.resolve(deps.createRecoveryRunId()),
    deps.loadNextRecoveryGeneration(target.dataCellId),
  ])
  const artifact = createReviewLifecycleRecoveryApprovalRequest({
    version: REVIEW_LIFECYCLE_RECOVERY_APPROVAL_VERSION,
    kind: 'review-lifecycle-recovery',
    target: {
      releaseSha: target.releaseSha,
      releaseManifestSha256: target.releaseManifestSha256,
      dataCellId: target.dataCellId,
      restorePointAt: target.restorePointAt.toISOString(),
      restoreDatabaseServiceName: target.restoreDatabaseServiceName,
      railwayProjectId: target.railwayProjectId,
      railwayEnvironmentId: target.railwayEnvironmentId,
      recoveryRunId,
      recoveryGeneration,
    },
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
  })
  return {
    request: artifact.request,
    requestContent: artifact.content,
    requestSha256: artifact.sha256,
    report: evidence.report,
    reportContent: `${canonicalizeRfc8785(evidence.report)}\n`,
    reportSha256: evidence.sha256,
  }
}
