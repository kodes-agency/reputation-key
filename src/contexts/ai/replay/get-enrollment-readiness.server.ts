import { getAiRuntimeCapability } from '#/shared/merchant-ai-notice/ai-runtime-capability-contract'
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import type { AiAuthorizationPort } from '../consent/ai-authorization.port.server'
import type { AiControlPort } from '../application/ports/ai-control.port'
import type {
  ReviewAnalysisEnrollmentEvidence,
  ReviewAnalysisEnrollmentFence,
  ReviewAnalysisEnrollmentStorePort,
} from './contracts'
import { isReviewAnalysisRevisionSetEvidence } from './contracts'
import { resolveAiExecutionStopFence } from '../application/ai-workflow-support'

/** What the progress read needs: whether enrollment is still working, whether it needs attention, and when it last verified the whole history. */
export type ReviewAnalysisEnrollmentReadiness = Readonly<{
  analysing: boolean
  needsAttention: boolean
  verifiedThroughEpochMillis: number | null
}>

const NOT_ENROLLED: ReviewAnalysisEnrollmentReadiness = {
  analysing: false,
  needsAttention: false,
  verifiedThroughEpochMillis: null,
}
const ANALYSING: ReviewAnalysisEnrollmentReadiness = { ...NOT_ENROLLED, analysing: true }
const NEEDS_ATTENTION: ReviewAnalysisEnrollmentReadiness = {
  ...NOT_ENROLLED,
  needsAttention: true,
}

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

/** The caught-up facts, once every one of them is known to be present. */
type CaughtUpFacts = Readonly<{
  eligibleRevisionCount: number
  caughtUpAnalysisSequence: number
  revisionSetDigest: string
  caughtUpAtEpochMillis: number
}>

/**
 * Whether present caught-up evidence is internally consistent enough to be
 * read as verified: bounded timestamps in the right order, no run still open,
 * the terminal reason this readiness depends on, a sequence at or past the
 * authorization's start, and two well-formed revision-set proofs.
 */
function caughtUpEvidenceIsSound(
  evidence: ReviewAnalysisEnrollmentEvidence,
  fence: ReviewAnalysisEnrollmentFence,
  facts: CaughtUpFacts,
): boolean {
  return (
    Number.isSafeInteger(facts.caughtUpAtEpochMillis) &&
    facts.caughtUpAtEpochMillis >= 0 &&
    Number.isSafeInteger(evidence.snapshotCapturedAtEpochMillis) &&
    evidence.snapshotCapturedAtEpochMillis >= 0 &&
    evidence.terminalReason === 'eligible_revision_set_caught_up' &&
    evidence.snapshotCapturedAtEpochMillis <= facts.caughtUpAtEpochMillis &&
    facts.caughtUpAnalysisSequence >= fence.analysisStartSequence &&
    isReviewAnalysisRevisionSetEvidence({
      revisionCount: evidence.snapshotRevisionCount,
      revisionSetDigest: evidence.snapshotRevisionSetDigest,
    }) &&
    isReviewAnalysisRevisionSetEvidence({
      revisionCount: facts.eligibleRevisionCount,
      revisionSetDigest: facts.revisionSetDigest,
    })
  )
}

/**
 * Content-free readiness read for the progress card. A completed capped repair
 * run is never consulted: only the durable authorization-scoped enrollment
 * evidence can establish a verified-through time.
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
    if (authorization === null) return NOT_ENROLLED
    const fence = currentFence(authorization)
    if (fence === null) return NOT_ENROLLED

    const evidence = await dependencies.enrollments.readCurrent(input)
    if (evidence === null || !sameFence(evidence.fence, fence)) return ANALYSING
    if (evidence.state === 'superseded' || evidence.state === 'stalled') {
      return NEEDS_ATTENTION
    }
    if (evidence.state === 'awaiting_assisted_approval') return ANALYSING

    const stopFence = await resolveAiExecutionStopFence(dependencies.control, {
      providerDeploymentProfileVersion:
        getAiRuntimeCapability('review_analysis').providerDeploymentProfileVersion,
      capability: 'review_analysis',
    })
    if (stopFence === null) return ANALYSING
    if (evidence.state === 'queued' || evidence.state === 'running') return ANALYSING

    const eligibleRevisionCount = evidence.caughtUpEligibleRevisionCount
    const caughtUpAnalysisSequence = evidence.caughtUpAnalysisSequence
    const revisionSetDigest = evidence.caughtUpRevisionSetDigest
    const caughtUpAtEpochMillis = evidence.caughtUpAtEpochMillis
    if (
      eligibleRevisionCount === null ||
      caughtUpAnalysisSequence === null ||
      revisionSetDigest === null ||
      caughtUpAtEpochMillis === null ||
      !caughtUpEvidenceIsSound(evidence, fence, {
        eligibleRevisionCount,
        caughtUpAnalysisSequence,
        revisionSetDigest,
        caughtUpAtEpochMillis,
      })
    ) {
      return NEEDS_ATTENTION
    }
    return { ...NOT_ENROLLED, verifiedThroughEpochMillis: caughtUpAtEpochMillis }
  }
}
