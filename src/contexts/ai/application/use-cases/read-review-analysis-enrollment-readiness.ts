import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import type { AiAuthorizationPort } from '../ports/ai-authorization.port'
import type { AiControlPort } from '../ports/ai-control.port'
import type {
  ReviewAnalysisEnrollmentFence,
  ReviewAnalysisEnrollmentStorePort,
} from '../ports/ai-review-analysis-enrollment.port'
import { isReviewAnalysisRevisionSetEvidence } from '../ports/ai-review-analysis-enrollment.port'
import { resolveAiExecutionStopFence } from '../ai-workflow-support'

export type ReviewAnalysisEnrollmentReadiness =
  | Readonly<{ status: 'disabled' }>
  | Readonly<{
      status: 'preparing'
      reason:
        'trigger_pending' | 'runtime_blocked' | 'enrollment_queued' | 'enrollment_running'
    }>
  | Readonly<{
      status: 'preparing'
      reason: 'assisted_approval_required'
      snapshotRevisionCount: number
      safetyCeiling: number
    }>
  | Readonly<{
      status: 'unavailable'
      reason: 'enrollment_superseded' | 'enrollment_stalled'
    }>
  | Readonly<{
      status: 'ready'
      fence: ReviewAnalysisEnrollmentFence
      snapshotRevisionCount: number
      snapshotRevisionSetDigest: string
      snapshotCapturedAtEpochMillis: number
      enrolledRevisionCount: number
      eligibleRevisionCount: number
      caughtUpAnalysisSequence: number
      revisionSetDigest: string
      caughtUpAtEpochMillis: number
    }>

export type ReadReviewAnalysisEnrollmentReadinessDependencies = Readonly<{
  authorization: AiAuthorizationPort
  control: AiControlPort
  enrollments: ReviewAnalysisEnrollmentStorePort
}>

function currentFence(
  authorization: NonNullable<
    Awaited<ReturnType<AiAuthorizationPort['readMerchantAuthorization']>>
  >,
): ReviewAnalysisEnrollmentFence | null {
  if (
    authorization.state !== 'enabled' ||
    !authorization.capabilities.includes('review_analysis') ||
    authorization.authorizationLineageId === null
  ) {
    return null
  }
  return {
    authorizationLineageId: authorization.authorizationLineageId,
    authorizationStateVersion: authorization.stateVersion,
    sourceEpoch: authorization.authorizedSourceEpoch,
    reviewAnalysisEpoch: authorization.capabilityEpochs.review_analysis.epoch,
    analysisStartSequence: authorization.reviewAnalysisStartSequence,
  }
}

function sameFence(
  left: ReviewAnalysisEnrollmentFence,
  right: ReviewAnalysisEnrollmentFence,
): boolean {
  return (
    left.authorizationLineageId === right.authorizationLineageId &&
    left.authorizationStateVersion === right.authorizationStateVersion &&
    left.sourceEpoch === right.sourceEpoch &&
    left.reviewAnalysisEpoch === right.reviewAnalysisEpoch &&
    left.analysisStartSequence === right.analysisStartSequence
  )
}

/**
 * Content-free readiness read for operators and dependent coordinators. A
 * completed capped repair run is never consulted: only the durable
 * authorization-scoped enrollment evidence can establish `ready`.
 */
export function createReadReviewAnalysisEnrollmentReadiness(
  dependencies: ReadReviewAnalysisEnrollmentReadinessDependencies,
): (
  input: Readonly<{
    organizationId: OrganizationId
    propertyId: PropertyId
  }>,
) => Promise<ReviewAnalysisEnrollmentReadiness> {
  return async (input) => {
    const authorization =
      await dependencies.authorization.readMerchantAuthorization(input)
    if (authorization === null) return { status: 'disabled' }
    const fence = currentFence(authorization)
    if (fence === null) return { status: 'disabled' }

    const evidence = await dependencies.enrollments.readCurrent(input)
    if (evidence === null || !sameFence(evidence.fence, fence)) {
      return { status: 'preparing', reason: 'trigger_pending' }
    }
    if (evidence.state === 'superseded') {
      return { status: 'unavailable', reason: 'enrollment_superseded' }
    }
    if (evidence.state === 'stalled') {
      return { status: 'unavailable', reason: 'enrollment_stalled' }
    }
    if (evidence.state === 'awaiting_assisted_approval') {
      return {
        status: 'preparing',
        reason: 'assisted_approval_required',
        snapshotRevisionCount: evidence.snapshotRevisionCount,
        safetyCeiling: evidence.safetyCeiling,
      }
    }

    const stopFence = await resolveAiExecutionStopFence(dependencies.control, {
      providerDeploymentProfileVersion: authorization.providerDeploymentProfileVersion,
      capability: 'review_analysis',
    })
    if (stopFence === null) {
      return { status: 'preparing', reason: 'runtime_blocked' }
    }

    if (evidence.state === 'queued') {
      return { status: 'preparing', reason: 'enrollment_queued' }
    }
    if (evidence.state === 'running') {
      return { status: 'preparing', reason: 'enrollment_running' }
    }

    const eligibleRevisionCount = evidence.caughtUpEligibleRevisionCount
    const caughtUpAnalysisSequence = evidence.caughtUpAnalysisSequence
    const revisionSetDigest = evidence.caughtUpRevisionSetDigest
    const caughtUpAtEpochMillis = evidence.caughtUpAtEpochMillis
    if (
      eligibleRevisionCount === null ||
      caughtUpAnalysisSequence === null ||
      revisionSetDigest === null ||
      caughtUpAtEpochMillis === null ||
      !Number.isSafeInteger(caughtUpAtEpochMillis) ||
      caughtUpAtEpochMillis < 0 ||
      !Number.isSafeInteger(evidence.snapshotCapturedAtEpochMillis) ||
      evidence.snapshotCapturedAtEpochMillis < 0 ||
      evidence.activeRunId !== null ||
      evidence.terminalReason !== 'eligible_revision_set_caught_up' ||
      evidence.snapshotCapturedAtEpochMillis > caughtUpAtEpochMillis ||
      caughtUpAnalysisSequence < fence.analysisStartSequence ||
      !isReviewAnalysisRevisionSetEvidence({
        revisionCount: evidence.snapshotRevisionCount,
        revisionSetDigest: evidence.snapshotRevisionSetDigest,
      }) ||
      !isReviewAnalysisRevisionSetEvidence({
        revisionCount: eligibleRevisionCount,
        revisionSetDigest,
      })
    ) {
      return { status: 'unavailable', reason: 'enrollment_stalled' }
    }
    return {
      status: 'ready',
      fence,
      snapshotRevisionCount: evidence.snapshotRevisionCount,
      snapshotRevisionSetDigest: evidence.snapshotRevisionSetDigest,
      snapshotCapturedAtEpochMillis: evidence.snapshotCapturedAtEpochMillis,
      enrolledRevisionCount: evidence.enrolledRevisionCount,
      eligibleRevisionCount,
      caughtUpAnalysisSequence,
      revisionSetDigest,
      caughtUpAtEpochMillis,
    }
  }
}
