import type { OrganizationId, PropertyId, ReviewId, UserId } from '#/shared/domain/ids'
import type {
  AiOperationId,
  AiReadDeliveryLease,
  ReviewAnalysisReadV1,
} from '../../domain/types'

export type AiAnalysisDerivative = Readonly<{
  sentiment: 'positive' | 'neutral' | 'negative' | 'mixed'
  primaryCategory:
    | 'service'
    | 'staff'
    | 'quality'
    | 'value'
    | 'cleanliness'
    | 'wait_time'
    | 'atmosphere'
    | 'location'
    | 'accessibility'
    | 'other'
  attention: 'urgent' | 'high' | 'medium' | 'low'
}>

export type AiAnalysisResult =
  | Readonly<{ status: 'ready'; derivative: AiAnalysisDerivative }>
  | Readonly<{ status: 'unavailable'; reason: 'language_not_supported' }>

export type AiTrendReport = Readonly<{
  signalKey: string
  direction: 'improving' | 'stable' | 'declining'
  confidenceBasisPoints: number
  supportingReviewCount: number
}>

export type AiProviderCompletion = Readonly<{
  expectedAttempt: number
  modelSnapshot: string
  inputTokens: number
  outputTokens: number
  completedAtEpochMillis: number
}>

export type AiTrendReportRead =
  | Readonly<{ status: 'disabled' }>
  | Readonly<{
      status: 'preparing'
      sourceEpoch: number
      reviewAnalysisEpoch: number
      propertyTrendsEpoch: number
      propertyProfileVersion: number
    }>
  | Readonly<{
      status: 'snapshot_superseded'
      sourceEpoch: number
      reviewAnalysisEpoch: number
      propertyTrendsEpoch: number
      propertyProfileVersion: number
      terminalAnalysisSequence: number
      aggregateRevision: number
    }>
  | Readonly<{
      status: 'ready'
      sourceEpoch: number
      reviewAnalysisEpoch: number
      propertyTrendsEpoch: number
      propertyProfileVersion: number
      dueLocalDate: string
      terminalAnalysisSequence: number
      aggregateRevision: number
      reportProfileVersion: string
      report: AiTrendReport
      generatedAtEpochMillis: number
    }>

export type AiOutputStorePort = Readonly<{
  storeAnalysis(
    input: Readonly<{
      operationId: AiOperationId
      providerCompletion: AiProviderCompletion
      organizationId: OrganizationId
      propertyId: PropertyId
      reviewId: ReviewId
      sourceEpoch: number
      sourceRevision: number
      analysisSequence: number
      authorizationLineageId: string
      reviewAnalysisEpoch: number
      propertyProfileVersion: number
      analysisProfileVersion: string
      result: AiAnalysisResult
      generatedAtEpochMillis: number
      expiresAtEpochMillis: number
    }>,
  ): Promise<boolean>

  storeTrendReport(
    input: Readonly<{
      operationId: AiOperationId
      organizationId: OrganizationId
      providerCompletion: AiProviderCompletion
      propertyId: PropertyId
      sourceEpoch: number
      reviewAnalysisEpoch: number
      propertyTrendsEpoch: number
      propertyProfileVersion: number
      dueLocalDate: string
      terminalAnalysisSequence: number
      aggregateRevision: number
      reportProfileVersion: string
      report: AiTrendReport
      generatedAtEpochMillis: number
      expiresAtEpochMillis: number
    }>,
  ): Promise<boolean>

  readAnalysisForDelivery<T>(
    input: Readonly<{
      organizationId: OrganizationId
      actorUserId: UserId
      propertyId: PropertyId
      reviewId: ReviewId
      authorizationLineageId: string
      reviewAnalysisEpoch: number
      sourceEpoch: number
      sourceRevision: number
      analysisSequence: number
      propertyProfileVersion: number
      analysisProfileVersion: string
      nowEpochMillis: number
    }>,
    deliver: (lease: AiReadDeliveryLease, result: ReviewAnalysisReadV1) => Promise<T>,
  ): Promise<T>

  readTrendReportForDelivery<T>(
    input: Readonly<{
      organizationId: OrganizationId
      actorUserId: UserId
      propertyId: PropertyId
      sourceEpoch: number
      reviewAnalysisEpoch: number
      propertyTrendsEpoch: number
      propertyProfileVersion: number
      reportProfileVersion: string
      nowEpochMillis: number
    }>,
    deliver: (lease: AiReadDeliveryLease, result: AiTrendReportRead) => Promise<T>,
  ): Promise<T>
}>
