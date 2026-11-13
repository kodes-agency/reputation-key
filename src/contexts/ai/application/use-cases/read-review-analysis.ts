import type { AuthContext } from '#/shared/domain/auth-context'
import type { OrganizationId, PropertyId, ReviewId } from '#/shared/domain/ids'
import type { AiAuthorizationPort } from '../ports/ai-authorization.port'
import type { AiOutputStorePort } from '../ports/ai-output-store.port'
import type { PropertyProcessingProfilePort } from '../ports/property-processing-profile.port'
import type { ReviewAnalysisReadV1 } from '../../domain/types'
import { resolveAiReadGate } from '../ai-read-gate'
import {
  requireAiPropertyReadAccess,
  type AiPropertyAccess,
} from '../ai-property-read-access'

export type ReadReviewAnalysisDependencies = Readonly<{
  propertyAccess: AiPropertyAccess
  authorization: AiAuthorizationPort
  outputs: AiOutputStorePort
  processingProfiles: PropertyProcessingProfilePort
  nowEpochMillis: () => number
  /**
   * The analysis profile a read echoes in its currentness: the one this build
   * runs (`review-analysis-runtime.ts`). The stored row decides what is
   * returned; this only names the profile the answer is current under.
   */
  reviewAnalysisProfileVersion: string
}>

export function createReadReviewAnalysis(dependencies: ReadReviewAnalysisDependencies): (
  input: Readonly<{
    organizationId: OrganizationId
    propertyId: PropertyId
    reviewId: ReviewId
    /** The reader, authorized for the Property before anything is read. */
    actor: AuthContext
    sourceEpoch: number
    sourceRevision: number
    analysisSequence: number
  }>,
) => Promise<ReviewAnalysisReadV1> {
  return async ({ actor, ...review }) => {
    // One review's analysis is read where the review is read, in the Inbox, so
    // it asks for the Inbox's permission on the review's Property.
    await requireAiPropertyReadAccess(
      dependencies.propertyAccess,
      actor,
      'inbox.read',
      review,
    )
    const gate = await resolveAiReadGate(dependencies, review, 'review_analysis')
    // Analysis additionally needs the lineage id, because it pins the read to
    // the exact authorization generation that produced the stored analysis.
    if (
      gate.status === 'disabled' ||
      gate.authorization.authorizationLineageId === null
    ) {
      return { status: 'disabled' }
    }
    return dependencies.outputs.readAnalysisForDelivery(
      {
        ...review,
        actorUserId: actor.userId,
        authorizationLineageId: gate.authorization.authorizationLineageId,
        reviewAnalysisEpoch: gate.authorization.capabilityEpochs.review_analysis.epoch,
        propertyProfileVersion: gate.profile.profileVersion,
        analysisProfileVersion: dependencies.reviewAnalysisProfileVersion,
        nowEpochMillis: dependencies.nowEpochMillis(),
      },
      async (result) => result,
    )
  }
}
