import type { AiAuthorizationPort } from '../ports/ai-authorization.port'
import type { AiControlPort } from '../ports/ai-control.port'
import type {
  ReviewAnalysisEnrollmentFence,
  ReviewAnalysisEnrollmentHead,
  ReviewAnalysisEnrollmentStorePort,
} from '../ports/ai-review-analysis-enrollment.port'
import { resolveAiExecutionStopFence } from '../ai-workflow-support'

/** Enrollment heads visited per recovery tick. */
const AI_REVIEW_ANALYSIS_ENROLLMENT_SWEEP_BATCH_SIZE = 50

export type AdvanceReviewAnalysisEnrollmentSweepResult = Readonly<{
  enrollmentsVisited: number
  runtimeBlocked: number
  replaysStarted: number
  revisionsPinned: number
  waitingForReplay: number
  enrollmentsCaughtUp: number
  enrollmentsSuperseded: number
  enrollmentsStalled: number
  batchFull: boolean
}>

export type AdvanceReviewAnalysisEnrollments = Readonly<{
  sweep: () => Promise<AdvanceReviewAnalysisEnrollmentSweepResult>
}>

export type AdvanceReviewAnalysisEnrollmentDependencies = Readonly<{
  authorization: AiAuthorizationPort
  control: AiControlPort
  enrollments: ReviewAnalysisEnrollmentStorePort
  nowEpochMillis: () => number
}>

function matchesFence(
  authorization: NonNullable<
    Awaited<ReturnType<AiAuthorizationPort['readMerchantAuthorization']>>
  >,
  fence: ReviewAnalysisEnrollmentFence,
): boolean {
  return (
    authorization.state === 'enabled' &&
    authorization.capabilities.includes('review_analysis') &&
    authorization.authorizationLineageId === fence.authorizationLineageId &&
    authorization.stateVersion === fence.authorizationStateVersion &&
    authorization.authorizedSourceEpoch === fence.sourceEpoch &&
    authorization.capabilityEpochs.review_analysis.epoch === fence.reviewAnalysisEpoch &&
    authorization.reviewAnalysisStartSequence === fence.analysisStartSequence
  )
}

function supersessionReason(
  authorization: Awaited<ReturnType<AiAuthorizationPort['readMerchantAuthorization']>>,
  head: ReviewAnalysisEnrollmentHead,
): 'authorization_changed' | 'source_epoch_changed' | null {
  if (authorization === null) return 'authorization_changed'
  if (authorization.authorizedSourceEpoch !== head.fence.sourceEpoch) {
    return 'source_epoch_changed'
  }
  return matchesFence(authorization, head.fence) ? null : 'authorization_changed'
}

/**
 * Advance durable first-enablement intents without making the intent itself an
 * activation switch. The exact global/provider/capability control triple must
 * already be accepting before a replay run can open. A dark runtime therefore
 * leaves the durable intent queued and produces no provider-bound event.
 */
export function createAdvanceReviewAnalysisEnrollments(
  dependencies: AdvanceReviewAnalysisEnrollmentDependencies,
): AdvanceReviewAnalysisEnrollments {
  return {
    async sweep() {
      const heads = await dependencies.enrollments.listActionable(
        AI_REVIEW_ANALYSIS_ENROLLMENT_SWEEP_BATCH_SIZE,
      )
      const counts = {
        enrollmentsVisited: heads.length,
        runtimeBlocked: 0,
        replaysStarted: 0,
        revisionsPinned: 0,
        waitingForReplay: 0,
        enrollmentsCaughtUp: 0,
        enrollmentsSuperseded: 0,
        enrollmentsStalled: 0,
        batchFull: heads.length === AI_REVIEW_ANALYSIS_ENROLLMENT_SWEEP_BATCH_SIZE,
      }

      for (const head of heads) {
        const authorization = await dependencies.authorization.readMerchantAuthorization({
          organizationId: head.organizationId,
          propertyId: head.propertyId,
        })
        const moved = supersessionReason(authorization, head)
        if (moved !== null) {
          const superseded = await dependencies.enrollments.markSuperseded({
            enrollmentId: head.id,
            expectedFence: head.fence,
            reason: moved,
            occurredAt: new Date(dependencies.nowEpochMillis()),
          })
          if (superseded) counts.enrollmentsSuperseded += 1
          continue
        }

        // Non-null and enabled by matchesFence above.
        const current = authorization!
        const stopFence = await resolveAiExecutionStopFence(dependencies.control, {
          providerDeploymentProfileVersion: current.providerDeploymentProfileVersion,
          capability: 'review_analysis',
        })
        if (stopFence === null) {
          counts.runtimeBlocked += 1
          continue
        }

        const result = await dependencies.enrollments.reconcile({
          enrollmentId: head.id,
          expectedFence: head.fence,
          // Enrollment ids are UUIDs and are content-free. Reusing the durable
          // authority id makes every replay generation traceable without
          // introducing a non-recoverable random correlation in the sweep.
          correlationId: head.id,
          occurredAt: new Date(dependencies.nowEpochMillis()),
        })
        switch (result.status) {
          case 'awaiting_assisted_approval':
            // `listActionable` excludes this state. Preserve the explicit
            // outcome defensively if approval is concurrently invalidated.
            break
          case 'waiting_for_replay':
            counts.waitingForReplay += 1
            break
          case 'replay_started':
            counts.replaysStarted += 1
            counts.revisionsPinned += result.pinnedRevisionCount
            break
          case 'caught_up':
            counts.enrollmentsCaughtUp += 1
            break
          case 'superseded':
            counts.enrollmentsSuperseded += 1
            break
          case 'stalled':
            counts.enrollmentsStalled += 1
            break
        }
      }

      return counts
    },
  }
}
