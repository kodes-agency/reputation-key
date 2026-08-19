import type { OrganizationId, PropertyId, ReviewId, UserId } from '#/shared/domain/ids'
import type { AiAuthorizationPort } from '../ports/ai-authorization.port'
import type { AiOutputStorePort, AiTrendReportRead } from '../ports/ai-output-store.port'
import type { PropertyProcessingProfilePort } from '../ports/property-processing-profile.port'
import type { ReviewAnalysisReadV1 } from '../../domain/types'

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
    const [authorization, runtime] = await Promise.all([
      dependencies.authorization.readMerchantAuthorization(input),
      dependencies.processingProfiles.readForAi(input),
    ])
    if (
      authorization === null ||
      authorization.state !== 'enabled' ||
      authorization.authorizationLineageId === null ||
      !authorization.capabilities.includes('review_analysis') ||
      runtime.status !== 'available'
    ) {
      return { status: 'disabled' }
    }
    return dependencies.outputs.readAnalysisForDelivery(
      {
        ...input,
        authorizationLineageId: authorization.authorizationLineageId,
        reviewAnalysisEpoch: authorization.capabilityEpochs.review_analysis.epoch,
        propertyProfileVersion: runtime.profile.profileVersion,
        analysisProfileVersion: 'review-analysis-v1',
        nowEpochMillis: dependencies.nowEpochMillis(),
      },
      async (_lease, result) => result,
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
    const [authorization, runtime] = await Promise.all([
      dependencies.authorization.readMerchantAuthorization(input),
      dependencies.processingProfiles.readForAi(input),
    ])
    if (
      authorization === null ||
      authorization.state !== 'enabled' ||
      !authorization.capabilities.includes('property_trends') ||
      runtime.status !== 'available'
    ) {
      return { status: 'disabled' }
    }
    return dependencies.outputs.readTrendReportForDelivery(
      {
        ...input,
        sourceEpoch: authorization.authorizedSourceEpoch,
        reviewAnalysisEpoch: authorization.capabilityEpochs.review_analysis.epoch,
        propertyTrendsEpoch: authorization.capabilityEpochs.property_trends.epoch,
        propertyProfileVersion: runtime.profile.profileVersion,
        reportProfileVersion: 'property-trend-v1',
        nowEpochMillis: dependencies.nowEpochMillis(),
      },
      async (_lease, result) => result,
    )
  }
}
