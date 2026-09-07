import type { OrganizationId, PropertyId, ReviewId, UserId } from '#/shared/domain/ids'
import type { AiAuthorizationPort } from '../ports/ai-authorization.port'
import type { AiOutputStorePort, AiTrendReportRead } from '../ports/ai-output-store.port'
import type { PropertyProcessingProfilePort } from '../ports/property-processing-profile.port'
import type { ReviewAnalysisReadV1 } from '../../domain/types'
import { resolveAiReadGate } from '../ai-read-gate'

export type ReadAiInsightsDependencies = Readonly<{
  authorization: AiAuthorizationPort
  outputs: AiOutputStorePort
  processingProfiles: PropertyProcessingProfilePort
  nowEpochMillis: () => number
}>

export function createReadReviewAnalysis(dependencies: ReadAiInsightsDependencies): (
  input: Readonly<{
    organizationId: OrganizationId
    propertyId: PropertyId
    reviewId: ReviewId
    actorUserId: UserId
    sourceEpoch: number
    sourceRevision: number
    analysisSequence: number
  }>,
) => Promise<ReviewAnalysisReadV1> {
  return async (input) => {
    const gate = await resolveAiReadGate(dependencies, input, 'review_analysis')
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
        ...input,
        authorizationLineageId: gate.authorization.authorizationLineageId,
        reviewAnalysisEpoch: gate.authorization.capabilityEpochs.review_analysis.epoch,
        propertyProfileVersion: gate.profile.profileVersion,
        analysisProfileVersion: 'review-analysis-v1',
        nowEpochMillis: dependencies.nowEpochMillis(),
      },
      async (result) => result,
    )
  }
}

export function createReadPropertyTrend(dependencies: ReadAiInsightsDependencies): (
  input: Readonly<{
    organizationId: OrganizationId
    propertyId: PropertyId
    actorUserId: UserId
  }>,
) => Promise<AiTrendReportRead> {
  return async (input) => {
    const gate = await resolveAiReadGate(dependencies, input, 'property_trends')
    if (gate.status === 'disabled') return { status: 'disabled' }
    return dependencies.outputs.readTrendReportForDelivery(
      {
        ...input,
        sourceEpoch: gate.authorization.authorizedSourceEpoch,
        reviewAnalysisEpoch: gate.authorization.capabilityEpochs.review_analysis.epoch,
        propertyTrendsEpoch: gate.authorization.capabilityEpochs.property_trends.epoch,
        propertyProfileVersion: gate.profile.profileVersion,
        reportProfileVersion: 'property-trend-v1',
        nowEpochMillis: dependencies.nowEpochMillis(),
      },
      async (result) => result,
    )
  }
}
