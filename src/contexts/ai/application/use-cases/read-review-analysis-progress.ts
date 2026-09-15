import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import { resolveAiReadGate, type AiReadGateDependencies } from '../ai-read-gate'
import type { AiReviewAnalysisBacklogPort } from '../ports/ai-review-analysis-backlog.port'
import type { ReviewAnalysisEnrollmentReadiness } from './read-review-analysis-enrollment-readiness'

export type ReviewAnalysisProgress =
  | Readonly<{ status: 'disabled' }>
  | Readonly<{
      /** `analysing` while work is queued, running, or enrollment is preparing. */
      status: 'analysing' | 'caught_up'
      queued: number
      inProgress: number
      analysed: number
      /** Settled without a result: no text, unsupported language, expired source. */
      notAnalysable: number
      /** When enrollment last proved the whole eligible history was covered. */
      verifiedThroughEpochMillis: number | null
    }>

export type ReadReviewAnalysisProgressDependencies = AiReadGateDependencies &
  Readonly<{
    backlog: Pick<AiReviewAnalysisBacklogPort, 'readProgress'>
    readEnrollmentReadiness: (
      input: Readonly<{ organizationId: OrganizationId; propertyId: PropertyId }>,
    ) => Promise<ReviewAnalysisEnrollmentReadiness>
  }>

/**
 * How far Review Analysis has got for a property: what is waiting, what is
 * running, what has a result and what could not be analysed. Content-free
 * counts behind the same live AI read gate as every analysis read.
 */
export function createReadReviewAnalysisProgress(
  dependencies: ReadReviewAnalysisProgressDependencies,
) {
  return async (
    input: Readonly<{ organizationId: OrganizationId; propertyId: PropertyId }>,
  ): Promise<ReviewAnalysisProgress> => {
    const gate = await resolveAiReadGate(dependencies, input, 'review_analysis')
    if (gate.status === 'disabled') return { status: 'disabled' }
    const [progress, readiness] = await Promise.all([
      dependencies.backlog.readProgress({
        ...input,
        sourceEpoch: gate.authorization.authorizedSourceEpoch,
        reviewAnalysisEpoch: gate.authorization.capabilityEpochs.review_analysis.epoch,
      }),
      dependencies.readEnrollmentReadiness(input),
    ])
    const analysing =
      progress.queued + progress.inProgress > 0 || readiness.status === 'preparing'
    return {
      status: analysing ? 'analysing' : 'caught_up',
      queued: progress.queued,
      inProgress: progress.inProgress,
      analysed: progress.analysed,
      notAnalysable: Math.max(0, progress.settled - progress.analysed),
      verifiedThroughEpochMillis:
        readiness.status === 'ready' ? readiness.caughtUpAtEpochMillis : null,
    }
  }
}
