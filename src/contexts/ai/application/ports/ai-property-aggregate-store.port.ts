import type { OrganizationId, PropertyId, ReviewId } from '#/shared/domain/ids'
import type { AiReviewAnalysisTerminalDisposition } from './ai-review-event-store.port'
import type { AspectPolarityV1, AspectTaxonomyV1Id } from '#/shared/aspect-taxonomy'

export type AiPropertyAggregateHead = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  sourceEpoch: number
  reviewAnalysisEpoch: number
  propertyProfileVersion: number
  aggregateRevision: number
  terminalAnalysisSequence: number
}>

export type AiPropertyDailyAspectCount = Readonly<{
  aspect: AspectTaxonomyV1Id
  polarity: AspectPolarityV1
  count: number
}>

export type AiPropertyDailyAggregate = Readonly<{
  localDate: string
  reviewCount: number
  ratingSum: number
  sentimentCounts: Readonly<{
    positive: number
    neutral: number
    negative: number
    mixed: number
  }>
  aspectCounts: readonly AiPropertyDailyAspectCount[]
  attentionCounts: Readonly<{
    urgent: number
    high: number
    medium: number
    low: number
  }>
}>

export type AiPropertyAnalyzedReviewAspect = Readonly<{
  aspect: AspectTaxonomyV1Id
  polarity: AspectPolarityV1
  intensity: number
}>

/**
 * Content-free, current contribution evidence for trend coverage, model lineage,
 * and supporting Review navigation. It deliberately carries no Review text.
 */
export type AiPropertyAnalyzedReview = Readonly<{
  reviewId: ReviewId
  sourceRevision: number
  analysisSequence: number
  localDate: string
  rating: number
  sentiment: 'positive' | 'neutral' | 'negative' | 'mixed'
  attention: 'urgent' | 'high' | 'medium' | 'low'
  aspects: readonly AiPropertyAnalyzedReviewAspect[]
  issueLabel: string | null
  analysisProfileVersion: string
  providerDeploymentProfileVersion: string
  modelSnapshot: string
}>

export type AiPropertyUnavailableReview = Readonly<{
  reviewId: ReviewId
  sourceRevision: number
  analysisSequence: number
  localDate: string
  rating: number
  reason: 'language_not_supported'
}>

export type AiPropertyAggregateCoverage = Readonly<{
  /** Exact append-only settlement ledger rows for this source and analysis epoch. */
  settledAnalysisCount: number
  /** Review Analysis head minus the enablement start sequence. */
  expectedAnalysisCount: number
  /** Expected settlements that have not reached the aggregate ledger yet. */
  awaitingAnalysisCount: number
}>

export type AiPropertyAggregateWindowRequest = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  sourceEpoch: number
  reviewAnalysisEpoch: number
  propertyProfileVersion: number
  startLocalDate: string
  endLocalDate: string
}>

export type AiPropertyAggregateWindow = Readonly<{
  head: AiPropertyAggregateHead
  coverage: AiPropertyAggregateCoverage
  days: readonly AiPropertyDailyAggregate[]
  analyzedReviews: readonly AiPropertyAnalyzedReview[]
  unavailableReviews: readonly AiPropertyUnavailableReview[]
}>

export type AiPropertyAggregateStorePort = Readonly<{
  applyReviewAnalysis(
    input: Readonly<{
      organizationId: OrganizationId
      propertyId: PropertyId
      reviewId: ReviewId
      sourceEpoch: number
      sourceRevision: number
      analysisSequence: number
      reviewAnalysisEpoch: number
      propertyProfileVersion: number
      calendarProfileVersion: 'property-calendar-v1'
    }>,
  ): Promise<
    | Readonly<{ status: 'applied'; aggregateRevision: number }>
    | Readonly<{ status: 'replayed'; aggregateRevision: number }>
    | Readonly<{ status: 'unavailable' }>
    | Readonly<{ status: 'stale' }>
  >
  advanceWithoutAnalysis(
    input: Readonly<{
      organizationId: OrganizationId
      propertyId: PropertyId
      sourceEpoch: number
      reviewId: ReviewId
      analysisSequence: number
      reviewAnalysisEpoch: number
      propertyProfileVersion: number
      dispositionCode: AiReviewAnalysisTerminalDisposition
    }>,
  ): Promise<
    | Readonly<{ status: 'applied'; aggregateRevision: number }>
    | Readonly<{ status: 'replayed'; aggregateRevision: number }>
    | Readonly<{ status: 'stale' }>
  >
  readWindow(
    input: AiPropertyAggregateWindowRequest,
  ): Promise<AiPropertyAggregateWindow | null>
}>
