import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import type { AiAuthorizationPort } from '../ports/ai-authorization.port'
import type { AiControlPort } from '../ports/ai-control.port'
import type {
  ReviewAnalysisEnrollmentFence,
  ReviewAnalysisEnrollmentHead,
  ReviewAnalysisEnrollmentReconcileResult,
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

/** What advancing one enrollment did. */
export type ReviewAnalysisEnrollmentAdvance =
  /** The authorization moved past the enrollment's fence; `marked` when this call retired it. */
  | Readonly<{ status: 'fence_moved'; marked: boolean }>
  /** Provider execution is dark, so the intent stays queued. */
  | Readonly<{ status: 'runtime_blocked' }>
  /** The Property has no queued or running enrollment. */
  | Readonly<{ status: 'not_actionable' }>
  | ReviewAnalysisEnrollmentReconcileResult

export type AdvanceReviewAnalysisEnrollments = Readonly<{
  sweep: () => Promise<AdvanceReviewAnalysisEnrollmentSweepResult>
  /**
   * Advance one Property's current enrollment now rather than at the next
   * sweep: open its replay as soon as the intent is committed, and record it
   * caught up as soon as its last replayed review settles. The checks are the
   * sweep's own; the sweep stays the recovery path.
   */
  advanceProperty: (
    input: Readonly<{ organizationId: OrganizationId; propertyId: PropertyId }>,
  ) => Promise<ReviewAnalysisEnrollmentAdvance>
}>

export type AdvanceReviewAnalysisEnrollmentDependencies = Readonly<{
  authorization: AiAuthorizationPort
  control: AiControlPort
  enrollments: ReviewAnalysisEnrollmentStorePort
  nowEpochMillis: () => number
}>

type EnrollmentTarget = Pick<
  ReviewAnalysisEnrollmentHead,
  'id' | 'organizationId' | 'propertyId' | 'fence'
>

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
  target: EnrollmentTarget,
): 'authorization_changed' | 'source_epoch_changed' | null {
  if (authorization === null) return 'authorization_changed'
  if (authorization.authorizedSourceEpoch !== target.fence.sourceEpoch) {
    return 'source_epoch_changed'
  }
  return matchesFence(authorization, target.fence) ? null : 'authorization_changed'
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
  async function advance(
    target: EnrollmentTarget,
  ): Promise<ReviewAnalysisEnrollmentAdvance> {
    const authorization = await dependencies.authorization.readMerchantAuthorization({
      organizationId: target.organizationId,
      propertyId: target.propertyId,
    })
    const moved = supersessionReason(authorization, target)
    if (moved !== null) {
      const marked = await dependencies.enrollments.markSuperseded({
        enrollmentId: target.id,
        organizationId: target.organizationId,
        expectedFence: target.fence,
        reason: moved,
        occurredAt: new Date(dependencies.nowEpochMillis()),
      })
      return { status: 'fence_moved', marked }
    }

    // Non-null and enabled by matchesFence above.
    const current = authorization!
    const stopFence = await resolveAiExecutionStopFence(dependencies.control, {
      providerDeploymentProfileVersion: current.providerDeploymentProfileVersion,
      capability: 'review_analysis',
    })
    if (stopFence === null) return { status: 'runtime_blocked' }

    return dependencies.enrollments.reconcile({
      enrollmentId: target.id,
      organizationId: target.organizationId,
      expectedFence: target.fence,
      // Enrollment ids are UUIDs and are content-free. Reusing the durable
      // authority id makes every replay generation traceable without
      // introducing a non-recoverable random correlation in the sweep.
      correlationId: target.id,
      occurredAt: new Date(dependencies.nowEpochMillis()),
    })
  }

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
        const result = await advance(head)
        switch (result.status) {
          case 'fence_moved':
            if (result.marked) counts.enrollmentsSuperseded += 1
            break
          case 'runtime_blocked':
            counts.runtimeBlocked += 1
            break
          case 'not_actionable':
          case 'awaiting_assisted_approval':
            // `listActionable` excludes both. Preserve the explicit outcome
            // defensively if approval is concurrently invalidated.
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

    async advanceProperty(input) {
      const current = await dependencies.enrollments.readCurrent(input)
      if (
        current === null ||
        (current.state !== 'queued' && current.state !== 'running')
      ) {
        return { status: 'not_actionable' }
      }
      return advance(current)
    },
  }
}
