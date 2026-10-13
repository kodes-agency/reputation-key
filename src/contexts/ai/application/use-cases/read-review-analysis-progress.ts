import type { AuthContext } from '#/shared/domain/auth-context'
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import { resolveAiReadGate, type AiReadGateDependencies } from '../ai-read-gate'
import {
  requireAiPropertyReadAccess,
  type AiPropertyAccess,
} from '../ai-property-read-access'
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
    propertyAccess: AiPropertyAccess
    backlog: Pick<AiReviewAnalysisBacklogPort, 'readProgress'>
    readEnrollmentReadiness: (
      input: Readonly<{ organizationId: OrganizationId; propertyId: PropertyId }>,
    ) => Promise<ReviewAnalysisEnrollmentReadiness>
  }>

/**
 * How far Review Analysis has got for a property: what is waiting, what is
 * running, what has a result and what could not be analysed. Content-free
 * counts, read by a dashboard reader of the Property, behind the same live AI
 * read gate as every analysis read.
 */
export function createReadReviewAnalysisProgress(
  dependencies: ReadReviewAnalysisProgressDependencies,
) {
  return async ({
    actor,
    ...property
  }: Readonly<{
    organizationId: OrganizationId
    propertyId: PropertyId
    /** The reader, authorized for the Property before anything is read. */
    actor: AuthContext
  }>): Promise<ReviewAnalysisProgress> => {
    await requireAiPropertyReadAccess(
      dependencies.propertyAccess,
      actor,
      'dashboard.read',
      property,
    )
    const gate = await resolveAiReadGate(dependencies, property, 'review_analysis')
    if (gate.status === 'disabled') return { status: 'disabled' }
    const [progress, readiness] = await Promise.all([
      dependencies.backlog.readProgress({
        ...property,
        sourceEpoch: gate.authorization.authorizedSourceEpoch,
        reviewAnalysisEpoch: gate.authorization.capabilityEpochs.review_analysis.epoch,
      }),
      dependencies.readEnrollmentReadiness(property),
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
